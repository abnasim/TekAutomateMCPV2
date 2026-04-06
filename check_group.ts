import { getCommandIndex } from './src/core/commandIndex';

async function checkScaleGroup() {
  const index = await getCommandIndex();
  const scaleCmds = index.searchByQuery('HORizontal:MODE:SCAle', undefined, 5);
  console.log('HORizontal:MODE:SCAle command with group:');
  scaleCmds.forEach(cmd => {
    console.log('  Header:', cmd.header);
    console.log('  Group:', cmd.group);
    console.log('  Category:', cmd.category);
    console.log('  Families:', cmd.families);
  });
}

checkScaleGroup().catch(console.error);
