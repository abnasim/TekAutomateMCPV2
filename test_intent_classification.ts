import { classifyIntent } from './src/core/intentMap';

// Test cases from the implementation plan
const TEST_CASES = [
  // Previously failing queries
  { query: 'how do I measure voltage', expectedGroups: ['Measurement'], expectedIntent: 'measurement' },
  { query: 'configure the channel', expectedGroups: ['Measurement'], expectedIntent: 'vertical' },
  { query: 'add jitter measurement', expectedGroups: ['Measurement'], expectedIntent: 'measurement' },
  { query: 'setup ethernet trigger', expectedGroups: ['Bus', 'Trigger'], expectedIntent: 'bus' },
  { query: 'configure i2c bus analysis', expectedGroups: ['Bus', 'Trigger'], expectedIntent: 'bus' },
  { query: 'show detailed results', expectedGroups: ['Measurement'], expectedIntent: 'measurement' },
  { query: 'add math channel', expectedGroups: ['Math'], expectedIntent: 'math' },
  { query: 'clear measurements', expectedGroups: ['Measurement'], expectedIntent: 'measurement' },
  { query: 'save screenshot', expectedGroups: ['Save and Recall'], expectedIntent: 'save' },
  { query: 'what is sampling rate', expectedGroups: ['Acquisition', 'Horizontal'], expectedIntent: 'acquisition' },

  // Real user queries
  { query: 'measure voltage on channel 1', expectedGroups: ['Measurement'], expectedIntent: 'measurement' },
  { query: 'add eye diagram measurement', expectedGroups: ['Measurement'], expectedIntent: 'measurement' },
  { query: 'set CH1 scale to 0.5V', expectedGroups: ['Measurement', 'Horizontal', 'Display'], expectedIntent: 'vertical' },
  { query: 'setup power harmonics analysis', expectedGroups: ['Power', 'Measurement'], expectedIntent: 'power' },
  { query: 'configure SPI bus decode', expectedGroups: ['Bus', 'Trigger'], expectedIntent: 'bus' },
  { query: 'trigger on rising edge', expectedGroups: ['Trigger'], expectedIntent: 'trigger' },
  { query: 'measure rise time', expectedGroups: ['Measurement'], expectedIntent: 'measurement' },
  { query: 'add frequency measurement', expectedGroups: ['Measurement'], expectedIntent: 'measurement' },
  { query: 'enable DVM', expectedGroups: ['DVM'], expectedIntent: 'dvm' },
  { query: 'run FFT on channel 2', expectedGroups: ['Math'], expectedIntent: 'math' },
  { query: 'autoset', expectedGroups: ['Miscellaneous'], expectedIntent: 'misc' },
  { query: 'query *IDN?', expectedGroups: ['Miscellaneous'], expectedIntent: 'misc' },
];

let passed = 0;
let failed = 0;

console.log('Testing Intent Classification...\n');

for (const tc of TEST_CASES) {
  const result = classifyIntent(tc.query);

  // Check that at least one expected group is present in result
  const groupMatch = tc.expectedGroups.some(eg =>
    result.groups.some(rg => rg.toLowerCase() === eg.toLowerCase())
  );
  const intentMatch = result.intent === tc.expectedIntent;

  if (groupMatch && intentMatch) {
    passed++;
    console.log(`✅ "${tc.query}"`);
    console.log(`   → groups=[${result.groups.join(', ')}] intent=${result.intent} confidence=${result.confidence}`);
  } else {
    failed++;
    console.log(`❌ "${tc.query}"`);
    console.log(`   Expected: groups=[${tc.expectedGroups.join(', ')}] intent=${tc.expectedIntent}`);
    console.log(`   Got:      groups=[${result.groups.join(', ')}] intent=${result.intent} confidence=${result.confidence}`);
  }
}

console.log(`\n${passed}/${passed + failed} tests passed`);

if (failed > 0) {
  console.log('\n⚠️  Some tests failed. Check the intent mapping in intentMap.ts');
  process.exit(1);
} else {
  console.log('\n🎉 All intent classification tests passed!');
}
