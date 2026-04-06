import { getVisaResourcesProxy } from '../core/instrumentProxy';
import type { ToolResult } from '../core/schemas';

interface Input {
  executorUrl: string;
  visaResource: string;
  backend: string;
  liveMode?: boolean;
  outputMode?: 'clean' | 'verbose';
}

interface ScannedInstrument {
  resource: string;
  identity: string;
  manufacturer: string;
  model: string;
  serial: string;
  firmware: string;
  reachable: boolean;
  connType: string;
}

/**
 * List VISA resources. First tries the executor /scan endpoint which returns
 * rich instrument metadata (IDN, model, serial). Falls back to the basic
 * pyvisa list_resources() if /scan is unavailable.
 */
export async function getVisaResources(input: Input): Promise<ToolResult<Record<string, unknown>>> {
  if (!input.liveMode) {
    return { ok: false, data: {}, sourceMeta: [], warnings: ['live instrument mode is disabled'] };
  }

  // Try the richer /scan endpoint first
  try {
    const scanRes = await fetch(`${input.executorUrl.replace(/\/$/, '')}/scan`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(35000),
    });
    const scanJson = (await scanRes.json()) as { ok?: boolean; instruments?: ScannedInstrument[]; count?: number; error?: string };
    if (scanJson.ok && Array.isArray(scanJson.instruments)) {
      return {
        ok: true,
        data: {
          instruments: scanJson.instruments,
          count: scanJson.count || scanJson.instruments.length,
          source: 'executor_scan',
          hint: 'Use the "resource" field as the visaResource parameter in send_scpi/probe_command to target a specific instrument.',
        },
        sourceMeta: [],
        warnings: [],
      };
    }
  } catch {
    // Fall through to basic list_resources
  }

  // Fallback: basic pyvisa list_resources
  return getVisaResourcesProxy(input);
}
