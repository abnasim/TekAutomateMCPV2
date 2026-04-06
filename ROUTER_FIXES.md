# MCP Router Enhancement Plan

## Problems Identified
1. Router disabled by default (MCP_ROUTER_ENABLED not documented)
2. Provider matching thresholds too high (0.5/0.75)
3. Limited knowledge base integration
4. AI over-training on specific patterns
5. Router not properly integrated with main tool loop

## Immediate Fixes

### 1. Enable Router by Default
**File: `src/core/routerIntegration.ts`**
```typescript
function isRouterEnabled(): boolean {
  // Enable router by default, allow explicit disable
  const disabled = String(process.env.MCP_ROUTER_DISABLED || '').trim() === 'true';
  return !disabled;
}
```

### 2. Lower Provider Matching Thresholds
**File: `src/core/providerMatcher.ts`**
```typescript
const MIN_HINT_SCORE = 0.3;    // Was 0.5
const MIN_OVERRIDE_SCORE = 0.6; // Was 0.75
```

### 3. Enhance Router with RAG Integration
**File: `src/core/toolRouter.ts`**
```typescript
// Add RAG search to router search
async function handleSearch(req: RouterRequest, startedAt: number): Promise<RouterResponse> {
  // ... existing code ...
  
  // Add RAG results to search
  const ragResults = await searchRagChunks(req.query, { limit: 3 });
  const combinedHits = await combineToolAndRAGResults(hits, ragResults);
  
  return {
    ok: true,
    action: 'search',
    results: combinedHits.map((hit) => serializeHit(hit, req.debug === true)),
    // ...
  };
}
```

### 4. Improve Provider Matching Algorithm
**File: `src/core/providerMatcher.ts`**
```typescript
// Add fuzzy matching and semantic similarity
function scoreEntry(
  entry: ProviderSupplementEntry,
  query: string,
  context: ProviderMatchContext
): Omit<ProviderMatchResult, 'decision' | 'overrideThreshold'> | null {
  // ... existing code ...
  
  // Add semantic similarity boost
  const semanticBoost = calculateSemanticSimilarity(query, entry.description);
  const fuzzyMatchBoost = calculateFuzzyMatch(query, entry.triggers);
  
  const score = Math.min(
    1,
    keywordStats.score * 0.45 +      // Was 0.55
      operationStats.score * 0.25 +
      compatible +
      nameScore +
      semanticBoost * 0.1 +         // New
      fuzzyMatchBoost * 0.05 +       // New
      priorityBoost(entry)
  );
  
  // ... rest of function ...
}
```

### 5. Update Environment Configuration
**File: `.env.example`**
```bash
# MCP Router Configuration
# MCP_ROUTER_DISABLED=true  # Set to true to disable router (enabled by default)
# MCP_ROUTER_MIN_HINT_SCORE=0.3
# MCP_ROUTER_MIN_OVERRIDE_SCORE=0.6
# MCP_SEMANTIC_ENABLED=true
# MCP_SEMANTIC_PROVIDER=ollama  # or openai
```

### 6. Integrate Router with Main Tool Loop
**File: `src/core/toolLoop.ts`**
```typescript
// Add router fallback in toolLoop
async function runToolLoop(request: McpChatRequest): Promise<ToolLoopResult> {
  // ... existing deterministic checks ...
  
  // Add router search before AI path
  if (isRouterEnabled()) {
    const routerResults = await tekRouter({
      action: 'search_exec',
      query: request.userMessage,
      context: request.flowContext,
      limit: 3
    });
    
    if (routerResults.ok && routerResults.data) {
      // Use router result instead of AI
      return {
        text: routerResults.text,
        displayText: routerResults.text,
        // ... other fields
      };
    }
  }
  
  // ... continue with AI path if router fails ...
}
```

## Provider Enhancement Strategy

### 1. Add More Diverse Providers
Create providers for:
- Common troubleshooting patterns
- Error resolution workflows  
- Device-specific gotchas
- Measurement interpretation guides

### 2. Improve Provider Metadata
```json
{
  "id": "scope-trigger-troubleshooting",
  "triggers": [
    "trigger not working",
    "why no trigger",
    "trigger miss",
    "can't trigger",
    "trigger setup problem"
  ],
  "match": {
    "keywords": [
      "trigger troubleshooting",
      "trigger miss",
      "trigger setup",
      "trigger threshold"
    ],
    "operations": [
      "diagnose trigger",
      "fix trigger",
      "configure trigger"
    ],
    "minScore": 0.4  // Lower threshold for troubleshooting
  }
}
```

### 3. Add Context-Aware Matching
```typescript
// Consider execution context in matching
function scoreEntry(
  entry: ProviderSupplementEntry,
  query: string,
  context: ProviderMatchContext
) {
  // ... existing scoring ...
  
  // Boost providers that match current execution context
  if (context.selectedStepId && entry.context?.stepTypes?.includes(context.selectedStepId)) {
    score += 0.1;
  }
  
  // Boost providers that match error context
  if (context.lastError && entry.context?.errorPatterns?.some(pattern => 
    context.lastError?.includes(pattern)
  )) {
    score += 0.15;
  }
}
```

## Testing Strategy

### 1. Router Effectiveness Tests
```bash
# Test router with edge cases
npm run eval:router -- --case-filter="edge_case"

# Test provider matching
npm run eval:provider -- --query-variations
```

### 2. Add Edge Case Test Bank
**File: `tests/edge_cases.json`**
```json
[
  {
    "query": "my scope won't trigger",
    "expectedProvider": "scope-trigger-troubleshooting",
    "minScore": 0.6
  },
  {
    "query": "weird measurement values",
    "expectedProvider": "measurement-interpretation-guide",
    "minScore": 0.5
  }
]
```

## Implementation Priority

1. **High Priority**: Enable router by default, lower thresholds
2. **Medium Priority**: Add RAG integration, improve matching algorithm  
3. **Low Priority**: Context-aware matching, semantic search

## Expected Outcomes

- **Router handles 60-70%** of requests that currently fall through
- **Provider matching** catches more edge cases and variations
- **Reduced AI dependency** for common patterns
- **Better handling** of user queries outside training patterns
