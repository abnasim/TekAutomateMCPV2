import { smartScpiLookup } from './src/core/smartScpiAssistant';

async function testMathChannel() {
  console.log('Testing "add math channel"...\n');
  
  const result = await smartScpiLookup({ query: 'add math channel' });
  
  console.log('\n=== RESULT ANALYSIS ===');
  console.log('Commands count:', result.data?.length || 0);
  
  if (result.data && result.data.length > 0) {
    console.log('\nCommand groups found:');
    result.data.forEach((cmd: any, i: number) => {
      console.log(`  ${i+1}. ${cmd.header} - Group: ${cmd.group}`);
    });
  }
}

testMathChannel().catch(console.error);
