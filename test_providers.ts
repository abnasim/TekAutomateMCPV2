#!/usr/bin/env node

/**
 * Test script to verify provider loading
 */

import { loadProviderManifests } from './src/core/providerLoader.js';
import { resolveProvidersDir } from './src/core/paths.js';
import { matchProviderSupplement } from './src/core/providerMatcher.js';

async function testProviders() {
  console.log('=== Testing Provider Loading ===\n');
  
  try {
    const providersDir = resolveProvidersDir();
    console.log('Providers directory:', providersDir);
    
    const providers = await loadProviderManifests(providersDir);
    console.log(`Loaded ${providers.length} providers\n`);
    
    // Find our spectrumview providers
    const spectrumviewProviders = providers.filter(p => 
      p.id.includes('spectrumview') || p.name.includes('SpectrumView')
    );
    
    console.log('SpectrumView providers found:');
    spectrumviewProviders.forEach(provider => {
      console.log(`- ${provider.id}: ${provider.name}`);
      console.log(`  Kind: ${provider.kind}`);
      console.log(`  Category: ${provider.category}`);
      console.log(`  Triggers: [${provider.triggers?.slice(0, 3).join(', ')}...]`);
      console.log(`  Priority: ${provider.match?.priority}`);
      console.log(`  Min Score: ${provider.match?.minScore}`);
      console.log('');
    });
    
    // Test matching
    const testQuery = 'spectrumview peak analysis';
    console.log(`Testing query: "${testQuery}"`);
    
    const match = matchProviderSupplement(providers, testQuery, {
      backend: 'pyvisa',
      deviceType: 'SCOPE'
    });
    
    if (match) {
      console.log('✓ Match found:');
      console.log(`  Provider: ${match.entry.name} (${match.entry.id})`);
      console.log(`  Score: ${match.score}`);
      console.log(`  Decision: ${match.decision}`);
      console.log(`  Override Threshold: ${match.overrideThreshold}`);
      console.log(`  Should override: ${match.score >= match.overrideThreshold}`);
    } else {
      console.log('✗ No match found');
    }
    
  } catch (err) {
    console.error('Error:', err.message);
    console.error('Stack:', err.stack);
  }
}

// Run if executed directly
testProviders();
