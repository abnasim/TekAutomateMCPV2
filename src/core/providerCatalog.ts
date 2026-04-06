import { promises as fs } from 'fs';
import * as path from 'path';
import type { ProviderManifestTool } from './providerLoader';
import { resolveProvidersDir } from './paths';

export interface ProviderSupplementMatchConfig {
  keywords?: string[];
  backends?: string[];
  deviceTypes?: string[];
  modelFamilies?: string[];
  operations?: string[];
  priority?: number;
  minScore?: number;
}

export interface ProviderSupplementManifestTool extends ProviderManifestTool {
  author?: string;
  version?: string;
  tested?: boolean;
  match?: ProviderSupplementMatchConfig;
}

export type ProviderSupplementKind = 'template' | 'overlay';

export interface ProviderSupplementEntry {
  providerId: string;
  id: string;
  name: string;
  description: string;
  sourceFile: string;
  kind: ProviderSupplementKind;
  handlerRef: string;
  category?: string;
  backend: string;
  deviceType: string;
  steps: Array<Record<string, unknown>>;
  triggers: string[];
  tags: string[];
  author?: string;
  version?: string;
  tested?: boolean;
  summary?: string;
  contextText?: string;
  contextData?: unknown;
  match: ProviderSupplementMatchConfig;
}

export class ProviderCatalog {
  private readonly entries: ProviderSupplementEntry[];

  constructor(entries: ProviderSupplementEntry[]) {
    this.entries = entries;
  }

  all(): ProviderSupplementEntry[] {
    return [...this.entries];
  }
}

function uniqueStrings(values: unknown[]): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => String(value || '').trim())
        .filter(Boolean)
    )
  );
}

function toMatchConfig(raw: unknown): ProviderSupplementMatchConfig {
  const record = raw && typeof raw === 'object'
    ? (raw as Record<string, unknown>)
    : {};
  const priority = Number(record.priority);
  const minScore = Number(record.minScore);
  return {
    keywords: uniqueStrings(Array.isArray(record.keywords) ? record.keywords : []),
    backends: uniqueStrings(Array.isArray(record.backends) ? record.backends : []),
    deviceTypes: uniqueStrings(Array.isArray(record.deviceTypes) ? record.deviceTypes : []),
    modelFamilies: uniqueStrings(Array.isArray(record.modelFamilies) ? record.modelFamilies : []),
    operations: uniqueStrings(Array.isArray(record.operations) ? record.operations : []),
    ...(Number.isFinite(priority) ? { priority } : {}),
    ...(Number.isFinite(minScore) ? { minScore } : {}),
  };
}

function resolveSteps(
  tool: ProviderSupplementManifestTool
): Array<Record<string, unknown>> {
  if (Array.isArray(tool.steps)) {
    return tool.steps.filter(
      (item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object'
    );
  }
  const handlerConfig =
    tool.handlerConfig && typeof tool.handlerConfig === 'object'
      ? (tool.handlerConfig as Record<string, unknown>)
      : {};
  const configured = Array.isArray(handlerConfig.steps) ? handlerConfig.steps : [];
  return configured.filter(
    (item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object'
  );
}

function isValidProviderTool(tool: ProviderSupplementManifestTool): boolean {
  const id = String(tool.id || '').trim();
  const name = String(tool.name || '').trim();
  const description = String(tool.description || '').trim();
  return Boolean(id) && !/\s/.test(id) && Boolean(name) && description.length >= 10;
}

function toProviderEntry(
  tool: ProviderSupplementManifestTool,
  providerId: string,
  sourceFile: string
): ProviderSupplementEntry | null {
  if (!isValidProviderTool(tool)) return null;

  const handlerRef = String(tool.handlerRef || '').trim();
  if (!handlerRef) return null;

  const steps = resolveSteps(tool);
  const handlerConfig =
    tool.handlerConfig && typeof tool.handlerConfig === 'object'
      ? (tool.handlerConfig as Record<string, unknown>)
      : {};
  const kind: ProviderSupplementKind =
    handlerRef === 'flow_template' && steps.length
      ? 'template'
      : 'overlay';
  const match = toMatchConfig(tool.match);
  const explicitBackend = String(handlerConfig.backend || match.backends?.[0] || '').trim();
  const explicitDeviceType = String(handlerConfig.deviceType || match.deviceTypes?.[0] || '').trim();
  const summary =
    typeof handlerConfig.summary === 'string' && handlerConfig.summary.trim()
      ? String(handlerConfig.summary).trim()
      : undefined;
  const contextText =
    typeof handlerConfig.text === 'string' && handlerConfig.text.trim()
      ? String(handlerConfig.text).trim()
      : summary;

  return {
    providerId,
    id: String(tool.id || providerId).trim(),
    name: String(tool.name || tool.id || providerId).trim(),
    description: String(tool.description || '').trim(),
    sourceFile,
    kind,
    handlerRef,
    ...(tool.category ? { category: String(tool.category).trim() } : {}),
    backend: kind === 'template' ? (explicitBackend || 'pyvisa') : explicitBackend,
    deviceType: kind === 'template' ? (explicitDeviceType || 'SCOPE') : explicitDeviceType,
    steps,
    triggers: uniqueStrings([
      ...(Array.isArray(tool.triggers) ? tool.triggers : []),
      tool.name,
      tool.id,
    ]),
    tags: uniqueStrings(Array.isArray(tool.tags) ? tool.tags : []),
    ...(typeof tool.author === 'string' && tool.author.trim() ? { author: tool.author.trim() } : {}),
    ...(typeof tool.version === 'string' && tool.version.trim() ? { version: tool.version.trim() } : {}),
    ...(typeof tool.tested === 'boolean' ? { tested: tool.tested } : {}),
    ...(summary ? { summary } : {}),
    ...(contextText ? { contextText } : {}),
    ...(typeof handlerConfig.data !== 'undefined' ? { contextData: handlerConfig.data } : {}),
    match,
  };
}

function resolveProviderSupplementsDir(customDir?: string): string {
  const envDir = String(process.env.MCP_PROVIDER_SUPPLEMENTS_DIR || '').trim();
  return resolveProvidersDir(envDir || customDir);
}

let _providerCatalogPromise: Promise<ProviderCatalog> | null = null;
let _providerCatalogKey = '';

export function providerSupplementsEnabled(): boolean {
  const flag = String(process.env.MCP_PROVIDER_SUPPLEMENTS || '').trim().toLowerCase();
  return !['false', '0', 'off', 'no'].includes(flag);
}

export function providerSupplementsEnabledForMode(outputMode: string): boolean {
  // Always enable provider supplements for chat mode (AI-powered conversations)
  if (outputMode === 'chat') {
    return true;
  }
  
  // For build modes (steps_json, blockly_xml), use the global setting
  return providerSupplementsEnabled();
}

export async function loadProviderCatalog(options?: {
  providersDir?: string;
}): Promise<ProviderCatalog> {
  const providersDir = resolveProviderSupplementsDir(options?.providersDir);
  let files: string[] = [];
  try {
    files = (await fs.readdir(providersDir)).filter((file) => file.endsWith('.json'));
  } catch {
    files = [];
  }

  const entries: ProviderSupplementEntry[] = [];
  for (const file of files) {
    try {
      const raw = await fs.readFile(path.join(providersDir, file), 'utf8');
      const manifest = JSON.parse(raw) as unknown;
      if (!Array.isArray(manifest)) continue;
      const providerId = path.basename(file, '.json');
      for (const item of manifest) {
        if (!item || typeof item !== 'object') continue;
        const entry = toProviderEntry(item as ProviderSupplementManifestTool, providerId, file);
        if (entry) entries.push(entry);
      }
    } catch {
      // Skip malformed provider files.
    }
  }

  return new ProviderCatalog(entries);
}

export async function initProviderCatalog(options?: {
  providersDir?: string;
}): Promise<ProviderCatalog> {
  const key = resolveProviderSupplementsDir(options?.providersDir);
  if (_providerCatalogPromise && _providerCatalogKey === key) return _providerCatalogPromise;
  _providerCatalogKey = key;
  _providerCatalogPromise = loadProviderCatalog({ providersDir: key });
  return _providerCatalogPromise;
}

export async function getProviderCatalog(): Promise<ProviderCatalog> {
  return initProviderCatalog();
}

export function resetProviderCatalog(): void {
  _providerCatalogPromise = null;
  _providerCatalogKey = '';
}
