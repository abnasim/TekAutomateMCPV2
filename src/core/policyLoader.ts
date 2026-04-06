import { promises as fs } from 'fs';
import * as path from 'path';
import { resolvePoliciesDir } from './paths';

const POLICY_FILES: Record<string, string> = {
  steps_json: 'steps_json.strict.v1.md',
  blockly_xml: 'blockly_xml.strict.v1.md',
  scpi_verification: 'scpi_verification.v1.md',
  response_format: 'response_format.v1.md',
  backend_taxonomy: 'backend_taxonomy.v1.md',
};

const cache = new Map<string, string>();

export function getPolicyFilename(mode: string): string | null {
  return POLICY_FILES[mode] || null;
}

export async function loadPolicy(mode: string, baseDir?: string): Promise<string | null> {
  const file = getPolicyFilename(mode);
  if (!file) return null;
  const key = `${baseDir || ''}:${file}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const dir = baseDir || resolvePoliciesDir();
  const fullPath = path.join(dir, file);
  try {
    const content = await fs.readFile(fullPath, 'utf8');
    cache.set(key, content);
    return content;
  } catch {
    return null;
  }
}

export async function loadPolicyBundle(modes: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const mode of modes) {
    const content = await loadPolicy(mode);
    if (content) out[mode] = content;
  }
  return out;
}
