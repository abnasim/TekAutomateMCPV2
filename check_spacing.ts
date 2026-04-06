import fs from 'fs';
const content = fs.readFileSync('src/core/smartScpiAssistant.ts', 'utf8');
const lines = content.split('\n');

// Check for trailing whitespace
let trailingWhitespaceLines = [];
for (let i = 0; i < lines.length; i++) {
  if (lines[i] !== lines[i].trimEnd()) {
    trailingWhitespaceLines.push(i + 1);
  }
}

// Check for double empty lines
let doubleEmptyLines = [];
for (let i = 0; i < lines.length - 1; i++) {
  if (lines[i].trim() === '' && lines[i+1].trim() === '') {
    doubleEmptyLines.push(i + 1);
  }
}

console.log('=== Spacing Issues ===');
console.log('Lines with trailing whitespace:', trailingWhitespaceLines.slice(0, 10));
console.log('Trailing whitespace count:', trailingWhitespaceLines.length);
console.log('Lines with double empty lines:', doubleEmptyLines.slice(0, 10));
console.log('Double empty lines count:', doubleEmptyLines.length);

// Show some examples if issues exist
if (trailingWhitespaceLines.length > 0) {
  console.log('\nSample lines with trailing whitespace:');
  for (let i = 0; i < Math.min(3, trailingWhitespaceLines.length); i++) {
    const lineNum = trailingWhitespaceLines[i];
    console.log(`${lineNum}: "${lines[lineNum - 1]}"`);
  }
}
