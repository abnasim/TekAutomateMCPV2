#!/usr/bin/env node

/**
 * Test trigger search in both SCPI and tm_devices
 */

import { searchScpi } from './src/tools/searchScpi.js';
import { searchTmDevices } from './src/tools/searchTmDevices.js';
import { smartScpiLookup } from './src/core/smartScpiAssistant.js';

async function testTriggerSearch() {
  console.log('=== Testing Trigger Search Comparison ===\n');
  
  const query = 'configure trigger';
  
  console.log('--- 1. Smart SCPI Assistant ---');
  const scpiStart = Date.now();
  try {
    const scpiResult = await smartScpiLookup({ query });
    const scpiTime = Date.now() - scpiStart;
    console.log(`✅ SCPI: ${scpiTime}ms, ${scpiResult.data.length} results`);
    scpiResult.data.slice(0, 3).forEach((cmd, i) => {
      console.log(`  ${i+1}. ${cmd.header}`);
      console.log(`     ${cmd.shortDescription}`);
    });
  } catch (err) {
    console.log(`❌ SCPI Error: ${err}`);
  }
  
  console.log('\n--- 2. Regular SCPI Search ---');
  const regularScpiStart = Date.now();
  try {
    const regularResult = await searchScpi({ query });
    const regularTime = Date.now() - regularScpiStart;
    console.log(`✅ Regular SCPI: ${regularTime}ms, ${regularResult.data.length} results`);
    if (Array.isArray(regularResult.data)) {
      regularResult.data.slice(0, 3).forEach((cmd: any, i: number) => {
        console.log(`  ${i+1}. ${cmd.header || 'Unknown'}`);
        if (cmd.shortDescription) console.log(`     ${cmd.shortDescription}`);
      });
    }
  } catch (err) {
    console.log(`❌ Regular SCPI Error: ${err}`);
  }
  
  console.log('\n--- 3. tm_devices Search ---');
  const tmStart = Date.now();
  try {
    const tmResult = await searchTmDevices({ query });
    const tmTime = Date.now() - tmStart;
    console.log(`✅ tm_devices: ${tmTime}ms, ${tmResult.data.length} results`);
    tmResult.data.slice(0, 3).forEach((item: any, i: number) => {
      console.log(`  ${i+1}. ${item.signature || 'Unknown'}`);
      if (item.description) console.log(`     ${item.description.slice(0, 100)}...`);
    });
  } catch (err) {
    console.log(`❌ tm_devices Error: ${err}`);
  }
  
  console.log('\n--- Analysis ---');
  console.log('Smart SCPI Assistant should return proper TRIGger commands like:');
  console.log('- TRIGger:A:EDGE:LEVel');
  console.log('- TRIGger:A:SLOpe'); 
  console.log('- TRIGger:A:SOUrce');
  console.log('NOT DPOJET noise commands!');
}

// Run if executed directly
testTriggerSearch();
