import { getToolRegistry } from './src/core/toolRegistry';
import { loadRuntimeShortcuts } from './src/core/routerIntegration';

async function testLoading() {
  console.log('=== Testing Shortcut Loading ===');
  
  const registry = getToolRegistry();
  
  // Check if test shortcut exists
  const exists = registry.has('shortcut:persistence_test');
  console.log('Test shortcut exists before load:', exists ? '✅ YES' : '❌ NO');
  
  if (exists) {
    // Remove it to simulate fresh start
    registry.unregister('shortcut:persistence_test');
    console.log('✅ Removed test shortcut from registry');
  }
  
  // Now load from file
  console.log('Loading shortcuts from file...');
  await loadRuntimeShortcuts();
  
  // Check if it was loaded
  const loaded = registry.has('shortcut:persistence_test');
  console.log('Test shortcut exists after load:', loaded ? '✅ YES' : '❌ NO');
  
  if (loaded) {
    const tool = registry.get('shortcut:persistence_test');
    console.log('✅ Shortcut details:');
    console.log('  Name:', tool?.name);
    console.log('  Steps:', tool?.steps?.length);
  }
}

testLoading().catch(console.error);
