#!/usr/bin/env node

/**
 * Test script to verify provider supplement loading and matching
 */

import { initProviderCatalog, getProviderCatalog } from './src/core/providerCatalog.js';
import { matchProviderSupplement, findProviderSupplementMatches } from './src/core/providerMatcher.js';

async function testProviderSupplements() {
  console.log('=== Testing Provider Supplement Catalog ===\n');
  
  try {
    // Initialize the provider supplement catalog
    console.log('Initializing provider catalog...');
    await initProviderCatalog();
    
    const catalog = await getProviderCatalog();
    const entries = catalog.all();
    console.log(`Loaded ${entries.length} provider supplement entries\n`);
    
    // Find our spectrumview providers
    const spectrumviewProviders = entries.filter(p => 
      p.id.includes('spectrumview') || p.name.includes('SpectrumView')
    );
    
    console.log('SpectrumView provider supplements found:');
    spectrumviewProviders.forEach(provider => {
      console.log(`- ${provider.id}: ${provider.name}`);
      console.log(`  Kind: ${provider.kind}`);
      console.log(`  Category: ${provider.category}`);
      console.log(`  Backend: ${provider.backend}`);
      console.log(`  Device Type: ${provider.deviceType}`);
      console.log(`  Triggers: [${provider.triggers.slice(0, 3).join(', ')}...]`);
      console.log(`  Priority: ${provider.match.priority}`);
      console.log(`  Min Score: ${provider.match.minScore}`);
      console.log(`  Has Steps: ${provider.steps.length > 0}`);
      console.log('');
    });
    
    // Test matching with different queries
    const testQueries = [
      'spectrumview peak analysis',
      'spectrum view markers',
      'rf spectrum analysis',
      'spectrumview setup',
      'specturmview analysis',
      'spectrum analysis'
    ];
    
    for (const query of testQueries) {
      console.log(`Testing query: "${query}"`);
      
      const match = matchProviderSupplement(entries, query, {
        backend: 'pyvisa',
        deviceType: 'SCOPE'
      });
      
      if (match) {
        console.log('✓ Match found:');
        console.log(`  Provider: ${match.entry.name} (${match.entry.id})`);
        console.log(`  Kind: ${match.entry.kind}`);
        console.log(`  Score: ${match.score}`);
        console.log(`  Decision: ${match.decision}`);
        console.log(`  Override Threshold: ${match.overrideThreshold}`);
        console.log(`  Should override: ${match.score >= match.overrideThreshold}`);
        console.log(`  Matched keywords: [${match.matchedKeywords.join(', ')}]`);
        console.log(`  Matched operations: [${match.matchedOperations.join(', ')}]`);
      } else {
        console.log('✗ No match found');
        
        // Try finding multiple matches
        const matches = findProviderSupplementMatches(entries, query, {
          limit: 3,
          minScore: 0.3
        });
        
        if (matches.length > 0) {
          console.log(`Found ${matches.length} lower-confidence matches:`);
          matches.forEach((m, i) => {
            console.log(`  ${i+1}. ${m.entry.name} (${m.entry.kind}) - score: ${m.score}`);
          });
        }
      }
      console.log('');
    }
    
  } catch (err) {
    console.error('Error:', err instanceof Error ? err.message : String(err));
    if (err instanceof Error) {
      console.error('Stack:', err.stack);
    }
  }
}

// Run if executed directly
testProviderSupplements();
