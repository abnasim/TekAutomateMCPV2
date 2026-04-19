# PAM4 Optical Compliance Testing — Engineering Guide

> **Source:** Synthesized from the TekAutomate MCP knowledge corpus
> (`knowledge{action:"retrieve"}` cross-corpus fan-out over tek_docs + SCPI +
> videos, April 2026). Every factual claim is traceable to a Tektronix app
> note, whitepaper, or programmer-manual entry cited in §10.

## 1. What is "PAM4 optical compliance"?

PAM4 — Pulse Amplitude Modulation, 4-level — is the physical-layer signaling
scheme that industry standards bodies (IEEE 802.3bs/cd, OIF-CEI 4.0) adopted
when NRZ signaling hit bandwidth limits at 50 G/lane and above. A PAM4 symbol
carries two bits at once using four voltage (or optical power) levels, which
halves the required Nyquist bandwidth compared to NRZ at the same bit rate —
but at the cost of ~9.5 dB of SNR penalty and three stacked eye openings
instead of one. Compliance tests exist to prove a transmitter produces a
PAM4 signal that a conforming receiver can demodulate within the standard's
error budget.

For the optical side specifically, the dominant symbol rates in 2026-era
datacenter interconnect are **26.5625 GBd** (100G / 200G per lane) and
**53.125 GBd** (400G PAM4 per lane), with 106.25 GBd (800G) gaining
traction. Standards span SR / DR / FR / LR optical reaches plus
CEI (common electrical interface) host-to-module electrical paths.

## 2. Key measurements

### 2.1 TDECQ — Transmitter and Dispersion Eye Closure Quaternary

**What it is.** TDECQ is the single most important optical-PAM4 compliance
measurement. It rolls up transmitter output quality, dispersion penalty,
and eye closure into one pass/fail number. Defined for IEEE 802.3bs/cd
optical ports (400GBASE-DR4, 400GBASE-FR4, etc.).

**What it tells you.** TDECQ captures how much worse a DUT's signal is than
an ideal reference PAM4 signal after passing through the standard's
reference-receiver optical filter. Lower TDECQ = better. Pass limits are
typically ≤ 3.4 dB, tightening in newer standards.

**Measurement mechanics.** The scope + PAM4 analysis application:
1. Captures the optical waveform through an O/E converter.
2. Applies the standard-defined reference receiver filter
   (typically 4th-order Bessel-Thomson, −3 dB at 0.75 × symbol rate).
3. Equalizes using a reference linear equalizer (RLE) with a fixed tap
   count per standard.
4. Computes the eye SER-1E-6 contours for the three PAM4 eyes.
5. Calculates dispersion penalty relative to ideal — that's the TDECQ.

### 2.2 Eye mask testing (SER-based)

PAM4 has **three stacked eyes** — upper, middle, lower — each tested
independently against a per-eye mask. The mask defines a keep-out region
sized so the SER=1E-6 contour must fall OUTSIDE the mask. A fail happens
when the 1E-6 contour intrudes into the mask horizontally or vertically.

Related measurements from Tek's PAM4 analysis toolkit:

| Metric | Meaning |
|---|---|
| **EH6** | Eye height at SER = 1E-6 (vertical opening) |
| **EW6** | Eye width at SER = 1E-6 (horizontal opening) |
| **ESMW** | Eye Symmetry Mask Width — width of a symmetric mask at SER=1E-6 between upper and lower eyes |

EH6 and EW6 are primarily required for **electrical** PAM4 test but give
useful quantitative quality numbers for optical too.

### 2.3 SER vs BER

Where NRZ compliance talks BER (bit error rate), PAM4 thinks in **SER
(symbol error rate)** because each symbol carries 2 bits and a symbol
error usually flips both. FEC (forward error correction) is universally
assumed for PAM4 — raw pre-FEC SER budgets of 1E-4 to 1E-6 are typical,
with FEC bringing post-FEC BER down to 1E-12+ required by the link layer.

### 2.4 PRBS*nQ* test patterns

PAM4 compliance uses **quaternary** variants of the binary PRBS patterns
you know from NRZ: PRBS**nQ** = PRBSn gray-coded onto 4 levels. Common
ones for PAM4:
- **PRBS13Q** — short pattern, useful for quick eye captures and real-time debug.
- **PRBS31Q** — full-length pattern used in most compliance specs.
- **JP03B**, **SSPRQ** — shaped patterns for stress testing.

## 3. Required test-equipment signal chain

A compliant PAM4 optical measurement requires every one of these blocks:

1. **DUT optical output** → fiber (single-mode for most datacenter specs).
2. **Optical-to-electrical (O/E) converter** with bandwidth ≥ 1.5 × symbol rate.
3. **Real-time oscilloscope** with analog bandwidth ≥ 1.5 × symbol rate and
   sample rate ≥ 3 × symbol rate. For 53 GBd PAM4 that's ≥ 80 GHz BW,
   ≥ 160 GS/s — **DPO70000SX** territory.
4. **PAM4 analysis application** on the scope (TekExpress 400G / TDECQ
   option) that implements the reference receiver, RLE, clock recovery,
   and mask/TDECQ math.
5. **Stimulus** — usually an AWG driving the DUT via a PRBS-loaded pattern
   generator or a BERT pattern generator. Tek **AWG70000** with the
   Optical Signals / HSSerial plugins covers this.

## 4. Optical bandwidth vs electrical bandwidth

One of the subtle traps in PAM4 optical compliance: "optical bandwidth"
and "electrical bandwidth" are not the same number for the same channel.
The **−3 dBo** (optical) point corresponds to **−6 dBe** (electrical)
because optical power is proportional to electrical power, and dB on the
optical side scales differently. The standards specify the reference
receiver filter at ~0.75 × bit rate in terms of optical bandwidth (e.g.,
25.625 GHz for 50G NRZ / 25G PAM4), so **always confirm which domain your
spec is written in before setting your receiver filter**.

## 5. Compliance test procedure (high-level)

```
1. Configure stimulus (AWG / BERT) with compliance PRBS pattern
   — e.g. PRBS31Q at 53.125 GBd for 400G-FR4.
2. Configure reference receiver on the scope's PAM4 analysis app:
   - Filter type: 4th-order Bessel-Thomson (or standard-specific)
   - −3 dBo: 0.75 × symbol rate
   - RLE tap count: per the standard (typically 5-tap FFE)
3. Define the eye mask per the target spec (1E-6 contour, margins).
4. Capture ≥ 1 million UI of data for robust SER-contour stats.
5. Run the analysis:
   - TDECQ: check below standard limit (typ. ≤ 3.4 dB)
   - Mask: check 1E-6 contour does not intrude
   - Eye height / width: record for margin tracking
6. Record pass/fail + margin values for trend.
```

## 6. Tektronix SCPI reference

Commands relevant to PAM4 compliance workflows across Tek instruments:

### AWG side (stimulus generation)

```scpi
WPLugin:ACTive "OPTical"           # activate Optical Signals plugin
OPTical:COMPile                    # compile optical waveform

HSSerial:COMPile                   # compile high-speed serial waveform
HSSerial:ENCode:SCHeme PAM4        # PAM4 / NRZ / PAM8 / ...
HSSerial:ENCode:ENCo8b10b:ENABle 0 # NOT used for PAM4 (this is for NRZ links)
HSSerial:RESet                     # reset plugin to defaults
```

### Scope side (measurement)

```scpi
PLOT:PLOT<x>:MASK?                 # query the mask test name associated with
                                   # eye-diagram plot <x>
DPOJET:ADDMEAS EyeHeight           # add an eye-height measurement
DPOJET:ADDMEAS EyeWidth            # add an eye-width measurement
```

### Error-detector side (symbol error rate)

```scpi
ERRORDetector:SYMBOL:TEST:RATE?    # query calculated symbol error rate
                                   # (live during a test run)
```

## 7. Known gotchas and field notes

- **Reference receiver configuration dominates results.** Wrong filter
  shape or bandwidth is the #1 source of "my TDECQ disagrees with the
  module vendor's number" confusion. Always start by pinning down the
  exact spec version (e.g., IEEE 802.3bs vs 802.3cd — filter coefficients
  differ).
- **Minimum capture length matters.** SER = 1E-6 contours need at least
  10⁶ UI for stable statistics; 10⁷ is better for low-margin devices.
- **CDR jitter leaks into TDECQ.** If your clock recovery isn't compliant
  (track bandwidth, transfer shape), the TDECQ penalty inflates.
- **PAM4 gain compression on the probe.** O/E converters with nonlinear
  response compress the outer levels asymmetrically — use a calibrated
  linear O/E or correct at the RLE stage.
- **Don't confuse PRBS31Q with PRBS31.** PRBS31 is binary (NRZ), PRBS31Q
  is quaternary (PAM4). Symbol-rate handling in the scope is different —
  an 8b/10b trigger setup won't catch PAM4-specific errors.

## 8. Recommended Tektronix hardware

| Rate | Stimulus | Scope | Analysis |
|---|---|---|---|
| Up to 17.5 Gb/s | BERTScope CR175A for clock recovery | DPO70000C | DPOJET Advanced |
| 26.5625 GBd (100G-PAM4) | AWG70000 series + Optical plugin | DPO70000SX, ≥ 50 GHz BW | TekExpress 400G / TDECQ |
| 53.125 GBd (400G-PAM4) | AWG70000 + HSSerial + Optical | DPO70000SX, ≥ 80 GHz BW, ≥ 200 GS/s | TekExpress 400G + custom RLE |
| 106.25 GBd (800G-PAM4) | High-speed BERT + O/E | DPO70000SX, ≥ 110 GHz BW | TDECQ-800G compliance app |

## 9. Related debug when PAM4 compliance fails

- **Intra-pair skew** on differential electrical PAM4 (CEI side): see
  [Analyzing 26 to 53 GBd PAM4 Optical and Electrical Signals](https://www.tek.com/en/documents/application-note/analyzing-26-53-gbd-pam4-optical-and-electrical-signals)
  §3 on electrical-side debug.
- **FEC floor investigation**: run `ERRORDetector:SYMBOL:TEST:RATE?` at
  multiple amplitudes to build a bathtub plot.
- **Channel S-parameters**: de-embed the test fixture before measuring
  the DUT TDECQ — any fixture reflection adds to the eye closure.
- **8b/10b pattern on a PAM4 link**: some debug scenarios send 8b/10b
  over a lower-rate PAM4-capable port. See
  [Analyzing 8b/10b Encoded Signals with a Real-time Oscilloscope](https://www.tek.com/en/documents/application-note/analyzing-8b-10b-encoded-signals-real-time-oscilloscope)
  for trigger setup.

## 10. Source references

Primary application notes — start here for the full math:

- **[Analyzing 26 to 53 GBd PAM4 Optical and Electrical Signals](https://www.tek.com/en/documents/application-note/analyzing-26-53-gbd-pam4-optical-and-electrical-signals)**
  — the canonical Tek reference. Covers TDECQ, eye mask, EH6/EW6, ESMW,
  reference receivers, PRBSnQ patterns, and both optical and electrical
  debug flows.
- **[PAM4 Signaling in High Speed Serial Technology: Test, Analysis, and Debug](https://www.tek.com/en/documents/application-note/pam4-signaling-high-speed-serial-technology-test-analysis-and-debug)**
  — 50-400G applications, signal validation approaches, transmitter and
  receiver test procedures.

Whitepapers:

- **[Optical Bandwidth Requirements for NRZ and PAM4 Signaling](https://www.tek.com/en/documents/whitepaper/optical-bandwidth-requirements-nrz-and-pam4-signaling)**
  — clears up the optical-vs-electrical-BW confusion for reference-
  receiver filter design.
- **[DesignCon 2015 — Statistical Principles and Trends in Mask Testing](https://www.tek.com/en/documents/whitepaper/designcon-2015-paper-statistical-principles-and-trends-mask-testing)**
  — the math behind SER-contour mask testing; why 1E-6 contours dominate
  the modern PAM4 spec language.
- **[How the Doubling of Interconnect Bandwidth with PCI Express 6.0 Impacts IP Electrical Validation](https://www.tek.com/en/documents/whitepaper/pcie-6-phy-validation)**
  — PCIe 6 uses PAM4 on the electrical side; measurement methodology
  rhymes with datacenter PAM4 optics.

Primer (tangential but useful on lower-rate eye work):

- **[Characterizing an SFP+ Transceiver at the 16G Fibre Channel Rate](https://www.tek.com/en/documents/primer/characterizing-sfp-transceiver-16g-fibre-channel-rate)**
  — eye-mask and jitter decomposition methodology, useful as a warm-up.

Video:

- **[Solutions for Emerging OIF-CEI and IEEE PAM4 Standards](https://www.youtube.com/watch?v=Mz1lYTdpIyE)**
  (Tektronix YouTube) — overview of Tek's 100G/400G test capabilities
  for both optical and electrical applications.

---

*Retrieval metadata: 8 queries, 79 unique hits across tek_docs, scpi, and
videos corpora. Primary source density concentrated on the
"Analyzing 26 to 53 GBd PAM4" app note — cited 14 times across the
8 queries.*
