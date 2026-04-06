import { persistRuntimeShortcuts } from './src/core/routerIntegration';

persistRuntimeShortcuts().then(() => console.log('Persistence complete')).catch(console.error);
