#!/usr/bin/env node

/**
 * Test conversational hierarchy in Smart SCPI Assistant
 */

import { smartScpiLookup } from './src/core/smartScpiAssistant.js';

async function testConversationalHierarchy() {
  console.log('=== Testing Conversational Hierarchy ===\n');
  
  const testQueries = [
    'configure trigger',      // Broad - should offer trigger types
    'setup bus',              // Broad - should offer protocols  
    'edge trigger',          // Specific - should give commands
    'i2c bus trigger'        // Specific - should give commands
  ];

  for (const query of testQueries) {
    console.log(`--- Testing: "${query}" ---`);
    const startTime = Date.now();
    
    try {
      const result = await smartScpiLookup({ query });
      const totalTime = Date.now() - startTime;
      
      console.log(`✅ Success (${totalTime}ms)`);
      console.log(`Found ${result.data.length} commands`);
      
      // Access the formatted result from the assistant
      const assistant = await import('./src/core/smartScpiAssistant.js');
      const SmartScpiAssistant = assistant.SmartScpiAssistant;
      const smartAssistant = new SmartScpiAssistant();
      
      // Get the internal result with conversational data
      const internalResult = await smartAssistant.smartLookup({ query });
      const formatted = smartAssistant.formatResults(internalResult);
      
      // Show conversational prompt if available
      if (formatted.conversationalPrompt) {
        console.log('\n🤖 Conversational Response:');
        console.log(formatted.conversationalPrompt);
      }
      
      // Show trigger types if available
      if (formatted.triggerTypes && formatted.triggerTypes.length > 0) {
        console.log('\n🎯 Available Trigger Types:');
        formatted.triggerTypes.forEach((type: string) => console.log(`  - ${type}`));
      }
      
      // Show bus protocols if available
      if (formatted.busProtocols && formatted.busProtocols.length > 0) {
        console.log('\n🔌 Available Bus Protocols:');
        formatted.busProtocols.forEach((proto: string) => console.log(`  - ${proto}`));
      }
      
      // Show top commands if specific query
      if (!formatted.conversationalPrompt && result.data.length > 0) {
        console.log('\n📋 Top Commands:');
        result.data.slice(0, 3).forEach((cmd, i) => {
          console.log(`  ${i+1}. ${cmd.header}`);
          console.log(`     ${cmd.shortDescription}`);
        });
      }
      
    } catch (err) {
      console.log(`❌ Error: ${err instanceof Error ? err.message : String(err)}`);
    }
    
    console.log('\n' + '='.repeat(60) + '\n');
  }
}

// Run if executed directly
testConversationalHierarchy();
