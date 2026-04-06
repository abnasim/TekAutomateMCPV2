import { promises as fs } from 'fs';
import * as path from 'path';
import { Bm25Index } from './bm25';
import { resolveTemplatesDir } from './paths';

export interface TemplateDoc {
  id: string;
  name: string;
  description: string;
  steps: unknown[];
  sourceFile: string;
  text: string;
}

export class TemplateIndex {
  private readonly docs: TemplateDoc[];
  private readonly bm25: Bm25Index<TemplateDoc>;

  constructor(docs: TemplateDoc[]) {
    this.docs = docs;
    this.bm25 = new Bm25Index(docs);
  }

  search(query: string, limit = 5): TemplateDoc[] {
    return this.bm25.search(query, limit).map((r) => r.doc);
  }

  all(): TemplateDoc[] {
    return [...this.docs];
  }
}

let _templatePromise: Promise<TemplateIndex> | null = null;

export async function initTemplateIndex(options?: {
  templatesDir?: string;
}): Promise<TemplateIndex> {
  if (_templatePromise) return _templatePromise;
  _templatePromise = (async () => {
    const templatesDir = options?.templatesDir || resolveTemplatesDir();
    let files: string[] = [];
    try {
      files = (await fs.readdir(templatesDir)).filter((f) => f.endsWith('.json'));
    } catch {
      files = [];
    }
    const docs: TemplateDoc[] = [];
    for (const file of files) {
      try {
        const raw = await fs.readFile(path.join(templatesDir, file), 'utf8');
        const json = JSON.parse(raw) as Record<string, unknown>;
        const name = String(json.name || file.replace('.json', ''));
        const description = String(json.description || '');
        const steps = Array.isArray(json.steps) ? json.steps : [];
        docs.push({
          id: `${file}:${name}`,
          name,
          description,
          steps,
          sourceFile: file,
          text: `${name} ${description} ${JSON.stringify(steps).slice(0, 4000)}`,
        });
      } catch {
        // skip malformed template file
      }
    }
    return new TemplateIndex(docs);
  })();
  return _templatePromise;
}

export async function getTemplateIndex(): Promise<TemplateIndex> {
  return initTemplateIndex();
}
