import { classifyIntent } from './src/core/intentMap';

const tests = [
  'math channel',
  'add math channel', 
  'math trace',
  'math waveform',
  'configure math channel',
  'delete math channel',
  'math expression',
  'add math'
];

tests.forEach(test => {
  const result = classifyIntent(test);
  console.log(`"${test}" → groups: [${result.groups.join(', ')}] intent: ${result.intent} subject: ${result.subject}`);
});
