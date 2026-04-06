import { getCommandIndex } from './src/core/commandIndex';

async function debugTopCommand() {
  const index = await getCommandIndex();
  const topCmds = index.searchByQuery('HORizontal:MODe:AUTOmatic:FASTAcq:RECOrdlength:MAXimum:ZOOMOVERride', undefined, 5);
  const topCmd = topCmds[0];
  
  if (topCmd) {
    const searchText = `${topCmd.header} ${topCmd.shortDescription} ${topCmd.description} ${topCmd.tags.join(' ')}`.toLowerCase();
    console.log('Search text for top command:');
    console.log(topCmd.header);
    console.log(searchText);
    console.log('\nContains "scale":', searchText.includes('scale'));
    console.log('Contains "horizontal":', searchText.includes('horizontal'));
    console.log('Contains "mode":', searchText.includes('mode'));
  }
}

debugTopCommand().catch(console.error);
