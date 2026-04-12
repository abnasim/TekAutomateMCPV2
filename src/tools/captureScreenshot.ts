import { captureScreenshotProxy } from '../core/instrumentProxy';
import type { ToolResult } from '../core/schemas';
import { storeTempVisionImage } from '../core/tempImageStore';
import { dispatchLiveActionThroughTekAutomate, shouldBridgeToTekAutomate, withRuntimeInstrumentDefaults } from './liveToolSupport';
import fs from 'fs';
import os from 'os';
import path from 'path';

function saveScreenshotLocally(payload: Record<string, unknown>): string | null {
  try {
    const base64 = typeof payload.base64 === 'string' ? payload.base64
      : typeof payload.analysisBase64 === 'string' ? payload.analysisBase64 : '';
    const mimeType = typeof payload.mimeType === 'string' ? payload.mimeType
      : typeof payload.analysisMimeType === 'string' ? payload.analysisMimeType : 'image/png';
    if (!base64) return null;
    const ext = mimeType.includes('jpeg') ? 'jpg' : 'png';
    const dir = path.join(os.tmpdir(), 'tekautomate');
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `screenshot_${Date.now()}.${ext}`);
    fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
    return filePath;
  } catch {
    return null;
  }
}

interface Input extends Record<string, unknown> {
  executorUrl: string;
  visaResource: string;
  backend: string;
  liveMode?: boolean;
  outputMode?: 'clean' | 'verbose';
  scopeType?: 'modern' | 'legacy';
  modelFamily?: string;
  deviceDriver?: string;
  analyze?: boolean;
  analysisTransport?: 'auto' | 'url' | 'file_id' | 'base64' | 'mcp_image' | 'openai_image' | 'claude_image';
  __mcpBaseUrl?: string;
}


function stripScreenshotPayloadForNonAnalysis(
  payload: Record<string, unknown>,
  analyze?: boolean,
): Record<string, unknown> {
  if (analyze === true) return payload;

  const capturedAt = typeof payload.capturedAt === 'string' ? payload.capturedAt : new Date().toISOString();
  const sizeBytes = typeof payload.sizeBytes === 'number' ? payload.sizeBytes : undefined;
  const scopeType = typeof payload.scopeType === 'string' ? payload.scopeType : undefined;
  const originalMimeType = typeof payload.originalMimeType === 'string' ? payload.originalMimeType : undefined;

  return {
    ok: payload.ok === false ? false : true,
    captured: true,
    capturedAt,
    ...(typeof sizeBytes === 'number' ? { sizeBytes } : {}),
    ...(scopeType ? { scopeType } : {}),
    ...(originalMimeType ? { originalMimeType } : {}),
    note: 'Screenshot sent to TekAutomate UI display. No image data returned to you. Call capture_screenshot again with analyze:true to receive the image.',
  };
}

function buildUrlOnlyScreenshotPayload(
  payload: Record<string, unknown>,
  input: Input,
): Record<string, unknown> | null {
  const baseUrl = String(input.__mcpBaseUrl || '').trim();
  if (!baseUrl) return null;

  // URL transport should preserve the original screenshot fidelity.
  // Compression is still useful for base64 fallback, but when we can hand
  // the model a short-lived image URL we should serve the original bytes.
  const imageBase64 = typeof payload.base64 === 'string'
    ? payload.base64
    : typeof payload.analysisBase64 === 'string'
      ? payload.analysisBase64
      : '';
  const imageMimeType = typeof payload.mimeType === 'string'
    ? payload.mimeType
    : typeof payload.analysisMimeType === 'string'
      ? payload.analysisMimeType
      : '';
  if (!imageBase64 || !imageMimeType) return null;

  const stored = storeTempVisionImage({
    buffer: Buffer.from(imageBase64, 'base64'),
    mimeType: imageMimeType,
    createdAt: typeof payload.capturedAt === 'string' ? payload.capturedAt : undefined,
  });

  return {
    ok: payload.ok === false ? false : true,
    captured: true,
    capturedAt: typeof payload.capturedAt === 'string' ? payload.capturedAt : new Date().toISOString(),
    scopeType: typeof payload.scopeType === 'string' ? payload.scopeType : undefined,
    mimeType: imageMimeType,
    imageUrl: `${baseUrl}${stored.path}`,
    expiresAt: stored.expiresAt,
    ...(typeof payload.sizeBytes === 'number'
      ? { sizeBytes: payload.sizeBytes }
      : typeof payload.analysisSizeBytes === 'number'
        ? { sizeBytes: payload.analysisSizeBytes }
        : {}),
    ...(typeof payload.originalMimeType === 'string' ? { originalMimeType: payload.originalMimeType } : {}),
    ...(typeof payload.originalSizeBytes === 'number' ? { originalSizeBytes: payload.originalSizeBytes } : {}),
  };
}

function buildMcpImageScreenshotPayload(
  payload: Record<string, unknown>,
): Record<string, unknown> | null {
  const imageBase64 = typeof payload.base64 === 'string'
    ? payload.base64
    : typeof payload.analysisBase64 === 'string'
      ? payload.analysisBase64
      : '';
  const imageMimeType = typeof payload.mimeType === 'string'
    ? payload.mimeType
    : typeof payload.analysisMimeType === 'string'
      ? payload.analysisMimeType
      : '';
  if (!imageBase64 || !imageMimeType) return null;

  return {
    ok: payload.ok === false ? false : true,
    captured: true,
    capturedAt: typeof payload.capturedAt === 'string' ? payload.capturedAt : new Date().toISOString(),
    scopeType: typeof payload.scopeType === 'string' ? payload.scopeType : undefined,
    mimeType: imageMimeType,
    ...(typeof payload.sizeBytes === 'number'
      ? { sizeBytes: payload.sizeBytes }
      : typeof payload.analysisSizeBytes === 'number'
        ? { sizeBytes: payload.analysisSizeBytes }
        : {}),
    ...(typeof payload.originalMimeType === 'string' ? { originalMimeType: payload.originalMimeType } : {}),
    ...(typeof payload.originalSizeBytes === 'number' ? { originalSizeBytes: payload.originalSizeBytes } : {}),
    imageContent: {
      type: 'image',
      data: imageBase64,
      mimeType: imageMimeType,
    },
  };
}

function buildVisionUrlDebug(
  payload: Record<string, unknown>,
  input: Input,
  source: 'bridge' | 'proxy',
): Record<string, unknown> {
  const baseUrl = String(input.__mcpBaseUrl || '').trim();
  const imageBase64 = typeof payload.analysisBase64 === 'string'
    ? payload.analysisBase64
    : typeof payload.base64 === 'string'
      ? payload.base64
      : '';
  const imageMimeType = typeof payload.analysisMimeType === 'string'
    ? payload.analysisMimeType
    : typeof payload.mimeType === 'string'
      ? payload.mimeType
      : '';
  return {
    analysisTransport: String(input.analysisTransport || 'auto'),
    requestedAnalyze: input.analyze === true,
    source,
    hasBaseUrl: Boolean(baseUrl),
    baseUrl,
    hasImageBase64: Boolean(imageBase64),
    imageBase64Length: imageBase64.length,
    imageMimeType,
    hasAnalysisBase64: typeof payload.analysisBase64 === 'string',
    hasRawBase64: typeof payload.base64 === 'string',
  };
}

export async function captureScreenshot(input: Input): Promise<ToolResult<Record<string, unknown>>> {
  const analysisTransportRaw = String(input.analysisTransport || 'auto').toLowerCase() as Input['analysisTransport'];
  const analysisTransport = analysisTransportRaw === 'claude_image'
    ? 'mcp_image'
    : analysisTransportRaw === 'openai_image'
      ? 'url'
      : analysisTransportRaw;
  if (shouldBridgeToTekAutomate(input)) {
    const bridged = await dispatchLiveActionThroughTekAutomate(
      'capture_screenshot',
      input,
      90_000,
    );
    const data = bridged.ok
      ? ((bridged.result && typeof bridged.result === 'object'
          ? bridged.result
          : { result: bridged.result }) as Record<string, unknown>)
      : { error: 'LIVE_ACTION_FAILED', message: bridged.error || 'TekAutomate failed to capture screenshot.' };
    const maybeCompressed = data;
    if (bridged.ok && input.analyze === true && analysisTransport === 'mcp_image') {
      const imagePayload = buildMcpImageScreenshotPayload(maybeCompressed);
      if (!imagePayload) {
        return {
          ok: false,
          data: {
            error: 'VISION_IMAGE_UNAVAILABLE',
            message: 'capture_screenshot requested MCP image transport, but MCP could not build an image content block.',
          },
          sourceMeta: [],
          warnings: ['MCP image content block could not be created.'],
        };
      }
      return {
        ok: true,
        data: imagePayload,
        sourceMeta: [],
        warnings: [],
      };
    }
    if (bridged.ok && input.analyze === true && (analysisTransport === 'auto' || analysisTransport === 'url')) {
      const urlPayload = buildUrlOnlyScreenshotPayload(maybeCompressed, input);
      if (!urlPayload) {
        // No base URL (e.g. STDIO/local) — try mcp_image for Claude, then base64 data URI for Codex/others
        if (analysisTransport === 'auto') {
          const imagePayload = buildMcpImageScreenshotPayload(maybeCompressed);
          const localPath = saveScreenshotLocally(maybeCompressed);
          const base64 = typeof maybeCompressed.base64 === 'string' ? maybeCompressed.base64
            : typeof maybeCompressed.analysisBase64 === 'string' ? maybeCompressed.analysisBase64 : '';
          const mimeType = typeof maybeCompressed.mimeType === 'string' ? maybeCompressed.mimeType : 'image/png';
          const dataUri = base64 ? `data:${mimeType};base64,${base64}` : null;
          if (imagePayload) {
            return {
              ok: true,
              data: { ...imagePayload, ...(localPath ? { localPath } : {}), ...(dataUri ? { dataUri } : {}) },
              sourceMeta: [],
              warnings: [],
            };
          }
          if (localPath || dataUri) {
            return {
              ok: true,
              data: { ok: true, captured: true, ...(localPath ? { localPath } : {}), ...(dataUri ? { dataUri } : {}) },
              sourceMeta: [],
              warnings: [],
            };
          }
        }
        return {
          ok: false,
          data: {
            error: 'VISION_URL_UNAVAILABLE',
            message: 'capture_screenshot requested URL analysis transport, but MCP could not create a temporary image URL.',
            debug: buildVisionUrlDebug(maybeCompressed, input, 'bridge'),
          },
          sourceMeta: [],
          warnings: ['Temporary screenshot URL could not be created.'],
        };
      }
      return {
        ok: true,
        data: urlPayload,
        sourceMeta: [],
        warnings: [],
      };
    }
    const finalData = bridged.ok
      ? stripScreenshotPayloadForNonAnalysis(maybeCompressed, input.analyze)
      : maybeCompressed;
    return {
      ok: bridged.ok,
      data: finalData,
      sourceMeta: [],
      warnings: bridged.ok ? [] : [bridged.error || 'TekAutomate live action failed.'],
    };
  }

  input = withRuntimeInstrumentDefaults(input);
  if (!input.executorUrl) {
    return { ok: false, data: { error: 'NO_INSTRUMENT', message: 'No instrument connected. Connect to a scope via the Execute page first.' }, sourceMeta: [], warnings: ['No executorUrl - instrument not connected.'] };
  }
  if (!input.liveMode) {
    return { ok: false, data: { error: 'NOT_LIVE', message: 'liveMode must be true to capture screenshots.' }, sourceMeta: [], warnings: ['liveMode is not enabled.'] };
  }
  const result = await captureScreenshotProxy(input);
  if (!result.ok || !result.data || typeof result.data !== 'object') {
    return result;
  }
  const maybeCompressed = result.data as Record<string, unknown>;
  if (input.analyze === true && analysisTransport === 'mcp_image') {
    const imagePayload = buildMcpImageScreenshotPayload(maybeCompressed);
    if (!imagePayload) {
      return {
        ok: false,
        data: {
          error: 'VISION_IMAGE_UNAVAILABLE',
          message: 'capture_screenshot requested MCP image transport, but MCP could not build an image content block.',
        },
        sourceMeta: [],
        warnings: ['MCP image content block could not be created.'],
      };
    }
    return {
      ...result,
      ok: true,
      data: imagePayload,
      warnings: [],
    };
  }
  if (input.analyze === true && (analysisTransport === 'auto' || analysisTransport === 'url')) {
    const urlPayload = buildUrlOnlyScreenshotPayload(maybeCompressed, input);
    if (!urlPayload) {
      // No base URL (e.g. STDIO/local) — try mcp_image for Claude, then base64 data URI for Codex/others
      if (analysisTransport === 'auto') {
        const imagePayload = buildMcpImageScreenshotPayload(maybeCompressed);
        const localPath = saveScreenshotLocally(maybeCompressed);
        const base64 = typeof maybeCompressed.base64 === 'string' ? maybeCompressed.base64
          : typeof maybeCompressed.analysisBase64 === 'string' ? maybeCompressed.analysisBase64 : '';
        const mimeType = typeof maybeCompressed.mimeType === 'string' ? maybeCompressed.mimeType : 'image/png';
        const dataUri = base64 ? `data:${mimeType};base64,${base64}` : null;
        if (imagePayload) {
          return {
            ...result, ok: true,
            data: { ...imagePayload, ...(localPath ? { localPath } : {}), ...(dataUri ? { dataUri } : {}) },
            warnings: [],
          };
        }
        if (localPath || dataUri) {
          return {
            ...result, ok: true,
            data: { ok: true, captured: true, ...(localPath ? { localPath } : {}), ...(dataUri ? { dataUri } : {}) },
            warnings: [],
          };
        }
      }
      return {
        ok: false,
        data: {
          error: 'VISION_URL_UNAVAILABLE',
          message: 'capture_screenshot requested URL analysis transport, but MCP could not create a temporary image URL.',
          debug: buildVisionUrlDebug(maybeCompressed, input, 'proxy'),
        },
        sourceMeta: [],
        warnings: ['Temporary screenshot URL could not be created.'],
      };
    }
    return {
      ...result,
      ok: true,
      data: urlPayload,
      warnings: [],
    };
  }
  return {
    ...result,
    data: stripScreenshotPayloadForNonAnalysis(maybeCompressed, input.analyze),
  };
}
