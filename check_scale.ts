import { getCommandIndex } from './src/core/commandIndex';

async function checkScaleCommands() {
  const index = await getCommandIndex();
  const scaleCmds = index.searchByQuery('HORizontal:MODE:SCAle', undefined, 5);
  console.log('HORizontal:MODE:SCAle command:');
  scaleCmds.forEach(cmd => {
    console.log('  Header:', cmd.header);
    console.log('  Description:', cmd.shortDescription);
    console.log('  Families:', cmd.families);
    console.log('  Syntax:', JSON.stringify(cmd.syntax));
  });
}

checkScaleCommands().catch(console.error);
