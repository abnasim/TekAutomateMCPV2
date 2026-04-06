import { getCommandIndex } from './src/core/commandIndex';

async function checkMathCommands() {
  const index = await getCommandIndex();
  const allCommands = index.searchByQuery('', undefined, 5000);
  
  console.log('Total commands:', allCommands.length);
  
  // Filter to DPO70000
  const dpo70000Commands = allCommands.filter(cmd =>
    cmd.families.some(f => f.toLowerCase().includes('dpo70000'))
  );
  
  console.log('DPO70000 commands:', dpo70000Commands.length);
  
  // Check for Math group
  const mathCommands = dpo70000Commands.filter(cmd => 
    cmd.group.toLowerCase() === 'math'
  );
  
  console.log('Math commands in DPO70000:', mathCommands.length);
  
  // Show all unique groups in DPO70000
  const groups = [...new Set(dpo70000Commands.map(cmd => cmd.group))];
  console.log('\nAll groups in DPO70000:');
  groups.sort().forEach(g => {
    const count = dpo70000Commands.filter(cmd => cmd.group === g).length;
    console.log(`  ${g}: ${count} commands`);
  });
  
  // Check if Math commands exist at all
  const allMathCommands = allCommands.filter(cmd => 
    cmd.group.toLowerCase() === 'math'
  );
  console.log('\nTotal Math commands across all families:', allMathCommands.length);
  
  if (allMathCommands.length > 0) {
    console.log('Math command families:');
    const mathFamilies = [...new Set(allMathCommands.flatMap(cmd => cmd.families))];
    mathFamilies.sort().forEach(f => console.log(`  - ${f}`));
  }
}

checkMathCommands().catch(console.error);
