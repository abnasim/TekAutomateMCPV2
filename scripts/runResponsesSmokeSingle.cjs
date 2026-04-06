const { performance } = require('perf_hooks');

const MCP_HOST = process.env.MCP_HOST || 'http://localhost:8787';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.AI_MODEL || 'gpt-5-mini';

if (!OPENAI_API_KEY) {
  console.error('Set OPENAI_API_KEY');
  process.exit(1);
}

const cases = [
  { label: 'SCPI save all', prompt: 'save all waveforms as .wfm and save setup and take screenshot', backend: 'pyvisa' },
  { label: 'SCPI mixed decode', prompt: 'add CAN FD decode on B1 500kbps source CH2', backend: 'pyvisa' },
  { label: 'SCPI triggers', prompt: 'set edge trigger on CH1 rising 0.5V and run single acquisition', backend: 'pyvisa' },
  { label: 'TM meas', prompt: 'tm_devices add frequency and amplitude on CH1 and read mean values', backend: 'tm_devices' },
  { label: 'TM fastframe', prompt: 'tm_devices enable fastframe and set count to 20', backend: 'tm_devices' },
  { label: 'TM save', prompt: 'tm_devices save waveform from CH1 as wfm and save setup', backend: 'tm_devices' },
  { label: 'TM trigger', prompt: 'tm_devices set edge trigger on CH2 rising 0.2', backend: 'tm_devices' },
  { label: 'TM decode', prompt: 'tm_devices add CAN FD decode on B1 source CH2 bitrate 500k', backend: 'tm_devices' },
];

async function runCase(test) {
  const body = {
    userMessage: test.prompt,
    outputMode: 'steps_json',
    provider: 'openai',
    apiKey: OPENAI_API_KEY,
    model: MODEL,
    flowContext: {
      backend: test.backend,
      host: '127.0.0.1',
      connectionType: 'tcpip',
      modelFamily: 'MSO6B',
      steps: [],
      selectedStepId: null,
      executionSource: 'steps',
      deviceType: 'SCOPE',
    },
    runContext: {
      runStatus: 'idle',
      logTail: '',
      auditOutput: '',
      exitCode: null,
    },
  };
  const t0 = performance.now();
  try {
    const res = await fetch(`${MCP_HOST.replace(/\/$/, '')}/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const ms = Math.round(performance.now() - t0);
    const raw = await res.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch (parseErr) {
      console.log(
        `${test.label} | ${res.status} | ${ms}ms | JSON parse fail | raw: ${raw.slice(0, 150).replace(/\\s+/g, ' ')}`
      );
      return;
    }
    const textPreview = (data?.text || '').slice(0, 180).replace(/\\s+/g, ' ');
    const errPreview = Array.isArray(data?.errors) && data.errors.length
      ? `errors=${data.errors.length}`
      : 'errors=0';
    const modelMs = data?.metrics?.modelMs ?? '-';
    console.log(`${test.label} | ${res.status} | ok:${data?.ok} | total:${ms}ms | model:${modelMs} | ${errPreview} | ${textPreview}`);
  } catch (e) {
    const ms = Math.round(performance.now() - t0);
    console.log(`${test.label} | FAIL | ${ms}ms | ${e}`);
  }
}

(async () => {
  for (const c of cases) {
    await runCase(c);
  }
})();
