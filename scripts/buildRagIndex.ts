import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

type RagCorpus = 'scpi' | 'tmdevices' | 'app_logic' | 'scope_logic' | 'templates' | 'errors' | 'pyvisa_tekhsi';

interface RagChunk extends Record<string, unknown> {
  id: string;
  corpus: RagCorpus;
  title: string;
  body: string;
  tags?: string[];
  source?: string;
  pathHint?: string;
}

interface RagManifest {
  version: string;
  generatedAt: string;
  corpora: Partial<Record<RagCorpus, string>>;
  counts: Partial<Record<RagCorpus, number>>;
}

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const MCP_ROOT = path.resolve(SCRIPT_DIR, '..');
const REPO_ROOT = fs.existsSync(path.join(MCP_ROOT, 'public', 'commands'))
  ? MCP_ROOT
  : path.resolve(MCP_ROOT, '..');
const COMMANDS_DIR = path.join(REPO_ROOT, 'public', 'commands');
const TEMPLATES_DIR = path.join(REPO_ROOT, 'public', 'templates');
const RAG_CORPUS_DIR = path.join(MCP_ROOT, 'rag', 'corpus');
const OUT_DIR = path.join(REPO_ROOT, 'public', 'rag');

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function slugify(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 64);
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function toText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(toText).filter(Boolean).join(' | ');
  if (value && typeof value === 'object') return JSON.stringify(value);
  return '';
}

function extractCommandLikeObjects(
  root: unknown,
  visitor: (obj: Record<string, unknown>, pathParts: string[]) => void,
  pathParts: string[] = []
): void {
  if (Array.isArray(root)) {
    root.forEach((item, idx) => extractCommandLikeObjects(item, visitor, [...pathParts, String(idx)]));
    return;
  }
  if (!root || typeof root !== 'object') return;
  const obj = root as Record<string, unknown>;
  const keys = Object.keys(obj);
  const looksCommandLike =
    keys.some((k) => /command|scpi|syntax|query|set|description|example|parameter/i.test(k)) &&
    (typeof obj.command === 'string' ||
      typeof obj.scpi === 'string' ||
      typeof obj.syntax === 'string' ||
      typeof obj.queryCommand === 'string' ||
      typeof obj.setCommand === 'string');

  if (looksCommandLike) {
    visitor(obj, pathParts);
  }
  keys.forEach((key) => extractCommandLikeObjects(obj[key], visitor, [...pathParts, key]));
}

function buildChunksFromCommandFile(filePath: string, corpus: RagCorpus): RagChunk[] {
  const data = readJson(filePath);
  const fileName = path.basename(filePath);
  const out: RagChunk[] = [];
  let idx = 0;
  extractCommandLikeObjects(data, (obj, pathParts) => {
    const title =
      toText(obj.name) ||
      toText(obj.title) ||
      toText(obj.commandName) ||
      toText(obj.command) ||
      toText(obj.scpi) ||
      pathParts[pathParts.length - 1] ||
      fileName;
    const syntax = [
      toText(obj.scpi),
      toText(obj.command),
      toText(obj.syntax),
      toText(obj.setCommand),
      toText(obj.queryCommand),
      toText(obj.example),
      toText(obj.examples),
    ]
      .filter(Boolean)
      .join('\n');
    const description = toText(obj.description);
    const params = toText(obj.parameters);
    const body = [description, syntax, params]
      .filter(Boolean)
      .join('\n')
      .slice(0, 2200);
    if (!body.trim()) return;
    out.push({
      id: `${slugify(fileName)}_${idx += 1}`,
      corpus,
      title: title.slice(0, 180),
      body,
      tags: [fileName.replace(/\.json$/i, ''), ...pathParts.slice(-4)].map((t) => slugify(t)).filter(Boolean),
      source: `public/commands/${fileName}`,
      pathHint: pathParts.join('.'),
    });
  });
  return out;
}

function parseMarkdownChunks(mdPath: string, corpus: RagCorpus, errorsCorpus = false): RagChunk[] {
  const text = fs.readFileSync(mdPath, 'utf8');
  const normalized = text.replace(/\r\n/g, '\n');
  const sections = normalized.split(/\n(?=#+\s)/g);
  const fileName = path.basename(mdPath);
  const out: RagChunk[] = [];
  sections.forEach((raw, idx) => {
      const lines = raw.split('\n');
      const heading = lines[0]?.match(/^#+\s+(.*)$/)?.[1]?.trim() || `${fileName} section ${idx + 1}`;
      const body = lines.slice(lines[0]?.startsWith('#') ? 1 : 0).join('\n').trim();
      if (!body) return;
      const inferredCorpus: RagCorpus = errorsCorpus || /fail|error|bug|violation|traceback/i.test(`${heading}\n${body}`)
        ? 'errors'
        : corpus;
      const paragraphs = body.split(/\n{2,}/g).map((p) => p.trim()).filter(Boolean);
      let part = 1;
      let current = '';
      const flush = () => {
        const trimmed = current.trim();
        if (!trimmed) return;
        out.push({
          id: `${slugify(fileName)}_${idx + 1}_p${part++}`,
          corpus: inferredCorpus,
          title: heading.slice(0, 180),
          body: trimmed.slice(0, 2400),
          tags: [slugify(fileName)],
          source: path.relative(REPO_ROOT, mdPath).replace(/\\/g, '/'),
        });
        current = '';
      };
      paragraphs.forEach((p) => {
        if ((current + '\n\n' + p).length > 2200) flush();
        current = current ? `${current}\n\n${p}` : p;
      });
      flush();
    });
  return out;
}

function inferCorpusFromPath(filePath: string, fallback: RagCorpus): RagCorpus {
  const normalized = filePath.replace(/\\/g, '/').toLowerCase();
  if (normalized.includes('/error_patterns/')) return 'errors';
  if (normalized.includes('/tmdevices/')) return 'tmdevices';
  if (normalized.includes('/scpi/')) return 'scpi';
  if (normalized.includes('/scope_logic/')) return 'scope_logic';
  if (normalized.includes('/templates/')) return 'templates';
  if (normalized.includes('/pyvisa_tekhsi/')) return 'pyvisa_tekhsi';
  return fallback;
}

function buildChunksFromAiCorpusJson(filePath: string, defaultCorpus: RagCorpus): RagChunk[] {
  const data = readJson(filePath);
  if (!Array.isArray(data)) return [];
  const resolvedCorpus = inferCorpusFromPath(filePath, defaultCorpus);
  return data
    .map((item, idx) => {
      if (!item || typeof item !== 'object') return null;
      const obj = item as Record<string, unknown>;
      const title = toText(obj.title || obj.name || obj.id || `chunk_${idx + 1}`);
      const bodyParts = [
        toText(obj.body),
        toText(obj.symptom),
        toText(obj.root_cause),
        toText(obj.fix),
        toText(obj.description),
        toText(obj.code),
        toText(obj.code_before),
        toText(obj.code_after),
      ].filter(Boolean);
      const body = bodyParts.join('\n').slice(0, 3000);
      if (!body) return null;
      const tags = Array.isArray(obj.tags)
        ? obj.tags.map((t) => slugify(String(t))).filter(Boolean)
        : [];
      const typeTag = toText(obj.type);
      if (typeTag) tags.push(slugify(typeTag));
      return {
        ...obj,
        id: slugify(toText(obj.id) || `${path.basename(filePath, '.json')}_${idx + 1}`),
        corpus: resolvedCorpus,
        title: title.slice(0, 180),
        body,
        tags,
        source: path.relative(REPO_ROOT, filePath).replace(/\\/g, '/'),
      } as RagChunk;
    })
    .filter((c): c is RagChunk => Boolean(c));
}

function listFiles(dir: string, ext: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.toLowerCase().endsWith(ext))
    .map((name) => path.join(dir, name))
    .sort();
}

function listFilesRecursive(dir: string, ext: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      listFilesRecursive(full, ext, out);
    } else if (entry.name.toLowerCase().endsWith(ext)) {
      out.push(full);
    }
  });
  return out.sort();
}

function writeShard(fileName: string, chunks: RagChunk[]): void {
  fs.writeFileSync(path.join(OUT_DIR, fileName), JSON.stringify(chunks, null, 2));
}

function main(): void {
  ensureDir(OUT_DIR);

  const scpiChunks: RagChunk[] = [];
  const tmChunks: RagChunk[] = [];
  const templateChunks: RagChunk[] = [];
  const appLogicChunks: RagChunk[] = [];
  const scopeLogicChunks: RagChunk[] = [];
  const errorChunks: RagChunk[] = [];
  const pyvisaTekhsiChunks: RagChunk[] = [];

  listFiles(COMMANDS_DIR, '.json').forEach((filePath) => {
    const base = path.basename(filePath).toLowerCase();
    if (base.includes('tm_devices')) {
      tmChunks.push(...buildChunksFromCommandFile(filePath, 'tmdevices'));
    } else {
      scpiChunks.push(...buildChunksFromCommandFile(filePath, 'scpi'));
    }
  });

  listFiles(TEMPLATES_DIR, '.json').forEach((filePath) => {
    const json = readJson(filePath);
    const body = JSON.stringify(json).slice(0, 2400);
    templateChunks.push({
      id: `${slugify(path.basename(filePath))}_1`,
      corpus: 'templates',
      title: path.basename(filePath, '.json'),
      body,
      source: `public/templates/${path.basename(filePath)}`,
    });
  });

  listFilesRecursive(RAG_CORPUS_DIR, '.md').forEach((mdPath) => {
    const resolvedCorpus = inferCorpusFromPath(mdPath, 'app_logic');
    const chunks = parseMarkdownChunks(mdPath, resolvedCorpus, resolvedCorpus === 'errors');
    chunks.forEach((chunk) => {
      if (chunk.corpus === 'scpi') scpiChunks.push(chunk);
      else if (chunk.corpus === 'tmdevices') tmChunks.push(chunk);
      else if (chunk.corpus === 'scope_logic') scopeLogicChunks.push(chunk);
      else if (chunk.corpus === 'templates') templateChunks.push(chunk);
      else if (chunk.corpus === 'errors') errorChunks.push(chunk);
      else if (chunk.corpus === 'pyvisa_tekhsi') pyvisaTekhsiChunks.push(chunk);
      else appLogicChunks.push(chunk);
    });
  });

  listFilesRecursive(RAG_CORPUS_DIR, '.json').forEach((jsonPath) => {
    const chunks = buildChunksFromAiCorpusJson(jsonPath, 'app_logic');
    chunks.forEach((chunk) => {
      if (chunk.corpus === 'scpi') scpiChunks.push(chunk);
      else if (chunk.corpus === 'tmdevices') tmChunks.push(chunk);
      else if (chunk.corpus === 'scope_logic') scopeLogicChunks.push(chunk);
      else if (chunk.corpus === 'templates') templateChunks.push(chunk);
      else if (chunk.corpus === 'errors') errorChunks.push(chunk);
      else if (chunk.corpus === 'pyvisa_tekhsi') pyvisaTekhsiChunks.push(chunk);
      else appLogicChunks.push(chunk);
    });
  });

  writeShard('scpi_index.json', scpiChunks);
  writeShard('tmdevices_index.json', tmChunks);
  writeShard('templates_index.json', templateChunks);
  writeShard('app_logic_index.json', appLogicChunks);
  writeShard('scope_logic_index.json', scopeLogicChunks);
  writeShard('errors_index.json', errorChunks);
  writeShard('pyvisa_tekhsi_index.json', pyvisaTekhsiChunks);

  const manifest: RagManifest = {
    version: '1.0.0',
    generatedAt: new Date().toISOString(),
    corpora: {
      scpi: 'scpi_index.json',
      tmdevices: 'tmdevices_index.json',
      app_logic: 'app_logic_index.json',
      scope_logic: 'scope_logic_index.json',
      templates: 'templates_index.json',
      errors: 'errors_index.json',
      pyvisa_tekhsi: 'pyvisa_tekhsi_index.json',
    },
    counts: {
      scpi: scpiChunks.length,
      tmdevices: tmChunks.length,
      app_logic: appLogicChunks.length,
      scope_logic: scopeLogicChunks.length,
      templates: templateChunks.length,
      errors: errorChunks.length,
      pyvisa_tekhsi: pyvisaTekhsiChunks.length,
    },
  };
  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));

  // eslint-disable-next-line no-console
  console.log(`RAG shards generated in public/rag (scpi=${scpiChunks.length}, tmdevices=${tmChunks.length}, app_logic=${appLogicChunks.length}, scope_logic=${scopeLogicChunks.length}, templates=${templateChunks.length}, errors=${errorChunks.length}, pyvisa_tekhsi=${pyvisaTekhsiChunks.length})`);
}

main();
