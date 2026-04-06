import { smartScpiLookup } from './src/core/smartScpiAssistant';

async function testMathVariations() {
  const queries = [
    'add math channel',
    'math channel',
    'create math',
    'math expression',
    'fft'
  ];

  for (const query of queries) {
    console.log(`\n=== Testing: "${query}" ===`);
    
    const result = await smartScpiLookup({ query });
    
    if (result.data && result.data.length > 0) {
      const groups = [...new Set(result.data.map((cmd: any) => cmd.group))];
      console.log(`Groups found: [${groups.join(', ')}]`);
      
      // Check for any non-Math groups
      const nonMathGroups = groups.filter(g => g !== 'Math');
      if (nonMathGroups.length > 0) {
        console.log('❌ LEAKING GROUPS FOUND:');
        result.data.forEach((cmd: any, i: number) => {
          if (cmd.group !== 'Math') {
            console.log(`  ${i+1}. ${cmd.header} - Group: ${cmd.group} ❌`);
          }
        });
      } else {
        console.log('✅ All commands in Math group only');
      }
    }
  }
}

testMathVariations().catch(console.error);
