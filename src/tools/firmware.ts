/**
 * firmware — static lookup of current Tektronix scope firmware versions.
 *
 * Stopgap until the firmware release-notes RAG corpus is built. Reads the
 * manually-curated <projectRoot>/data/firmware_latest.json and resolves a
 * caller's family/model hint to the corresponding entry. When no hint is
 * given (or the hint doesn't match), returns all families so the caller
 * has enough info to figure out which one applies.
 *
 * Exposed via knowledge{action:"firmware", family?: "MSO2" | "MSO24" | ...}.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { ToolResult } from '../core/schemas';

const _projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIRMWARE_PATH = path.join(_projectRoot, 'data', 'firmware_latest.json');

interface FamilyEntry {
  displayName?: string;
  models?: string[];
  latest?: string;
  variant?: string;
  releaseNotesUrl?: string;
  windowsUrl?: string;
  productSupportUrl?: string;
  releaseDate?: string;
  notes?: string;
}

interface FirmwareStore {
  $schema?: string;
  note?: string;
  lastUpdated?: string;
  updateProcedure?: string;
  families: Record<string, FamilyEntry>;
}

interface FirmwareInput extends Record<string, unknown> {
  family?: unknown;
  model?: unknown;
  modelFamily?: unknown;
}

function readStore(): FirmwareStore | null {
  try {
    const raw = fs.readFileSync(FIRMWARE_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.families) return parsed as FirmwareStore;
    return null;
  } catch {
    return null;
  }
}

// Normalize common user/agent hints to a family key. Accepts raw family
// names ("MSO2", "mso6"), model numbers ("MSO24", "MSO44B"), and verbose
// forms ("2 Series MSO"). Case-insensitive.
function resolveFamily(store: FirmwareStore, hint: string): string | null {
  const norm = hint.trim().toLowerCase();
  if (!norm) return null;
  // Exact family key match
  for (const key of Object.keys(store.families)) {
    if (key.toLowerCase() === norm) return key;
  }
  // Model number match (MSO24 → MSO2, MSO44B → MSO4, etc.)
  for (const [key, entry] of Object.entries(store.families)) {
    const models = (entry.models || []).map((m) => m.toLowerCase());
    if (models.includes(norm)) return key;
  }
  // Display-name substring match ("2 Series MSO" → MSO2)
  for (const [key, entry] of Object.entries(store.families)) {
    const dn = (entry.displayName || '').toLowerCase();
    if (dn && (dn.includes(norm) || norm.includes(dn))) return key;
  }
  // Loose prefix match on key (mso24 → MSO2, mso66b → MSO6)
  for (const key of Object.keys(store.families)) {
    if (norm.startsWith(key.toLowerCase())) return key;
  }
  return null;
}

export async function getFirmware(input: FirmwareInput): Promise<ToolResult<unknown>> {
  const store = readStore();
  if (!store) {
    return {
      ok: false,
      data: {
        error: 'STORE_UNAVAILABLE',
        message: `Firmware snapshot file not found or unreadable at ${FIRMWARE_PATH}. The feature ships a curated JSON; if it's missing, the deploy is incomplete.`,
      },
      sourceMeta: [],
      warnings: ['firmware_latest.json missing on this deployment'],
    };
  }

  const hint = [input.family, input.model, input.modelFamily]
    .find((v) => typeof v === 'string' && (v as string).trim());

  if (typeof hint === 'string' && hint.trim()) {
    const key = resolveFamily(store, hint);
    if (key) {
      return {
        ok: true,
        data: {
          family: key,
          ...store.families[key],
          lastUpdated: store.lastUpdated,
          _hint: 'This is a manually-curated snapshot, not a live pull from tek.com. For the authoritative current version, verify against releaseNotesUrl. For full changelog content, fetch that URL directly — it is NOT indexed in the tek_docs RAG corpus.',
        },
        sourceMeta: [{ file: FIRMWARE_PATH }],
        warnings: [],
      };
    }
    // Unresolved hint — return full list with an explanation instead of null.
    return {
      ok: true,
      data: {
        hintReceived: hint,
        hintResolved: false,
        message: `Could not resolve "${hint}" to a known family. Returning all families so you can pick. Known families: ${Object.keys(store.families).join(', ')}.`,
        families: store.families,
        lastUpdated: store.lastUpdated,
        note: store.note,
      },
      sourceMeta: [{ file: FIRMWARE_PATH }],
      warnings: [`Unresolved family hint: "${hint}"`],
    };
  }

  // No hint — return all.
  return {
    ok: true,
    data: {
      families: store.families,
      lastUpdated: store.lastUpdated,
      note: store.note,
    },
    sourceMeta: [{ file: FIRMWARE_PATH }],
    warnings: [],
  };
}
