import { getCommandIndex } from './src/core/commandIndex';

async function checkCommandIndex() {
  const index = await getCommandIndex();
  
  // Try different search methods
  console.log('Testing command index...\n');
  
  // Check if index has any commands
  const mathResults = index.searchByQuery('math', undefined, 100);
  console.log('Search "math":', mathResults.length, 'results');
  
  if (mathResults.length > 0) {
    console.log('First 3 math results:');
    mathResults.slice(0, 3).forEach((cmd, i) => {
      console.log(`  ${i+1}. ${cmd.header} - Group: ${cmd.group} - Families: ${cmd.families.join(', ')}`);
    });
  }
  
  // Check specific headers
  const scaleResults = index.searchByQuery('scale', undefined, 100);
  console.log('\nSearch "scale":', scaleResults.length, 'results');
  
  if (scaleResults.length > 0) {
    console.log('First 3 scale results:');
    scaleResults.slice(0, 3).forEach((cmd, i) => {
      console.log(`  ${i+1}. ${cmd.header} - Group: ${cmd.group} - Families: ${cmd.families.join(', ')}`);
    });
  }
}

checkCommandIndex().catch(console.error);
