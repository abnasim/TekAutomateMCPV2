import type { MicroTool } from './toolRegistry';

export interface SemanticSearchProvider {
  embed(texts: string[]): Promise<number[][]>;
}

export interface SemanticSearchHit {
  toolId: string;
  score: number;
}

function dotProduct(matrix: Float32Array, offset: number, vector: number[]): number {
  let dot = 0;
  for (let i = 0; i < vector.length; i += 1) {
    dot += matrix[offset + i] * vector[i];
  }
  return dot;
}

function vectorNorm(vector: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < vector.length; i += 1) {
    sum += vector[i] * vector[i];
  }
  return Math.sqrt(sum);
}

export class OllamaEmbedder implements SemanticSearchProvider {
  private readonly host: string;
  private readonly model: string;

  constructor(host?: string, model?: string) {
    this.host = host || process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
    this.model = model || process.env.MCP_SEMANTIC_MODEL || 'nomic-embed-text';
  }

  async embed(texts: string[]): Promise<number[][]> {
    // FIX BUG-011: Add timeout and retry logic to prevent server blocking
    const TIMEOUT_MS = 5000;  // 5 second timeout per request
    const MAX_RETRIES = 2;
    const results: number[][] = [];

    for (const text of texts) {
      let lastError: Error | null = null;

      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

          const response = await fetch(`${this.host}/api/embeddings`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: this.model,
              prompt: text,
            }),
            signal: controller.signal,
          });

          clearTimeout(timeoutId);

          if (!response.ok) {
            throw new Error(`Ollama embeddings request failed with status ${response.status}`);
          }

          const json = (await response.json()) as { embedding?: number[] };
          if (!Array.isArray(json.embedding) || json.embedding.length === 0) {
            throw new Error('Ollama embeddings response did not include a valid embedding array.');
          }

          results.push(json.embedding);
          break;  // Success - move to next text
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));

          if (attempt < MAX_RETRIES - 1) {
            // Exponential backoff: 1s, 2s, etc.
            await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
          }
        }
      }

      if (lastError) {
        throw new Error(`Ollama embeddings failed for text after ${MAX_RETRIES} attempts: ${lastError.message}`);
      }
    }

    return results;
  }
}

export class SemanticSearchEngine {
  private readonly provider: SemanticSearchProvider;
  private toolIds: string[] = [];
  private toolIdSet = new Set<string>();
  private matrix = new Float32Array(0);
  private norms = new Float32Array(0);
  private dimensions = 0;
  private enabled = String(process.env.MCP_SEMANTIC_ENABLED || '').trim() === 'true';
  private indexedAt = 0;

  constructor(provider?: SemanticSearchProvider) {
    this.provider = provider || new OllamaEmbedder();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getIndexedToolCount(): number {
    return this.toolIds.length;
  }

  async prepareIndex(tools: MicroTool[]): Promise<boolean> {
    if (!this.enabled) return false;

    try {
      // FIX BUG-002: Always clear old data first to prevent memory leaks
      this.matrix = new Float32Array(0);
      this.norms = new Float32Array(0);
      this.toolIds = [];
      this.toolIdSet.clear();
      this.dimensions = 0;
      this.indexedAt = 0;

      if (!tools.length) {
        return true;  // Cleared successfully
      }

      const texts = tools.map((tool) => [tool.name, tool.description, ...tool.tags, ...tool.triggers].join(' '));
      const vectors = await this.provider.embed(texts);
      if (!vectors.length) {
        console.warn('[SemanticSearch] Empty embedding result');
        return false;
      }

      const dimensions = vectors[0].length;
      const matrixSize = vectors.length * dimensions;
      const matrix = new Float32Array(matrixSize);
      const norms = new Float32Array(vectors.length);

      for (let i = 0; i < vectors.length; i += 1) {
        const vector = vectors[i];
        if (vector.length !== dimensions) {
          throw new Error('Embedding dimension mismatch while building semantic index.');
        }

        for (let j = 0; j < dimensions; j += 1) {
          matrix[i * dimensions + j] = vector[j];
        }
        norms[i] = vectorNorm(vector);
      }

      this.matrix = matrix;
      this.norms = norms;
      this.toolIds = tools.map((t) => t.id);
      this.toolIdSet = new Set(this.toolIds);
      this.dimensions = dimensions;
      this.indexedAt = Date.now();

      return true;
    } catch (error) {
      console.error('[SemanticSearch] Index preparation failed:', error);

      // IMPORTANT: Clean up on error to prevent partial state
      this.matrix = new Float32Array(0);
      this.norms = new Float32Array(0);
      this.toolIds = [];
      this.toolIdSet.clear();
      this.dimensions = 0;
      this.indexedAt = 0;

      return false;
    }
  }

  async ensureIndexed(tools: MicroTool[]): Promise<boolean> {
    if (!this.enabled) return false;
    const sameIds =
      tools.length === this.toolIds.length &&
      tools.every((tool) => this.toolIdSet.has(tool.id));

    if (!sameIds || !this.matrix.length || !this.indexedAt) {
      return this.prepareIndex(tools);
    }

    return true;
  }

  async search(query: string, tools: MicroTool[], limit = 5): Promise<SemanticSearchHit[]> {
    const ready = await this.ensureIndexed(tools);
    if (!ready || !this.dimensions) return [];

    try {
      const [queryVector] = await this.provider.embed([query]);
      if (!queryVector || queryVector.length !== this.dimensions) return [];
      const queryNorm = vectorNorm(queryVector);
      if (!queryNorm) return [];

      const allowed = new Set(tools.map((tool) => tool.id));
      const hits: SemanticSearchHit[] = [];

      for (let row = 0; row < this.toolIds.length; row += 1) {
        const toolId = this.toolIds[row];
        if (!allowed.has(toolId)) continue;
        const denominator = queryNorm * this.norms[row];
        if (!denominator) continue;
        const offset = row * this.dimensions;
        const score = dotProduct(this.matrix, offset, queryVector) / denominator;
        if (score > 0) {
          hits.push({ toolId, score });
        }
      }

      return hits.sort((a, b) => b.score - a.score).slice(0, limit);
    } catch {
      return [];
    }
  }
}

let semanticSingleton: SemanticSearchEngine | null = null;

export function getSemanticSearchEngine(): SemanticSearchEngine {
  if (!semanticSingleton) semanticSingleton = new SemanticSearchEngine();
  return semanticSingleton;
}

export function resetSemanticSearchEngine(): SemanticSearchEngine {
  semanticSingleton = new SemanticSearchEngine();
  return semanticSingleton;
}
