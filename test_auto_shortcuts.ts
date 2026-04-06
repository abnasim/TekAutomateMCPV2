// Test cases for Phase 2: Auto-Shortcut System

import { tekRouter } from './src/core/toolRouter';

async function testShortcutCreation() {
  console.log('=== Testing Auto-Shortcut Creation ===');
  
  // Test 1: Create a simple shortcut
  const createResult = await tekRouter({
    action: 'create',
    toolId: 'shortcut:test_jitter',
    toolName: 'Test Jitter Setup',
    toolDescription: 'Add TJ measurement on CH1 with results enabled',
    toolTriggers: ['jitter test', 'add jitter', 'tj measurement', 'test jitter'],
    toolTags: ['measurement', 'jitter', 'tj', 'test'],
    toolCategory: 'shortcut',
    toolSteps: [
      { type: 'write', params: { command: 'MEASUrement:ADDMEAS TJ' } },
      { type: 'write', params: { command: 'MEASUrement:MEAS1:SOUrce CH1' } },
      { type: 'write', params: { command: 'MEASUrement:RESUlts:CURRentacq:ENABle ON' } }
    ]
  });
  
  console.log('Create result:', createResult.ok ? '✅ SUCCESS' : '❌ FAILED');
  if (!createResult.ok) {
    console.log('Error:', createResult.error);
  }
  
  // Test 2: Search for the shortcut
  const searchResult = await tekRouter({
    action: 'search',
    query: 'jitter test'
  });
  
  console.log('Search result:', searchResult.ok ? '✅ FOUND' : '❌ NOT FOUND');
  if (searchResult.ok && searchResult.data) {
    const results = searchResult.data as any[];
    console.log('Found shortcuts:', results.length);
    const testShortcut = results.find(r => r.id === 'shortcut:test_jitter');
    console.log('Test shortcut found:', testShortcut ? '✅ YES' : '❌ NO');
  }
  
  // Test 3: Execute the shortcut
  const execResult = await tekRouter({
    action: 'exec',
    toolId: 'shortcut:test_jitter',
    args: {}
  });
  
  console.log('Exec result:', execResult.ok ? '✅ SUCCESS' : '❌ FAILED');
  if (!execResult.ok) {
    console.log('Error:', execResult.error);
  }
  
  // Test 4: Clean up
  const deleteResult = await tekRouter({
    action: 'delete',
    toolId: 'shortcut:test_jitter'
  });
  
  console.log('Delete result:', deleteResult.ok ? '✅ SUCCESS' : '❌ FAILED');
}

async function testShortcutPersistence() {
  console.log('\n=== Testing Shortcut Persistence ===');
  
  // Create a shortcut
  await tekRouter({
    action: 'create',
    toolId: 'shortcut:persistence_test',
    toolName: 'Persistence Test',
    toolDescription: 'Test shortcut for persistence',
    toolTriggers: ['persistence test'],
    toolTags: ['test'],
    toolCategory: 'shortcut',
    toolSteps: [
      { type: 'write', params: { command: 'TEST:COMMAND1' } },
      { type: 'write', params: { command: 'TEST:COMMAND2' } }
    ]
  });
  
  console.log('✅ Created test shortcut');
  console.log('📝 Check data/runtime_shortcuts.json file after server restart');
  console.log('🔄 Restart server and run this test again to verify loading');
}

// Run tests
testShortcutCreation()
  .then(() => testShortcutPersistence())
  .catch(console.error);
