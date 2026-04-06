import { getTmDevicesIndex } from '../core/tmDevicesIndex';
import type { ToolResult } from '../core/schemas';

interface MaterializeTmDevicesCallInput {
  methodPath: string;
  model?: string;
  objectName?: string;
  placeholderBindings?: Record<string, string | number | boolean>;
  arguments?: unknown[];
  keywordArguments?: Record<string, unknown>;
}

function escapePythonString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function toPythonLiteral(value: unknown): string {
  if (typeof value === 'string') return `"${escapePythonString(value)}"`;
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (value === null) return 'None';
  if (Array.isArray(value)) return `[${value.map((item) => toPythonLiteral(item)).join(', ')}]`;
  if (value && typeof value === 'object') {
    const parts = Object.entries(value as Record<string, unknown>).map(
      ([key, item]) => `"${escapePythonString(key)}": ${toPythonLiteral(item)}`
    );
    return `{${parts.join(', ')}}`;
  }
  return 'None';
}

function buildMethodPathVariants(methodPath: string): string[] {
  const source = String(methodPath || '').trim();
  if (!source) return [];
  const variants = new Set<string>([source]);
  variants.add(source.replace(/\[\d+\]/g, '[x]'));
  variants.add(source.replace(/\.\d+\b/g, '.x'));
  return Array.from(variants).filter(Boolean);
}

function applyBindings(source: string, bindings?: Record<string, string | number | boolean>): string {
  if (!bindings || !Object.keys(bindings).length) return source;
  let out = source;
  Object.entries(bindings)
    .sort((a, b) => b[0].length - a[0].length)
    .forEach(([key, value]) => {
      const replacement = String(value);
      out = out.replace(new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), replacement);
      if (key.toLowerCase() === 'channel') {
        out = out.replace(/ch\[x\]/gi, `ch[${replacement}]`);
      }
      if (key.toLowerCase() === 'search') {
        out = out.replace(/search\[x\]/gi, `search[${replacement}]`);
      }
    });
  return out;
}

export async function materializeTmDevicesCall(
  input: MaterializeTmDevicesCallInput
): Promise<ToolResult<Record<string, unknown> | null>> {
  const requestedPath = String(input.methodPath || '').trim();
  if (!requestedPath) {
    return { ok: false, data: null, sourceMeta: [], warnings: ['Missing methodPath'] };
  }

  let index;
  try {
    index = await Promise.race([
      getTmDevicesIndex(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('tm_devices index timed out (15s)')), 15000)),
    ]);
  } catch (err) {
    return { ok: false, data: null, sourceMeta: [], warnings: [`tm_devices index unavailable: ${err instanceof Error ? err.message : String(err)}`] };
  }
  const doc =
    buildMethodPathVariants(requestedPath)
      .map((candidate) => index.getByMethodPath(candidate, input.model))
      .find((candidate) => Boolean(candidate)) || null;

  if (!doc) {
    return { ok: false, data: null, sourceMeta: [], warnings: ['No tm_devices method matched methodPath'] };
  }

  const objectName = String(input.objectName || 'scope').trim() || 'scope';
  const materializedPath = applyBindings(doc.methodPath, input.placeholderBindings);
  if (/\[[a-z]+\]/i.test(materializedPath)) {
    return {
      ok: false,
      data: {
        canonicalMethodPath: doc.methodPath,
        partialMethodPath: materializedPath,
      },
      sourceMeta: [{ file: 'tm_devices_full_tree.json', commandId: doc.methodPath, section: doc.modelRoot }],
      warnings: ['tm_devices path still contains unresolved placeholders.'],
    };
  }

  const prefixedPath =
    /^(scope|device|inst|instrument)\./i.test(materializedPath)
      ? materializedPath
      : materializedPath.startsWith('commands.')
        ? `${objectName}.${materializedPath}`
        : `${objectName}.commands.${materializedPath}`;

  const positionalArgs = Array.isArray(input.arguments) ? input.arguments.map((value) => toPythonLiteral(value)) : [];
  const keywordArgs = input.keywordArguments && typeof input.keywordArguments === 'object'
    ? Object.entries(input.keywordArguments).map(
        ([key, value]) => `${key}=${toPythonLiteral(value)}`
      )
    : [];
  const code = `${prefixedPath}(${[...positionalArgs, ...keywordArgs].join(', ')})`;

  return {
    ok: true,
    data: {
      canonicalMethodPath: doc.methodPath,
      methodPath: materializedPath,
      modelRoot: doc.modelRoot,
      signature: doc.signature,
      usageExample: doc.usageExample,
      code,
    },
    sourceMeta: [{ file: 'tm_devices_full_tree.json', commandId: doc.methodPath, section: doc.modelRoot }],
    warnings: [],
  };
}
