import { tekRouter } from './src/core/toolRouter';

async function createAndPersist() {
  console.log('Creating test shortcut...');
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
  
  console.log('Triggering persistence...');
  const { persistRuntimeShortcuts } = await import('./src/core/routerIntegration');
  await persistRuntimeShortcuts();
  console.log('Done!');
}

createAndPersist().catch(console.error);
