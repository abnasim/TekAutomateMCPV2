import { smartScpiLookup } from './src/core/smartScpiAssistant';

async function testFastframe() {
  console.log('Testing FastFrame query...\n');
  
  const result = await smartScpiLookup({ query: 'how to set fastframe' });
  
  console.log('\n=== RESULT ANALYSIS ===');
  console.log('Commands count:', result.data?.length || 0);
  console.log('Has conversationalPrompt:', !!result.conversationalPrompt);
  
  if (result.conversationalPrompt) {
    const prompt = result.conversationalPrompt;
    console.log('Prompt length:', prompt.length);
    console.log('Contains menu:', prompt.includes('What would you like to do?'));
    console.log('Contains menu:', prompt.includes('🎯'));
    
    // Show first 300 chars
    console.log('\nFirst 300 chars of prompt:');
    console.log(prompt.substring(0, 300));
  }
}

testFastframe().catch(console.error);
