#!/usr/bin/env node

/**
 * Test tm_devices with proper docstrings and materializer
 */

import { searchTmDevices } from './src/tools/searchTmDevices.js';
import { materializeTmDevicesCall } from './src/tools/materializeTmDevicesCall.js';

async function testTmDevicesProper() {
  console.log('=== Testing tm_devices with Rich Docstrings ===\n');
  
  const testQueries = [
    'configure trigger edge',
    'setup bus i2c decode', 
    'acquire waveform',
    'measurement frequency harmonics',
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
        console.log('Top results with full docstrings:');
        result.data.slice(0, 2).forEach((item: any, i: number) => {
          console.log(`  ${i+1}. ${item.signature || 'Unknown'}`);
          if (item.description) console.log(`     Description: ${item.description.slice(0, 150)}...`);
          if (item.usageExample) console.log(`     Usage: ${item.usageExample.slice(0, 100)}...`);
          if (item.modelRoot) console.log(`     Model: ${item.modelRoot}`);
          if (item.methodPath) console.log(`     Path: ${item.methodPath}`);
        });
        
        // Test materialization of first result
        if (result.data[0] && result.data[0].methodPath) {
          console.log('\n  Materializing first result:');
          try {
            const matResult = await materializeTmDevicesCall({
              methodPath: result.data[0].methodPath,
              model: result.data[0].modelRoot?.replace(/Commands$/, '')
            });
            if (matResult.ok && matResult.data) {
              const data = matResult.data as any;
              console.log(`     ✅ Materialized: ${data.example || data.scpi || 'No example'}`);
              if (data.description) console.log(`     ${data.description.slice(0, 100)}...`);
            }
          } catch (matErr) {
            console.log(`     ❌ Materialization failed: ${matErr}`);
          }
        }
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
testTmDevicesProper();
