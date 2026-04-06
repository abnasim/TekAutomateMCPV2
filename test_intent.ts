import { classifyIntent } from './src/core/intentMap';

const result = classifyIntent('set horizontal scale 10000');
console.log('Intent:', result);
