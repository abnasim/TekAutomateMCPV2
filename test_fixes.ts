import { smartScpiLookup } from './src/core/smartScpiAssistant';

async function testFixes() {
  console.log('Testing the fixes...\n');
  
  const testCases = [
    'set horizontal scale 10000',
    'HORizontal:MODE:SCAle',
    'set channel scale 0.5',
    'set trigger level 1.5'
  ];

  for (const query of testCases) {
    console.log(`--- Testing: "${query}" ---`);
    try {
      const result = await smartScpiLookup({ query });
      const commands = result.data || [];
      const groups = [...new Set(commands.map((c: any) => c.group))];
      
      console.log(`Found: ${commands.length} commands in groups: [${groups.join(', ')}]`);
      
      if (commands.length === 1) {
        const cmd = commands[0];
        console.log(`✅ Single command: ${cmd.header}`);
        if (result.conversationalPrompt) {
          console.log('Direct response (no menu):');
          console.log(result.conversationalPrompt.substring(0, 200) + '...');
        }
      } else {
        commands.slice(0, 3).forEach((c: any, i: number) => {
          console.log(`  ${i + 1}. ${c.header} (${c.group})`);
        });
      }
      
    } catch (error) {
      console.log(`❌ Error: ${error}`);
    }
    console.log('');
  }
}

testFixes().catch(console.error);
