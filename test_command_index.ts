#!/usr/bin/env node

/**
 * Test script to verify command index loading
 */

import { initCommandIndex, getCommandIndex } from './src/core/commandIndex.js';

async function testCommandIndex() {
  console.log('=== Testing Command Index ===\n');
  
  try {
    console.log('Initializing command index...');
    const index = await initCommandIndex();
    
    // Test search for bus commands
    console.log('\n--- Searching for "bus" commands ---');
    const busResults = index.searchByQuery('bus', undefined, 5);
    console.log(`Found ${busResults.length} bus commands:`);
    busResults.forEach((result, i) => {
      console.log(`  ${i+1}. ${result.commandId}: ${result.header}`);
      console.log(`     Description: ${result.shortDescription.slice(0, 100)}...`);
    });
    
    // Test search for power measurement
    console.log('\n--- Searching for "power measurement" commands ---');
    const powerResults = index.searchByQuery('power measurement', undefined, 5);
    console.log(`Found ${powerResults.length} power measurement commands:`);
    powerResults.forEach((result, i) => {
      console.log(`  ${i+1}. ${result.commandId}: ${result.header}`);
      console.log(`     Description: ${result.shortDescription.slice(0, 100)}...`);
    });
    
    // Test search for trigger
    console.log('\n--- Searching for "trigger" commands ---');
    const triggerResults = index.searchByQuery('trigger', undefined, 5);
    console.log(`Found ${triggerResults.length} trigger commands:`);
    triggerResults.forEach((result, i) => {
      console.log(`  ${i+1}. ${result.commandId}: ${result.header}`);
      console.log(`     Description: ${result.shortDescription.slice(0, 100)}...`);
    });
    
  } catch (err) {
    console.error('Error:', err instanceof Error ? err.message : String(err));
    if (err instanceof Error) {
      console.error('Stack:', err.stack);
    }
  }
}

// Run if executed directly
testCommandIndex();
