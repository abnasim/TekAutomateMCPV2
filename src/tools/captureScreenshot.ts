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
  analysisTransport?: 'auto' | 'url' | 'base64' | 'mcp_image' | 'openai_image' | 'claude_image';
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
      if (urlPayload) {
        const localPath = saveScreenshotLocally(maybeCompressed);
        return {
          ok: true,
          data: { ...urlPayload, ...(localPath ? { localPath } : {}) },
          sourceMeta: [],
          warnings: [],
        };
      }
      // No HTTP base URL (stdio/local mode) — save locally and let Claude Code read it.
      // Both 'auto' and 'url'/'openai_image' (remapped to 'url') use the same fallback.
      const localPath = saveScreenshotLocally(maybeCompressed);
      if (localPath) {
        return {
          ok: true,
          data: {
            ok: true, captured: true, localPath,
            capturedAt: typeof maybeCompressed.capturedAt === 'string' ? maybeCompressed.capturedAt : new Date().toISOString(),
            mimeType: typeof maybeCompressed.mimeType === 'string' ? maybeCompressed.mimeType : 'image/png',
            sizeBytes: typeof maybeCompressed.sizeBytes === 'number' ? maybeCompressed.sizeBytes : undefined,
            scopeType: typeof maybeCompressed.scopeType === 'string' ? maybeCompressed.scopeType : undefined,
            _hint: 'Screenshot saved locally. Use the Read tool to view this image file.',
          },
          sourceMeta: [],
          warnings: [],
        };
      }
      // Last resort: mcp_image embed (may fail for large images)
      const imagePayload = buildMcpImageScreenshotPayload(maybeCompressed);
      if (imagePayload) {
        return { ok: true, data: imagePayload, sourceMeta: [], warnings: [] };
      }
      return {
        ok: false,
        data: {
          error: 'VISION_URL_UNAVAILABLE',
          message: 'capture_screenshot could not save the screenshot locally or create a temporary image URL.',
          debug: buildVisionUrlDebug(maybeCompressed, input, 'bridge'),
        },
        sourceMeta: [],
        warnings: ['Screenshot could not be stored.'],
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

  // In direct/stdio local mode always save to a temp file.  Embedding a full-size
  // PNG as base64 in the JSON-RPC response produces a giant single-line JSON that
  // some clients (Claude Desktop, Claude Code) fail to parse ("error decoding
  // response body").  The localPath lets Claude Code use its Read tool to view the
  // image directly — no large payload in the transport layer at all.
  const localPath = saveScreenshotLocally(maybeCompressed);

  if (input.analyze === true && analysisTransport === 'mcp_image') {
    const imagePayload = buildMcpImageScreenshotPayload(maybeCompressed);
    if (!imagePayload) {
      // mcp_image build failed — fall back to localPath so the caller isn't empty-handed
      if (localPath) {
        return {
          ...result,
          ok: true,
          data: {
            ok: true, captured: true, localPath,
            _hint: 'Screenshot saved locally. Use the Read tool to view this image file.',
          },
          warnings: ['MCP image content block could not be created; screenshot saved to localPath.'],
        };
      }
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
      data: { ...imagePayload, ...(localPath ? { localPath } : {}) },
      warnings: [],
    };
  }

  // For 'auto', 'url' (and remapped 'openai_image') transports:
  // 1. If we have a base URL (HTTP server mode), return a short-lived URL.
  // 2. Otherwise (stdio/local mode) — prefer the local file path.  No massive
  //    base64 blob in the JSON-RPC stream.  Fall back to mcp_image only when
  //    localPath is unavailable (e.g. tmpdir write failure).
  if (input.analyze === true && (analysisTransport === 'auto' || analysisTransport === 'url')) {
    const urlPayload = buildUrlOnlyScreenshotPayload(maybeCompressed, input);
    if (urlPayload) {
      return {
        ...result,
        ok: true,
        data: { ...urlPayload, ...(localPath ? { localPath } : {}) },
        warnings: [],
      };
    }

    // No HTTP base URL — stdio / local mode.
    if (localPath) {
      // Primary: compact text response with file path.  The stdio handler
      // (buildExternalMcpToolContent) will emit a clean text block; Claude Code
      // can then use its Read tool to render the image.
      return {
        ...result,
        ok: true,
        data: {
          ok: true,
          captured: true,
          localPath,
          capturedAt: typeof maybeCompressed.capturedAt === 'string' ? maybeCompressed.capturedAt : new Date().toISOString(),
          mimeType: typeof maybeCompressed.mimeType === 'string' ? maybeCompressed.mimeType : 'image/png',
          sizeBytes: typeof maybeCompressed.sizeBytes === 'number' ? maybeCompressed.sizeBytes : undefined,
          scopeType: typeof maybeCompressed.scopeType === 'string' ? maybeCompressed.scopeType : undefined,
          _hint: 'Screenshot saved locally. Use the Read tool to view this image file.',
        },
        warnings: [],
      };
    }

    // Last resort: try mcp_image content block (may fail for very large images)
    const imagePayload = buildMcpImageScreenshotPayload(maybeCompressed);
    if (imagePayload) {
      return { ...result, ok: true, data: imagePayload, warnings: [] };
    }

    return {
      ok: false,
      data: {
        error: 'VISION_URL_UNAVAILABLE',
        message: 'capture_screenshot could not save the screenshot locally or create a temporary image URL. Check that the temp directory is writable.',
        debug: buildVisionUrlDebug(maybeCompressed, input, 'proxy'),
      },
      sourceMeta: [],
      warnings: ['Screenshot could not be stored.'],
    };
  }

  return {
    ...result,
    data: stripScreenshotPayloadForNonAnalysis(maybeCompressed, input.analyze),
  };
}
