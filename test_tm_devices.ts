#!/usr/bin/env node

/**
 * Test script for tm_devices search functionality
 */

import { searchTmDevices } from './src/tools/searchTmDevices.js';

async function testTmDevices() {
  console.log('=== Testing tm_devices Search ===\n');
  
  const testQueries = [
    'setup oscilloscope',
    'configure trigger',
    'acquire waveform',
    'measurement frequency',
    'bus decode i2c',
    'spectrum analysis',
    'save screenshot'
  ];

  for (const query of testQueries) {
    console.log(`--- Testing: "${query}" ---`);
    const startTime = Date.now();
    
    try {
      const result = await searchTmDevices({ query });
      const totalTime = Date.now() - startTime;
      
      console.log(`✅ Success (${totalTime}ms)`);
      console.log(`Found ${result.data.length} results`);
      
      if (result.data.length > 0) {
        console.log('Top results:');
        result.data.slice(0, 3).forEach((item, i) => {
          if (typeof item === 'object' && item !== null) {
            console.log(`  ${i+1}. ${item.name || item.method || 'Unknown'}`);
            if (item.description) console.log(`     ${item.description.slice(0, 100)}...`);
            if (item.signature) console.log(`     Signature: ${item.signature}`);
            if (item.module) console.log(`     Module: ${item.module}`);
          } else {
            console.log(`  ${i+1}. ${String(item)}`);
          }
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
testTmDevices();
