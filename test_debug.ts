import { smartScpiLookup } from './src/core/smartScpiAssistant';

async function testDebug() {
  console.log('Testing debug...\n');
  
  const result = await smartScpiLookup({ query: 'HORizontal:MODE:SCAle' });
  
  console.log('\n=== RESULT ANALYSIS ===');
  console.log('Commands count:', result.data?.length || 0);
  console.log('Has conversationalPrompt:', !!result.conversationalPrompt);
  
  if (result.conversationalPrompt) {
    const prompt = result.conversationalPrompt;
    console.log('Prompt length:', prompt.length);
    console.log('Contains menu:', prompt.includes('What would you like to do?'));
    console.log('Contains menu:', prompt.includes('🎯'));
    
    // Show last 200 chars
    console.log('\nLast 200 chars of prompt:');
    console.log(prompt.substring(Math.max(0, prompt.length - 200)));
  }
}

testDebug().catch(console.error);
