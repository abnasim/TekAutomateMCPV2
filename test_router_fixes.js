#!/usr/bin/env node

/**
 * Quick test script to verify router improvements
 * Run with: node test_router_fixes.js
 */

import { bootRouter, createRouterHandler, getRouterHealth } from './dist/core/routerIntegration.js';
import { matchProviderSupplement, findProviderSupplementMatches } from './dist/core/providerMatcher.js';

async function testRouterFixes() {
  console.log('=== Testing MCP Router Fixes ===\n');
  
  // 1. Test router health
  console.log('1. Checking router health...');
  try {
    const health = getRouterHealth();
    console.log('Router Health:', JSON.stringify(health, null, 2));
    console.log('✓ Router enabled:', health.enabled);
    console.log('✓ Total tools:', health.totalTools);
  } catch (err) {
    console.error('✗ Router health check failed:', err.message);
  }
  
  console.log('\n2. Testing provider matching with lowered thresholds...');
  
  // Test edge cases that should now match
  const testQueries = [
    'my scope won\'t trigger',
    'weird measurement values', 
    'can\'t connect to instrument',
    'trigger not working properly',
    'measurement accuracy issues'
  ];
  
  // Mock provider data (similar to edge-cases.json)
  const mockProviders = [
    {
      id: 'scope-trigger-troubleshooting',
      name: 'Scope Trigger Troubleshooting',
      description: 'Comprehensive troubleshooting guide for oscilloscope trigger issues',
      triggers: ['trigger not working', 'why no trigger', 'trigger miss'],
      tags: ['scope', 'trigger', 'troubleshooting'],
      match: {
        keywords: ['trigger troubleshooting', 'trigger miss'],
        operations: ['diagnose trigger', 'fix trigger'],
        backends: ['pyvisa'],
        deviceTypes: ['SCOPE'],
        priority: 5,
        minScore: 0.4
      },
      kind: 'template',
      backend: 'pyvisa',
      deviceType: 'SCOPE'
    }
  ];
  
  for (const query of testQueries) {
    console.log(`\nTesting query: "${query}"`);
    
    // Test provider matching
    const match = matchProviderSupplement(mockProviders, query, {
      backend: 'pyvisa',
      deviceType: 'SCOPE'
    });
    
    if (match) {
      console.log(`✓ Matched provider: ${match.entry.name}`);
      console.log(`  Score: ${match.score} (threshold: ${match.overrideThreshold})`);
      console.log(`  Decision: ${match.decision}`);
    } else {
      console.log('✗ No provider match found');
      
      // Try finding multiple matches
      const matches = findProviderSupplementMatches(mockProviders, query, {
        limit: 3,
        minScore: 0.3
      });
      
      if (matches.length > 0) {
        console.log(`Found ${matches.length} lower-confidence matches:`);
        matches.forEach((m, i) => {
          console.log(`  ${i+1}. ${m.entry.name} (score: ${m.score})`);
        });
      }
    }
  }
  
  console.log('\n3. Testing router search functionality...');
  
  try {
    // Test router search
    const searchResult = await createRouterHandler({
      action: 'search',
      query: 'trigger troubleshooting',
      limit: 5,
      debug: true
    });
    
    console.log('Router search result:', JSON.stringify(searchResult, null, 2));
    
    if (searchResult.ok && searchResult.results?.length > 0) {
      console.log(`✓ Found ${searchResult.results.length} tools`);
      searchResult.results.forEach((tool, i) => {
        console.log(`  ${i+1}. ${tool.name} (score: ${tool.score})`);
      });
    } else {
      console.log('✗ No router search results');
    }
  } catch (err) {
    console.error('✗ Router search failed:', err.message);
  }
  
  console.log('\n=== Test Complete ===');
}

// Check if this is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  testRouterFixes().catch(console.error);
}

export { testRouterFixes };
