#!/usr/bin/env node

/**
 * 50-query benchmark test for Smart SCPI Assistant
 * Target: 90%+ pass rate (45/50)
 */

import { smartScpiLookup } from './src/core/smartScpiAssistant';

interface TestCase {
  query: string;
  /** Substring(s) that MUST appear in first result header */
  expectHeader: string | string[];
  /** If true, ANY of the expectHeader values matching is a pass */
  anyOf?: boolean;
}

const testCases: TestCase[] = [
  // ── Vertical (10) ──
  { query: 'channel 1 scale', expectHeader: 'CH<x>:SCAle' },
  { query: 'channel offset', expectHeader: 'CH<x>:OFFSet' },
  { query: 'channel bandwidth limit', expectHeader: 'CH<x>:BANdwidth' },
  { query: 'channel coupling', expectHeader: 'CH<x>:COUPling' },
  { query: 'channel termination', expectHeader: 'CH<x>:TERmination' },
  { query: 'invert channel', expectHeader: 'CH<x>:INVert' },
  { query: 'channel position', expectHeader: 'CH<x>:POSition' },
  { query: 'channel label', expectHeader: 'LABel' },
  { query: 'channel deskew', expectHeader: 'DESKew' },
  { query: 'channel probe attenuation', expectHeader: 'PRObe' },

  // ── Horizontal (5) ──
  { query: 'horizontal scale', expectHeader: 'HORizontal:SCAle' },
  { query: 'set timebase', expectHeader: ['HORizontal:SCAle', 'HORizontal:MODe'], anyOf: true },
  { query: 'horizontal position', expectHeader: 'HORizontal:POSition' },
  { query: 'enable FastFrame', expectHeader: 'FASTframe' },
  { query: 'sample rate', expectHeader: ['SAMPlerate', 'MAXSamplerate', 'SAMPLERate'], anyOf: true },

  // ── Trigger (5) ──
  { query: 'trigger edge slope', expectHeader: 'EDGE:SLOpe' },
  { query: 'set trigger level', expectHeader: 'EDGE:LEVel' },
  { query: 'trigger pulse width', expectHeader: ['PULSEWidth', 'PULse'], anyOf: true },
  { query: 'trigger holdoff', expectHeader: 'HOLDoff' },
  { query: 'trigger source channel 1', expectHeader: ['EDGE:SOUrce', 'TRIGger'], anyOf: true },

  // ── Measurement (5) ──
  { query: 'add frequency measurement', expectHeader: ['ADDMEAS', 'ADDNew'], anyOf: true },
  { query: 'delete measurement', expectHeader: ['DELete', 'DELETE'], anyOf: true },
  { query: 'add eye height measurement', expectHeader: ['ADDMEAS', 'MEASUrement'], anyOf: true },
  { query: 'measurement source CH1', expectHeader: 'MEASUrement:MEAS<x>:SOUrce<x>' },
  { query: 'enable statistics', expectHeader: ['STATIstics', 'STATIST'], anyOf: true },

  // ── Save/Recall (4) ──
  { query: 'save setup', expectHeader: 'SAVe:SETUp' },
  { query: 'recall setup', expectHeader: 'RECAll:SETUp' },
  { query: 'recall session', expectHeader: 'RECAll:SESsion' },
  { query: 'save waveform', expectHeader: 'SAVe:WAVEform' },

  // ── Math (3) ──
  { query: 'add math channel', expectHeader: 'MATH' },
  { query: 'math expression', expectHeader: 'MATH' },
  { query: 'FFT analysis', expectHeader: ['MATH', 'FFT'], anyOf: true },

  // ── Bus (4) ──
  { query: 'setup I2C bus', expectHeader: 'BUS' },
  { query: 'configure SPI bus', expectHeader: 'BUS' },
  { query: 'CAN bus decode', expectHeader: 'BUS' },
  { query: 'setup UART serial decode', expectHeader: ['BUS', 'RS232', 'SERIAL'], anyOf: true },

  // ── IEEE 488.2 (6) ──
  { query: 'reset scope', expectHeader: '*RST' },
  { query: 'identify scope', expectHeader: '*IDN' },
  { query: 'operation complete', expectHeader: '*OPC' },
  { query: 'clear status', expectHeader: '*CLS' },
  { query: 'self test', expectHeader: '*TST' },
  { query: 'event status register', expectHeader: '*ESR' },

  // ── Display/Misc (4) ──
  { query: 'set graticule type', expectHeader: ['GRATicule', 'DISplay'], anyOf: true },
  { query: 'configure histogram', expectHeader: 'HISTogram' },
  { query: 'trigger I2C bus', expectHeader: ['TRIGger', 'I2C'], anyOf: true },
  { query: 'acquire single sequence', expectHeader: ['ACQuire', 'STOPAfter'], anyOf: true },

  // ── Power (2) ──
  { query: 'add power measurement', expectHeader: 'POWer' },
  { query: 'power harmonics analysis', expectHeader: ['POWer', 'HARMONICS'], anyOf: true },

  // ── Waveform (2) ──
  { query: 'waveform data transfer', expectHeader: ['CURVe', 'WFMOutpre', 'DATa'], anyOf: true },
  { query: 'set data source', expectHeader: ['DATa:SOUrce', 'SOURCE'], anyOf: true },
];

async function runBenchmark() {
  console.log('=== 50-Query Smart SCPI Benchmark ===\n');

  let pass = 0;
  let fail = 0;
  const failures: { query: string; expected: string; got: string }[] = [];

  for (const tc of testCases) {
    const result = await smartScpiLookup({ query: tc.query });
    const headers = (result.data as Array<{ header?: string }>).map(r => String(r.header || ''));
    const topHeader = headers[0] || 'NO RESULTS';

    const expects = Array.isArray(tc.expectHeader) ? tc.expectHeader : [tc.expectHeader];

    let ok: boolean;
    if (tc.anyOf) {
      // Any expected substring in ANY of the returned headers
      ok = expects.some(exp => headers.some(h => h.toUpperCase().includes(exp.toUpperCase())));
    } else {
      // All expected substrings must appear in the top header
      ok = expects.every(exp => topHeader.toUpperCase().includes(exp.toUpperCase()));
    }

    if (ok) {
      pass++;
      console.log(`✅ "${tc.query}" → ${topHeader}`);
    } else {
      fail++;
      console.log(`❌ "${tc.query}" → ${topHeader}  (expected: ${expects.join(' | ')})`);
      failures.push({ query: tc.query, expected: expects.join(' | '), got: headers.slice(0, 3).join(', ') || 'NO RESULTS' });
    }
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Score: ${pass}/${testCases.length} (${Math.round(100 * pass / testCases.length)}%)`);
  console.log(`Pass: ${pass}  Fail: ${fail}`);

  if (failures.length > 0) {
    console.log(`\nFailures:`);
    failures.forEach(f => {
      console.log(`  "${f.query}" → got: ${f.got}  (expected: ${f.expected})`);
    });
  }

  const pct = Math.round(100 * pass / testCases.length);
  if (pct >= 90) {
    console.log(`\n🎉 PASSED: ${pct}% >= 90% threshold`);
  } else {
    console.log(`\n⚠️  BELOW TARGET: ${pct}% < 90% threshold`);
  }
}

runBenchmark().catch(console.error);
