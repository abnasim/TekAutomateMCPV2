import { captureScreenshotProxy } from '../core/instrumentProxy';
import type { ToolResult } from '../core/schemas';
import { dispatchLiveActionThroughTekAutomate, shouldBridgeToTekAutomate, withRuntimeInstrumentDefaults } from './liveToolSupport';

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
}

async function compressAnalyzedScreenshotPayload(
  payload: Record<string, unknown>,
  analyze?: boolean,
): Promise<Record<string, unknown>> {
  if (analyze !== true) return payload;

  const base64 = typeof payload.base64 === 'string' ? payload.base64 : '';
  const mimeType = typeof payload.mimeType === 'string' ? payload.mimeType : '';
  if (!base64 || !mimeType.startsWith('image/')) return payload;

  try {
    const { Jimp } = await import('jimp');
    const rawBuffer = Buffer.from(base64, 'base64');
    const variants = [
      { width: 800, height: 480, quality: 75 },
      { width: 640, height: 384, quality: 55 },
      { width: 480, height: 288, quality: 45 },
    ];

    const image = await Jimp.read(rawBuffer);
    let best: Buffer = rawBuffer;
    for (const variant of variants) {
      const scale = Math.min(variant.width / image.bitmap.width, variant.height / image.bitmap.height, 1);
      const width = Math.max(1, Math.round(image.bitmap.width * scale));
      const height = Math.max(1, Math.round(image.bitmap.height * scale));
      const candidateImage = image.clone().resize({ w: width, h: height });
      const candidate: Buffer = await candidateImage.getBuffer('image/jpeg', { quality: variant.quality });

      if (candidate.length < best.length) {
        best = candidate;
      }

      if (candidate.length <= 35 * 1024) {
        best = candidate;
        break;
      }
    }

    if (best.length >= rawBuffer.length) {
      return payload;
    }

    return {
      ...payload,
      analysisMimeType: 'image/jpeg',
      analysisSizeBytes: best.length,
      originalMimeType: mimeType,
      originalSizeBytes: rawBuffer.length,
      analysisBase64: best.toString('base64'),
    };
  } catch {
    return payload;
  }
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
  };
}

export async function captureScreenshot(input: Input): Promise<ToolResult<Record<string, unknown>>> {
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
    const maybeCompressed = bridged.ok
      ? await compressAnalyzedScreenshotPayload(data, input.analyze)
      : data;
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
  return {
    ...result,
    data: stripScreenshotPayloadForNonAnalysis(
      await compressAnalyzedScreenshotPayload(result.data as Record<string, unknown>, input.analyze),
      input.analyze,
    ),
  };
}
