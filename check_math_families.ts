import { getCommandIndex } from './src/core/commandIndex';

async function checkMathFamilies() {
  const index = await getCommandIndex();
  const mathCmd = index.searchByQuery('MATH<x>:DEFine', undefined, 10)[0];
  
  if (mathCmd) {
    console.log('MATH<x>:DEFine families:', mathCmd.families.join(', '));
    console.log('Has DPO70000:', mathCmd.families.includes('DPO70000'));
    console.log('Has MSO70000:', mathCmd.families.includes('MSO70000'));
  } else {
    console.log('MATH<x>:DEFine not found');
  }
  
  // Check a few more Math commands
  const allMath = index.searchByQuery('math', undefined, 10);
  console.log('\nFirst 5 Math commands:');
  allMath.slice(0, 5).forEach(cmd => {
    console.log(`${cmd.header}: ${cmd.families.join(', ')}`);
  });
}

checkMathFamilies().catch(console.error);
