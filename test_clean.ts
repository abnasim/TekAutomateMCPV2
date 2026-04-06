import { smartScpiLookup } from './src/core/smartScpiAssistant';

async function testCleanOutput() {
  console.log('Testing clean output for exact command...\n');
  
  const result = await smartScpiLookup({ query: 'HORizontal:MODE:SCAle' });
  console.log(result.conversationalPrompt || 'No prompt');
}

testCleanOutput().catch(console.error);
