#!/usr/bin/env node

/**
 * Test script for Smart SCPI Assistant
 */

import { smartScpiLookup } from './src/core/smartScpiAssistant.js';
import { getCommandIndex } from './src/core/commandIndex.js';

async function testSmartAssistant() {
  console.log('=== Testing Smart SCPI Assistant ===\n');
  
  // First check if command index has data
  console.log('--- Checking Command Index ---');
  const index = await getCommandIndex();
  const busResults = index.searchByQuery('bus', undefined, 5);
  console.log(`Command index has ${busResults.length} bus results`);
  
  if (busResults.length > 0) {
    console.log('Sample bus commands:');
    busResults.slice(0, 2).forEach((cmd, i) => {
      console.log(`  ${i+1}. ${cmd.header}: ${cmd.shortDescription}`);
    });
  }
  console.log('');
  
  const testQueries = [
    'what is the command to setup bus',
    'I want to add power measurement with harmonics',
    'configure trigger for edge detection',
    'measurement frequency analysis',
    'spectrumview peak analysis'
  ];

  for (const query of testQueries) {
    console.log(`--- Testing: "${query}" ---`);
    const startTime = Date.now();
    
    try {
      const result = await smartScpiLookup({ query });
      const totalTime = Date.now() - startTime;
      
      console.log(`✅ Success (${totalTime}ms)`);
      console.log(`Found ${result.data.length} commands`);
      
      if (result.data.length > 0) {
        console.log('Top commands:');
        result.data.slice(0, 2).forEach((cmd, i) => {
          console.log(`  ${i+1}. ${cmd.header}`);
          console.log(`     Description: ${cmd.description}`);
          console.log(`     Short: ${cmd.shortDescription}`);
          console.log(`     Group: ${cmd.group} | Category: ${cmd.category}`);
          console.log(`     Type: ${cmd.commandType} | Families: ${cmd.families.join(', ')}`);
          console.log(`     Arguments: ${cmd.arguments.length} parameters`);
          if (cmd.arguments.length > 0) {
            console.log(`     Args: ${cmd.arguments.slice(0, 2).map(a => `${a.name} (${a.type})`).join(', ')}`);
          }
          console.log(`     Usage: ${cmd.usage}`);
          console.log(`     Full entry keys: ${Object.keys(cmd.fullEntry).join(', ')}`);
        });
      }
      
      if (result.sourceMeta.length > 0) {
        console.log('Metadata:');
        result.sourceMeta.forEach(meta => {
          console.log(`  ${meta.section}: ${meta.commandId}`);
        });
      }
      
      if (result.warnings.length > 0) {
        console.log('Warnings:', result.warnings);
      }
      
    } catch (err) {
      console.log(`❌ Error: ${err instanceof Error ? err.message : String(err)}`);
    }
    
    console.log('');
  }
}

// Run if executed directly
testSmartAssistant();
