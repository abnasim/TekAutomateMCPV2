import { Bm25Index, type Bm25Doc } from './bm25';
import {
  type ToolRegistry,
  type MicroTool,
  type ToolCategory,
  type ToolSearchHit,
  getToolRegistry,
} from './toolRegistry';
import { getSemanticSearchEngine } from './semanticSearch';
import { classifyIntent } from './intentMap';

interface SearchDoc extends Bm25Doc {
  toolId: string;
  category: ToolCategory;
  usageCount: number;
  successCount: number;
  failureCount: number;
}

export interface ToolSearchOptions {
  limit?: number;
  categories?: ToolCategory[];
  minScore?: number;
  usageBoostFactor?: number;
  recencyWindowMs?: number;
  recencyBoost?: number;
  semanticEnabled?: boolean;
}

const DEFAULT_LIMIT = 5;
const DEFAULT_MIN_SCORE = 0.1;
const DEFAULT_RECENCY_WINDOW_MS = 60 * 60 * 1000;
const DEFAULT_RECENCY_BOOST = 0.5;
const TRIGGER_WEIGHT = 3.0;
const BM25_WEIGHT = 1.0;
const SEMANTIC_WEIGHT = 2.0;
const USAGE_WEIGHT = 0.5;
const SUCCESS_RATE_WEIGHT = 1.0;

export class ToolSearchEngine {
  private registry: ToolRegistry;
  private bm25Index: Bm25Index<SearchDoc> | null = null;
  private lastIndexSize = 0;

  constructor(registry?: ToolRegistry) {
    this.registry = registry || getToolRegistry();
  }

  rebuildIndex(): void {
    const docs: SearchDoc[] = this.registry.exportForSearch().map((entry) => ({
      id: entry.id,
      text: entry.text,
      toolId: entry.id,
      category: entry.category,
      usageCount: entry.usageCount,
      successCount: entry.successCount,
      failureCount: entry.failureCount,
    }));
    this.bm25Index = new Bm25Index<SearchDoc>(docs);
    this.lastIndexSize = this.registry.size();
  }

  private ensureIndex(): void {
    if (!this.bm25Index || this.registry.size() !== this.lastIndexSize) {
      this.rebuildIndex();
    }
  }

  async search(query: string, options?: ToolSearchOptions): Promise<ToolSearchHit[]> {
    const limit = options?.limit ?? DEFAULT_LIMIT;
    const minScore = options?.minScore ?? DEFAULT_MIN_SCORE;
    const recencyWindowMs = options?.recencyWindowMs ?? DEFAULT_RECENCY_WINDOW_MS;
    const recencyBoost = options?.recencyBoost ?? DEFAULT_RECENCY_BOOST;
    const categoryFilter = options?.categories ? new Set(options.categories) : null;
    const semanticEngine = getSemanticSearchEngine();
    const semanticEnabled = options?.semanticEnabled ?? semanticEngine.isEnabled();

    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return [];

    // ── Intent-based group awareness for scpi_lookup tools ──
    const intent = classifyIntent(query);
    const intentGroups = intent.groups;
    const intentGroupSet = new Set(intentGroups.map(g => g.toLowerCase()));

    // Check triggers: exact full query match, then individual words
    let triggerHits = this.registry.lookupByTrigger(normalizedQuery);
    if (triggerHits.length === 0) {
      const words = normalizedQuery.split(/\s+/).filter((w) => w.length >= 3);
      const seen = new Set<string>();
      for (const word of words) {
        for (const tool of this.registry.lookupByTrigger(word)) {
          if (!seen.has(tool.id)) { seen.add(tool.id); triggerHits.push(tool); }
        }
      }
    }
    const filteredTriggerHits = categoryFilter
      ? triggerHits.filter((tool) => categoryFilter.has(tool.category))
      : triggerHits;

    if (filteredTriggerHits.length > 0) {
      return filteredTriggerHits
        .map((tool) => {
          const usage = this.scoreBoosts(tool, recencyWindowMs, recencyBoost);
          // Builtin MCP tools get a strong boost so they auto-execute via search_exec
          // (threshold is 5.0, trigger base is 3.0, so builtins need +4.0 to clear it)
          const builtinBoost = tool.id.startsWith('builtin:') ? 4.0 : 0;
          return {
            tool,
            score: TRIGGER_WEIGHT + usage.total + builtinBoost,
            matchStage: 'trigger' as const,
            debug: {
              usageBoost: usage.usageBoost,
              successRate: usage.successRate,
              recencyBoost: usage.recencyBoost,
              builtinBoost,
            },
          };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
    }

    this.ensureIndex();
    if (!this.bm25Index) return [];

    const bm25Results = this.bm25Index.search(normalizedQuery, Math.max(limit * 4, 24));
    const hits: ToolSearchHit[] = [];
    const byId = new Map<string, ToolSearchHit>();

    for (const result of bm25Results) {
      if (result.score < minScore) continue;
      const tool = this.registry.get(result.doc.toolId);
      if (!tool) continue;
      if (categoryFilter && !categoryFilter.has(tool.category)) continue;

      // ── Group boost/penalty for scpi_lookup tools ──
      let groupBoost = 0;
      if (intentGroupSet.size > 0 && tool.category === 'scpi_lookup') {
        const toolInTargetGroup = tool.tags.some(tag => intentGroupSet.has(tag.toLowerCase()));
        if (toolInTargetGroup) {
          groupBoost = 5.0;   // Strong boost for tools in the right group
        } else if (intent.confidence === 'high') {
          groupBoost = -2.0;  // Penalize out-of-group tools when intent is confident
        }
      }

      const usage = this.scoreBoosts(tool, recencyWindowMs, recencyBoost);
      const hit: ToolSearchHit = {
        tool,
        score: result.score * BM25_WEIGHT + usage.total + groupBoost,
        matchStage: 'keyword',
        debug: {
          bm25Score: result.score,
          usageBoost: usage.usageBoost,
          successRate: usage.successRate,
          recencyBoost: usage.recencyBoost,
          groupBoost,
        },
      };
      hits.push(hit);
      byId.set(tool.id, hit);
    }

    if (semanticEnabled) {
      const semanticHits = await semanticEngine.search(
        normalizedQuery,
        categoryFilter
          ? this.registry.all().filter((tool) => categoryFilter.has(tool.category))
          : this.registry.all(),
        Math.max(limit * 2, 10)
      );
      for (const semanticHit of semanticHits) {
        const existing = byId.get(semanticHit.toolId);
        if (existing) {
          const bm25Base = existing.debug?.bm25Score ?? 0;
          const triggerBase = existing.matchStage === 'trigger' ? 1 : 0;
          const usageBase = existing.debug?.usageBoost ?? 0;
          const recencyBase = existing.debug?.recencyBoost ?? 0;
          const successRate = existing.debug?.successRate ?? 0.5;
          existing.score =
            triggerBase * TRIGGER_WEIGHT +
            bm25Base * BM25_WEIGHT +
            semanticHit.score * SEMANTIC_WEIGHT +
            usageBase +
            successRate * SUCCESS_RATE_WEIGHT +
            recencyBase;
          existing.matchStage = existing.matchStage === 'trigger' ? 'trigger' : 'semantic';
          existing.debug = {
            ...(existing.debug || {}),
            semanticScore: semanticHit.score,
          };
          continue;
        }
        const tool = this.registry.get(semanticHit.toolId);
        if (!tool) continue;
        const usage = this.scoreBoosts(tool, recencyWindowMs, recencyBoost);
        hits.push({
          tool,
          score: semanticHit.score * SEMANTIC_WEIGHT + usage.total,
          matchStage: 'semantic',
          debug: {
            semanticScore: semanticHit.score,
            usageBoost: usage.usageBoost,
            successRate: usage.successRate,
            recencyBoost: usage.recencyBoost,
          },
        });
      }
    }

    return hits.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  async searchCompound(query: string, options?: ToolSearchOptions): Promise<ToolSearchHit[]> {
    const limit = options?.limit ?? DEFAULT_LIMIT;
    const single = await this.search(query, { ...options, limit: limit * 2 });
    if (single.length >= limit && single[0]?.score > 5) return single.slice(0, limit);

    const segments = query
      .split(/\b(?:and|then|also|plus|,)\b/gi)
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 3);

    if (segments.length <= 1) return single.slice(0, limit);

    const seen = new Set<string>();
    const merged: ToolSearchHit[] = [];
    for (const segment of segments) {
      const hits = await this.search(segment, { ...options, limit: 3 });
      for (const hit of hits) {
        if (seen.has(hit.tool.id)) continue;
        seen.add(hit.tool.id);
        merged.push(hit);
      }
    }

    for (const hit of single) {
      if (seen.has(hit.tool.id)) continue;
      seen.add(hit.tool.id);
      merged.push(hit);
    }

    return merged.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  private scoreBoosts(
    tool: MicroTool,
    recencyWindowMs: number,
    recencyBoost: number
  ): { total: number; usageBoost: number; successRate: number; recencyBoost: number } {
    const usageBoost = Math.log2(tool.usageCount + 1) * USAGE_WEIGHT;
    const executionTotal = tool.successCount + tool.failureCount;
    const successRate =
      executionTotal > 0 ? tool.successCount / executionTotal : 0.5;
    const recencyBonus =
      tool.lastUsedAt && Date.now() - tool.lastUsedAt < recencyWindowMs ? recencyBoost : 0;
    return {
      total: usageBoost + successRate * SUCCESS_RATE_WEIGHT + recencyBonus,
      usageBoost,
      successRate,
      recencyBoost: recencyBonus,
    };
  }
}

let _engine: ToolSearchEngine | null = null;

export function getToolSearchEngine(): ToolSearchEngine {
  if (!_engine) _engine = new ToolSearchEngine();
  return _engine;
}

export function resetToolSearchEngine(): ToolSearchEngine {
  _engine = new ToolSearchEngine();
  return _engine;
}
