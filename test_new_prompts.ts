import { smartScpiLookup } from './src/core/smartScpiAssistant';

async function testNewPrompts() {
  console.log('Testing 10 new diverse prompts...\n');
  
  const newPrompts = [
    'set up SPI bus decoding',
    'measure THD distortion', 
    'configure video trigger',
    'enable DVM meter',
    'run FFT analysis',
    'adjust display intensity',
    'save waveform to USB',
    'set timebase to 1ms',
    'create math expression',
    'check error queue status'
  ];

  for (const query of newPrompts) {
    console.log(`--- Testing: "${query}" ---`);
    try {
      const result = await smartScpiLookup({ query });
      const commands = result.data || [];
      const groups = [...new Set(commands.map((c: any) => c.group))];
      
      console.log(`Found: ${commands.length} commands in groups: [${groups.join(', ')}]`);
      
      // Show first few commands
      commands.slice(0, 2).forEach((c: any, i: number) => {
        console.log(`  ${i + 1}. ${c.header} (${c.group})`);
      });
      
      // Check relevance
      const expectedGroups = getExpectedGroups(query);
      const hasExpectedGroup = expectedGroups.some(eg => 
        groups.some(g => g.toLowerCase().includes(eg.toLowerCase()))
      );
      
      if (hasExpectedGroup) {
        console.log('✅ Found relevant command groups');
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
  if (lower.includes('spi') || lower.includes('bus')) return ['Bus', 'Trigger'];
  if (lower.includes('thd') || lower.includes('distortion')) return ['Power', 'Measurement'];
  if (lower.includes('video')) return ['Trigger'];
  if (lower.includes('dvm')) return ['DVM'];
  if (lower.includes('fft') || lower.includes('analysis')) return ['Math'];
  if (lower.includes('display') || lower.includes('intensity')) return ['Display'];
  if (lower.includes('save') || lower.includes('usb')) return ['Save and Recall'];
  if (lower.includes('timebase')) return ['Horizontal'];
  if (lower.includes('math') || lower.includes('expression')) return ['Math'];
  if (lower.includes('error') || lower.includes('queue') || lower.includes('status')) return ['Status and Error'];
  return [];
}

testNewPrompts().catch(console.error);
