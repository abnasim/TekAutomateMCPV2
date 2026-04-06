import { smartScpiLookup } from './src/core/smartScpiAssistant';

async function testBoldSyntax() {
  console.log('Testing bold syntax...\n');
  
  const result = await smartScpiLookup({ query: 'HORizontal:MODE:SCAle' });
  
  if (result.conversationalPrompt) {
    const prompt = result.conversationalPrompt;
    
    // Find and show the syntax section
    const syntaxStart = prompt.indexOf('**⚙️ Syntax:**');
    if (syntaxStart !== -1) {
      const syntaxSection = prompt.substring(syntaxStart, syntaxStart + 200);
      console.log('Syntax section:');
      console.log(syntaxSection);
    }
  }
}

testBoldSyntax().catch(console.error);
