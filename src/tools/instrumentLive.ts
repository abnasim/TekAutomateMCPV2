import { captureScreenshot } from './captureScreenshot';
import { discoverScpi } from './discoverScpi';
import { getInstrumentInfo } from './getInstrumentInfo';
import { getVisaResources } from './getVisaResources';
import { sendScpi } from './sendScpi';

interface InstrumentLiveInput extends Record<string, unknown> {
  action?: string;
  args?: Record<string, unknown>;
  analyze?: boolean;
  analysisTransport?: 'auto' | 'file_id' | 'base64';
}

function mergeArgs(input: InstrumentLiveInput): Record<string, unknown> {
  const nested = input.args && typeof input.args === 'object' ? input.args : {};
  const merged = { ...nested, ...input };
  delete (merged as Record<string, unknown>).args;
  return merged as Record<string, unknown>;
}

export async function instrumentLive(input: InstrumentLiveInput) {
  const action = String(input.action || '').trim().toLowerCase();
  const args = mergeArgs(input);
  delete args.action;

  switch (action) {
    case 'context':
      return getInstrumentInfo();
    case 'send':
      return sendScpi(args as any);
    case 'screenshot':
      return captureScreenshot(args as any);
    case 'discover':
    case 'snapshot':
    case 'diff':
    case 'inspect':
      return discoverScpi({
        ...(args as any),
        action: action === 'discover' ? String(args.action || 'snapshot') : action,
      });
    case 'resources':
      return getVisaResources(args as any);
    default:
      return {
        ok: false,
        data: null,
        sourceMeta: [],
        warnings: [
          'Unknown instrument_live action. Use one of: context, send, screenshot, snapshot, diff, inspect, resources.',
        ],
      };
  }
}
