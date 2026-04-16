/**
 * personality — load/list prompt overlays (personas) and base prompts shipped
 * with the MCP server. Invoked via the knowledge tool's "personality" action.
 *
 * Files live on-disk at <projectRoot>/prompts/personas/*.md and
 * <projectRoot>/prompts/bases/*.md. Calling op:"load" returns the full markdown
 * in the tool result; the model reads it from the tool-result content block and
 * applies the guidance to subsequent turns. No user copy-paste needed.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { ToolResult } from '../core/schemas';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const _projectRoot = path.resolve(__dirname, '..', '..');

const NAME_RE = /^[a-z0-9_\-]+$/i;

export type PersonalityCategory = 'persona' | 'base';

export interface PersonalityInput extends Record<string, unknown> {
  op?: string;
  category?: string;
  name?: string;
}

interface Listing {
  name: string;
  bias: string;
  category: PersonalityCategory;
}

function dirFor(cat: PersonalityCategory): string {
  return path.join(_projectRoot, 'prompts', cat === 'persona' ? 'personas' : 'bases');
}

// Extract the one-line "bias" from a markdown overlay. Looks for the first
// occurrence of "Mode:" or "Bias:" in the first ~15 lines, strips markdown
// emphasis, and returns the trailing sentence. Falls back to the first non-
// heading non-blank line so the listing is never empty.
function extractBias(markdown: string): string {
  const lines = markdown.split(/\r?\n/).slice(0, 15);
  for (const raw of lines) {
    const line = raw.trim();
    const m = line.match(/^(?:Mode|Bias)\s*:\s*(.+)$/i);
    if (m) {
      return m[1]
        .replace(/\*\*/g, '')
        .replace(/\*/g, '')
        .replace(/`/g, '')
        .trim();
    }
  }
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    return line.replace(/\*\*/g, '').replace(/\*/g, '').replace(/`/g, '').trim();
  }
  return '';
}

function listCategory(cat: PersonalityCategory): Listing[] {
  const dir = dirFor(cat);
  let entries: string[];
  try {
    entries = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.md'));
  } catch {
    return [];
  }
  const out: Listing[] = [];
  for (const file of entries) {
    const name = file.replace(/\.md$/i, '');
    if (!NAME_RE.test(name)) continue;
    let bias = '';
    try {
      const raw = fs.readFileSync(path.join(dir, file), 'utf-8');
      bias = extractBias(raw);
    } catch { /* skip unreadable */ }
    out.push({ name, bias, category: cat });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

type LoadResult =
  | { ok: true; markdown: string; path: string; error?: undefined }
  | { ok: false; error: string; markdown?: undefined; path?: undefined };

function loadByName(cat: PersonalityCategory, name: string): LoadResult {
  if (!NAME_RE.test(name)) {
    return { ok: false, error: `Invalid name "${name}". Allowed: letters, digits, underscore, dash.` };
  }
  const filePath = path.join(dirFor(cat), `${name}.md`);
  // Path-traversal guard — resolve and confirm we're still inside the category dir.
  const resolved = path.resolve(filePath);
  const rootDir = path.resolve(dirFor(cat));
  if (!resolved.startsWith(rootDir + path.sep) && resolved !== rootDir) {
    return { ok: false, error: 'Path traversal rejected.' };
  }
  try {
    const markdown = fs.readFileSync(resolved, 'utf-8');
    return { ok: true, markdown, path: resolved };
  } catch {
    return { ok: false, error: `${cat} "${name}" not found. Call with op:"list" to see available names.` };
  }
}

function resolveCategory(raw: unknown): PersonalityCategory {
  const s = String(raw ?? 'persona').trim().toLowerCase();
  if (s === 'base' || s === 'bases') return 'base';
  return 'persona';
}

export async function personality(input: PersonalityInput): Promise<ToolResult<unknown>> {
  const op = String(input.op ?? 'list').trim().toLowerCase();
  const category = resolveCategory(input.category);

  if (op === 'list') {
    // If caller explicitly asked for one category, return only that; otherwise
    // return both so a bare list call surfaces personas + bases side by side.
    const userAskedForCategory = input.category !== undefined && input.category !== null && input.category !== '';
    const personas = listCategory('persona');
    const bases = userAskedForCategory
      ? (category === 'base' ? listCategory('base') : [])
      : listCategory('base');
    if (userAskedForCategory) {
      const items = category === 'persona' ? personas : bases;
      return {
        ok: true,
        data: {
          category,
          count: items.length,
          items,
          hint: `Call op:"load" with name:"<name>" to retrieve the full markdown. Names come from the "name" field of each item.`,
        },
        sourceMeta: [],
        warnings: [],
      };
    }
    return {
      ok: true,
      data: {
        personas,
        bases,
        hint: 'Call op:"load" with name:"<name>" (and optional category:"persona"|"base") to retrieve the full markdown. The default category is "persona".',
      },
      sourceMeta: [],
      warnings: [],
    };
  }

  if (op === 'load') {
    const name = String(input.name ?? '').trim();
    if (!name) {
      return {
        ok: false,
        data: { error: 'MISSING_NAME', message: 'op:"load" requires a name. Call op:"list" first to see available names.' },
        sourceMeta: [],
        warnings: ['name is required for op:"load"'],
      };
    }
    const result = loadByName(category, name);
    if (result.ok === false) {
      return {
        ok: false,
        data: { error: 'NOT_FOUND', message: result.error, category, name },
        sourceMeta: [],
        warnings: [result.error],
      };
    }
    return {
      ok: true,
      data: {
        category,
        name,
        markdown: result.markdown,
        _hint: 'This overlay steers your behavior for the rest of the session. Read the full markdown above and follow its "Lean toward" / "Lean away from" / "Tool rhythm" / "Done when" / "Response style" guidance on subsequent turns. Do NOT load another personality in the same turn — the overlay conflicts muddy priorities.',
      },
      sourceMeta: [{ file: result.path }],
      warnings: [],
    };
  }

  return {
    ok: false,
    data: { error: 'UNKNOWN_OP', message: `Unknown op "${op}". Use "list" or "load".` },
    sourceMeta: [],
    warnings: [`Unknown personality op: ${op}`],
  };
}

// Exported for use by the resource layer (server.ts / stdio.ts).
export function listPersonalityResources(): Array<{ category: PersonalityCategory; name: string; bias: string }> {
  const personas = listCategory('persona').map((p) => ({ category: 'persona' as const, name: p.name, bias: p.bias }));
  const bases = listCategory('base').map((p) => ({ category: 'base' as const, name: p.name, bias: p.bias }));
  return [...personas, ...bases];
}

export function readPersonalityByUri(uri: string): { markdown: string } | null {
  // tekautomate://persona/<name>   or   tekautomate://base/<name>
  const m = uri.match(/^tekautomate:\/\/(persona|base)\/(.+)$/i);
  if (!m) return null;
  const cat: PersonalityCategory = m[1].toLowerCase() === 'base' ? 'base' : 'persona';
  const name = decodeURIComponent(m[2]);
  const r = loadByName(cat, name);
  if (r.ok === true) return { markdown: r.markdown };
  return null;
}
