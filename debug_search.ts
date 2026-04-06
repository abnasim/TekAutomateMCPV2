import { getCommandIndex } from './src/core/commandIndex';

async function debugSearchText() {
  const index = await getCommandIndex();
  const scaleCmds = index.searchByQuery('HORizontal:MODE:SCAle', undefined, 5);
  const scaleCmd = scaleCmds.find(cmd => cmd.header === 'HORizontal:MODE:SCAle');
  
  if (scaleCmd) {
    const searchText = `${scaleCmd.header} ${scaleCmd.shortDescription} ${scaleCmd.description} ${scaleCmd.tags.join(' ')}`.toLowerCase();
    console.log('Search text for HORizontal:MODE:SCAle:');
    console.log(searchText);
    console.log('\nContains "scale":', searchText.includes('scale'));
    console.log('Contains "horizontal":', searchText.includes('horizontal'));
  }
}

debugSearchText().catch(console.error);
