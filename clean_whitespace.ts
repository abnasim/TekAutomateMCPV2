import fs from 'fs';
const content = fs.readFileSync('src/core/smartScpiAssistant.ts', 'utf8');
const lines = content.split('\n');
const cleanedLines = lines.map(line => line.trimEnd());
const cleanedContent = cleanedLines.join('\n');
fs.writeFileSync('src/core/smartScpiAssistant.ts', cleanedContent);
console.log('Removed trailing whitespace from all lines');
