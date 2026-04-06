#!/usr/bin/env node
/**
 * Smoke tests for Responses-only MCP path.
 * Sends fixed prompts to /ai/chat and logs duration, status, and first 200 chars.
 */
import { performance } from 'perf_hooks';

type PromptCase = { label: string; prompt: string; flowContext: any };

const MCP_HOST = process.env.MCP_HOST || 'http://localhost:8787';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || process.env.OPENAI_SERVER_API_KEY || '';
const MODEL = process.env.AI_MODEL || 'gpt-5-mini';

if (!OPENAI_API_KEY) {
  console.error('Set OPENAI_API_KEY before running.');
  process.exit(1);
}

const baseFlowContext = {
  host: '127.0.0.1',
  connectionType: 'tcpip',
  deviceType: 'SCOPE',
  modelFamily: 'MSO6B',
  steps: [],
  selectedStepId: null,
  executionSource: 'steps',
};

const scpiPrompts: PromptCase[] = [
  { label: 'SCPI screenshot + 4 meas', prompt: 'open modern screenshot template then add frequency amplitude rise time fall time on CH1', flowContext: { backend: 'pyvisa', ...baseFlowContext } },
  { label: 'SCPI fastframe basic', prompt: 'enable fastframe and set count automatically', flowContext: { backend: 'pyvisa', ...baseFlowContext } },
  { label: 'SCPI save all', prompt: 'save all waveforms as .wfm and save setup and take screenshot', flowContext: { backend: 'pyvisa', ...baseFlowContext } },
  { label: 'SCPI mixed decode', prompt: 'add CAN FD decode on B1 500kbps source CH2', flowContext: { backend: 'pyvisa', ...baseFlowContext } },
  { label: 'SCPI triggers', prompt: 'set edge trigger on CH1 rising 0.5V and run single acquisition', flowContext: { backend: 'pyvisa', ...baseFlowContext } },
];

const tmPrompts: PromptCase[] = [
  { label: 'TM meas', prompt: 'tm_devices add frequency and amplitude on CH1 and read mean values', flowContext: { backend: 'tm_devices', ...baseFlowContext } },
  { label: 'TM fastframe', prompt: 'tm_devices enable fastframe and set count to 20', flowContext: { backend: 'tm_devices', ...baseFlowContext } },
  { label: 'TM save', prompt: 'tm_devices save waveform from CH1 as wfm and save setup', flowContext: { backend: 'tm_devices', ...baseFlowContext } },
  { label: 'TM trigger', prompt: 'tm_devices set edge trigger on CH2 rising 0.2', flowContext: { backend: 'tm_devices', ...baseFlowContext } },
  { label: 'TM decode', prompt: 'tm_devices add CAN FD decode on B1 source CH2 bitrate 500k', flowContext: { backend: 'tm_devices', ...baseFlowContext } },
];

async function runCase(test: PromptCase) {
  const body = {
    userMessage: test.prompt,
    outputMode: 'steps_json',
    provider: 'openai',
    apiKey: OPENAI_API_KEY,
    model: MODEL,
    flowContext: test.flowContext,
    runContext: {
      runStatus: 'idle',
      logTail: '',
      auditOutput: '',
      exitCode: null,
    },
  };
  const url = `${MCP_HOST.replace(/\/$/, '')}/ai/chat`;
  const t0 = performance.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const duration = performance.now() - t0;
  return { status: res.status, duration, body: text.slice(0, 200) };
}

async function main() {
  const results: Array<{ label: string; duration: number; status: number; body: string }> = [];
  for (const test of [...scpiPrompts, ...tmPrompts]) {
    try {
      const r = await runCase(test);
      results.push({ label: test.label, ...r });
    } catch (e) {
      results.push({ label: test.label, duration: -1, status: 0, body: String(e) });
    }
  }
  console.table(results.map((r) => ({
    label: r.label,
    status: r.status,
    ms: Math.round(r.duration),
    body: r.body.replace(/\s+/g, ' ').slice(0, 120),
  })));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
