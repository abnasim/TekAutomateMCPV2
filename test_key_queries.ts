import { smartScpiLookup } from './src/core/smartScpiAssistant';

async function testKeyQueries() {
  console.log('Testing key queries that were failing before the fix...\n');
  
  const queries = [
    'measure voltage on channel 1',
    'add jitter measurement',
    'configure i2c bus analysis',
    'setup ethernet trigger',
    'show detailed results',
    'add math channel',
    'save screenshot',
    'clear measurements',
  ];

  for (const query of queries) {
    console.log(`--- Testing: "${query}" ---`);
    try {
      const result = await smartScpiLookup({ query });
      const commands = result.data || [];
      const groups = [...new Set(commands.map((c: any) => c.group))];
      
      console.log(`Found: ${commands.length} commands in groups: [${groups.join(', ')}]`);
      
      // Show first few commands
      commands.slice(0, 3).forEach((c: any, i: number) => {
        console.log(`  ${i + 1}. ${c.header} (${c.group})`);
      });
      
      // Check if we're getting relevant groups
      const expectedGroups = getExpectedGroups(query);
      const hasExpectedGroup = expectedGroups.some(eg => 
        groups.some(g => g.toLowerCase().includes(eg.toLowerCase()))
      );
      
      if (hasExpectedGroup) {
        console.log('✅ Found expected command groups');
      } else {
        console.log(`⚠️  Expected groups like [${expectedGroups.join(', ')}] but got [${groups.join(', ')}]`);
      }
      
    } catch (error) {
      console.log(`❌ Error: ${error}`);
    }
    console.log('');
  }
}

function getExpectedGroups(query: string): string[] {
  const lower = query.toLowerCase();
  if (lower.includes('voltage') || lower.includes('measure') || lower.includes('measurement')) {
    return ['Measurement'];
  }
  if (lower.includes('jitter')) {
    return ['Measurement'];
  }
  if (lower.includes('i2c') || lower.includes('bus')) {
    return ['Bus', 'Trigger'];
  }
  if (lower.includes('ethernet')) {
    return ['Bus', 'Trigger', 'Ethernet'];
  }
  if (lower.includes('results')) {
    return ['Measurement'];
  }
  if (lower.includes('math')) {
    return ['Math'];
  }
  if (lower.includes('screenshot') || lower.includes('save')) {
    return ['Save and Recall'];
  }
  if (lower.includes('clear')) {
    return ['Measurement'];
  }
  return [];
}

testKeyQueries().catch(console.error);
