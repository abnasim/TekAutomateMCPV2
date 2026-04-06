import { getCommandIndex } from './src/core/commandIndex';

async function checkDPO70000Groups() {
  const index = await getCommandIndex();
  const allCommands = index.searchByQuery('', undefined, 10000);
  
  console.log('Total commands:', allCommands.length);
  
  // Filter to DPO70000
  const dpo70000Commands = allCommands.filter(cmd =>
    cmd.families.some(f => f.toLowerCase().includes('dpo70000'))
  );
  
  console.log('DPO70000 commands:', dpo70000Commands.length);
  
  // Show all unique groups
  const groups = [...new Set(dpo70000Commands.map(cmd => cmd.group))];
  console.log('\nGroups available in DPO70000:');
  groups.sort().forEach(g => {
    const count = dpo70000Commands.filter(cmd => cmd.group === g).length;
    console.log(`  ${g}: ${count} commands`);
  });
  
  // Check if Math exists in any DPO family
  const dpoMathCommands = allCommands.filter(cmd =>
    cmd.group.toLowerCase() === 'math' &&
    cmd.families.some(f => f.toLowerCase().includes('dpo'))
  );
  
  console.log('\nMath commands in DPO families:', dpoMathCommands.length);
  if (dpoMathCommands.length > 0) {
    const families = [...new Set(dpoMathCommands.flatMap(cmd => cmd.families))];
    console.log('DPO families with Math:', families.filter(f => f.toLowerCase().includes('dpo')).join(', '));
  }
}

checkDPO70000Groups().catch(console.error);
