/**
 * scrapeTekVideos.ts  —  tek.com video → Brightcove metadata → YouTube mirror → transcript.
 *
 * Runs locally. Populates data/videos.json from scripts/tek_video_urls.json.
 * Idempotent: skips already-populated videos unless forced.
 *
 * ─── Pipeline per tek.com URL ───
 * 1. Fetch tek.com page HTML → extract data-video-id + data-account +
 *    data-player (Brightcove embed).
 * 2. Fetch Brightcove iframe once per account/player → extract policyKey.
 * 3. Call Brightcove Playback API → get name, description, duration,
 *    MP4 sources, text_tracks. (text_tracks on Tek videos are thumbnails
 *    only; no captions published there.)
 * 4. (--match-yt or --all) YouTube search for the video by title with
 *    "Tektronix" qualifier. Accept only results whose channel is
 *    Tektronix. Record the youtubeId.
 * 5. (--transcribe or --all) shell to scripts/fetch_yt_transcript.py
 *    (uses youtube-transcript-api) → real transcript as chunks of
 *    {start, end, text}. Far lighter than Whisper and works without
 *    ffmpeg or model weights.
 *
 * ─── Install ───
 *   python -m pip install youtube-transcript-api certifi
 *
 *   # no ffmpeg or whisper required — YouTube auto-captions handle it.
 *
 * ─── Run ───
 *   # metadata only (fast)
 *   npx tsx scripts/scrapeTekVideos.ts --collect [--family MSO2]
 *
 *   # metadata + YouTube mirror match (no transcripts)
 *   npx tsx scripts/scrapeTekVideos.ts --match-yt [--family MSO2]
 *
 *   # full: collect + match + transcripts
 *   npx tsx scripts/scrapeTekVideos.ts --all [--family MSO2]
 *
 *   # force re-transcription / re-match
 *   npx tsx scripts/scrapeTekVideos.ts --all --force-transcribe --force-match
 *
 * ─── Caveats ───
 * - Tek.com publishes NO captions to Brightcove (verified MSO2).
 *   YouTube auto-captions are the only viable transcript source.
 * - Some tek.com URLs may map to the same YouTube upload. That's fine;
 *   entries stay distinct, transcripts are identical.
 * - A small fraction of Tek YouTube uploads may not have captions.
 *   These will be flagged with transcript_error instead of chunks.
 */

import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ─── Paths ───────────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const _scriptDir = path.dirname(__filename);
const _projectRoot = path.resolve(_scriptDir, '..');
const URLS_PATH = path.join(_scriptDir, 'tek_video_urls.json');
const VIDEOS_PATH = path.join(_projectRoot, 'data', 'videos.json');
const PY_TRANSCRIPT = path.join(_scriptDir, 'fetch_yt_transcript.py');
const PY_CHANNEL = path.join(_scriptDir, 'fetch_tek_channel.py');

// ─── Config ──────────────────────────────────────────────────────────
const RATE_LIMIT_MS = 1000;
const USER_AGENT = 'Mozilla/5.0 (Tekautomate-scraper)';
const YT_CHANNEL_ALLOW = ['tektronix', 'tektronix test'];
const PYTHON_CMD = process.env.PYTHON_CMD || 'python';

// ─── CLI parsing ─────────────────────────────────────────────────────
interface CliOpts {
  mode: 'collect' | 'match-yt' | 'transcribe' | 'all' | 'channel-sweep';
  family: string | null;
  maxVideos: number;
  forceSummary: boolean;
  forceMatch: boolean;
  forceTranscribe: boolean;
}

function parseArgs(argv: string[]): CliOpts {
  const opts: CliOpts = {
    mode: 'collect',
    family: null,
    maxVideos: 0,
    forceSummary: false,
    forceMatch: false,
    forceTranscribe: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--collect') opts.mode = 'collect';
    else if (a === '--match-yt') opts.mode = 'match-yt';
    else if (a === '--transcribe') opts.mode = 'transcribe';
    else if (a === '--all') opts.mode = 'all';
    else if (a === '--channel-sweep') opts.mode = 'channel-sweep';
    else if (a === '--family') opts.family = argv[++i] || null;
    else if (a === '--max') opts.maxVideos = Number(argv[++i]) || 0;
    else if (a === '--force-summary') opts.forceSummary = true;
    else if (a === '--force-match') opts.forceMatch = true;
    else if (a === '--force-transcribe') opts.forceTranscribe = true;
    else if (a === '--help' || a === '-h') {
      console.log(`usage: npx tsx scripts/scrapeTekVideos.ts
  --collect | --match-yt | --transcribe | --all   per-tek.com-URL flow (uses tek_video_urls.json)
  --channel-sweep [--max N]                       pull every video on @tektronix, auto-tag families, fetch transcripts
  --family <name>                                 scope the per-URL modes
  --force-summary | --force-match | --force-transcribe`);
      process.exit(0);
    }
  }
  return opts;
}

// ─── Types ───────────────────────────────────────────────────────────
interface UrlsFile {
  note?: string;
  lastUpdated?: string;
  families: Record<string, string[]>;
}

interface TranscriptChunk {
  start: number;
  end: number;
  text: string;
}

interface VideoEntry {
  id: string;
  title: string;
  url: string;
  category?: string;
  products: string[];
  tags?: string[];
  summary?: string;
  duration_ms?: number;
  duration?: string;
  brightcove_account?: string;
  brightcove_video_id?: string;
  mp4_url?: string;
  youtube_id?: string;
  youtube_title?: string;
  youtube_match_lastTried?: string;
  transcript_chunks?: TranscriptChunk[];
  transcript_source?: string;
  transcript_lastFetched?: string;
  transcript_error?: string;
  page_lastFetched?: string;
}

interface VideosStore {
  $schema?: string;
  note?: string;
  lastUpdated?: string;
  phase?: string;
  updateProcedure?: string;
  videos: VideoEntry[];
}

// ─── Small utilities ─────────────────────────────────────────────────
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function fmtDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = String(total % 60).padStart(2, '0');
  return `${m}:${s}`;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'video';
}

function deriveCategory(url: string): string {
  if (/\/video\/how-to\//.test(url)) return 'how-to';
  if (/\/video\/product-features\//.test(url)) return 'product-features';
  if (/\/video\/tutorials?\//.test(url)) return 'tutorial';
  return 'general';
}

function commandExists(cmd: string): boolean {
  try {
    const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { stdio: 'pipe' });
    return r.status === 0;
  } catch { return false; }
}

// ─── Fetch helpers ───────────────────────────────────────────────────
async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`fetch ${url} → ${res.status}`);
  return res.text();
}

async function fetchJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, ...headers } });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`fetch ${url} → ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

// ─── Brightcove integration ──────────────────────────────────────────
const policyKeyCache = new Map<string, string>();

async function extractBrightcovePolicyKey(accountId: string, playerId: string): Promise<string> {
  const cacheKey = `${accountId}/${playerId}`;
  const cached = policyKeyCache.get(cacheKey);
  if (cached) return cached;

  const iframeUrl = `https://players.brightcove.net/${accountId}/${playerId}_default/index.html?videoId=dummy`;
  const html = await fetchText(iframeUrl);
  const m = html.match(/policyKey:"([^"]+)"/);
  if (!m) throw new Error(`no policyKey found in Brightcove iframe for ${cacheKey}`);
  policyKeyCache.set(cacheKey, m[1]);
  return m[1];
}

interface BrightcoveVideo {
  name?: string;
  description?: string;
  duration?: number;
  sources?: Array<{ src?: string; container?: string; type?: string; height?: number }>;
  text_tracks?: Array<{ kind?: string; src?: string; srclang?: string; label?: string }>;
}

async function fetchBrightcoveVideo(accountId: string, videoId: string, policyKey: string): Promise<BrightcoveVideo> {
  const url = `https://edge.api.brightcove.com/playback/v1/accounts/${accountId}/videos/${videoId}`;
  return fetchJson<BrightcoveVideo>(url, {
    Accept: `application/json;pk=${policyKey}`,
    Origin: 'https://www.tek.com',
    Referer: 'https://www.tek.com/',
  });
}

function pickBestMp4Source(sources: BrightcoveVideo['sources']): string | null {
  if (!sources) return null;
  const mp4s = sources.filter((s) => s.container === 'MP4' && s.src && !/^rtmp/i.test(s.src));
  if (mp4s.length === 0) return null;
  const sorted = [...mp4s].sort((a, b) => (a.height || 9999) - (b.height || 9999));
  const good = sorted.find((s) => (s.height || 0) >= 360) || sorted[0];
  return good.src || null;
}

// ─── Page scraping ───────────────────────────────────────────────────
interface PageMeta {
  videoId: string;
  accountId: string;
  playerId: string;
}

function extractPageMeta(html: string): PageMeta | null {
  const vid = html.match(/data-video-id="([0-9]+)"/);
  const acc = html.match(/data-account="([0-9]+)"/);
  const player = html.match(/data-player="([^"]+)"/);
  if (!vid || !acc || !player) return null;
  return { videoId: vid[1], accountId: acc[1], playerId: player[1] };
}

async function collectEntry(url: string, family: string, existing: VideoEntry | null): Promise<VideoEntry> {
  console.log(`  [collect] ${url}`);
  const html = await fetchText(url);
  const pageMeta = extractPageMeta(html);
  if (!pageMeta) throw new Error(`no Brightcove video ID found on ${url}`);

  const policyKey = await extractBrightcovePolicyKey(pageMeta.accountId, pageMeta.playerId);
  await sleep(RATE_LIMIT_MS);
  const bc = await fetchBrightcoveVideo(pageMeta.accountId, pageMeta.videoId, policyKey);

  const title = bc.name || existing?.title || url;
  const summary = (existing?.summary && existing.summary.length > 40 && !/^short introduction/i.test(existing.summary))
    ? existing.summary
    : (bc.description || existing?.summary || '');
  const mp4 = pickBestMp4Source(bc.sources);
  const products = existing?.products && existing.products.length > 0 ? existing.products : [family];

  return {
    id: existing?.id || `tek-video-${slugify(title)}`,
    title,
    url,
    category: existing?.category || deriveCategory(url),
    products,
    tags: existing?.tags || [],
    summary,
    ...(bc.duration ? { duration_ms: bc.duration, duration: fmtDuration(bc.duration) } : {}),
    brightcove_account: pageMeta.accountId,
    brightcove_video_id: pageMeta.videoId,
    ...(mp4 ? { mp4_url: mp4 } : {}),
    ...(existing?.youtube_id ? { youtube_id: existing.youtube_id, youtube_title: existing.youtube_title } : {}),
    ...(existing?.youtube_match_lastTried ? { youtube_match_lastTried: existing.youtube_match_lastTried } : {}),
    ...(existing?.transcript_chunks ? { transcript_chunks: existing.transcript_chunks } : {}),
    ...(existing?.transcript_source ? { transcript_source: existing.transcript_source } : {}),
    ...(existing?.transcript_lastFetched ? { transcript_lastFetched: existing.transcript_lastFetched } : {}),
    page_lastFetched: new Date().toISOString(),
  };
}

// ─── YouTube mirror matching ─────────────────────────────────────────
interface YtHit {
  videoId: string;
  title: string;
  channel: string;
}

async function searchYoutubeForTek(title: string): Promise<YtHit | null> {
  const q = `${title} Tektronix`;
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en-US,en;q=0.9' } });
  if (!res.ok) throw new Error(`yt search ${res.status}`);
  const html = await res.text();

  const hits: YtHit[] = [];
  // videoRenderer blocks contain videoId, title, and ownerText — regex them out in order.
  const vrPattern = /"videoRenderer":\{"videoId":"([a-zA-Z0-9_-]{11})"[\s\S]*?"title":\{"runs":\[\{"text":"([^"]+)"\}\][\s\S]*?(?:"ownerText":\{"runs":\[\{"text":"([^"]+)"|"longBylineText":\{"runs":\[\{"text":"([^"]+)")/g;
  let m;
  while ((m = vrPattern.exec(html)) !== null) {
    hits.push({
      videoId: m[1],
      title: m[2],
      channel: (m[3] || m[4] || '').trim(),
    });
    if (hits.length >= 12) break;
  }

  // Prefer results from Tektronix channel; take first that matches.
  const fromTek = hits.find((h) => YT_CHANNEL_ALLOW.some((a) => h.channel.toLowerCase().includes(a)));
  if (fromTek) return fromTek;
  // Fallback: first result, but flag it (may be wrong)
  return hits[0] || null;
}

async function matchYouTubeEntry(entry: VideoEntry, force: boolean): Promise<VideoEntry> {
  if (entry.youtube_id && !force) {
    console.log(`  [skip yt-match] ${entry.title} — already matched (${entry.youtube_id})`);
    return entry;
  }
  console.log(`  [match-yt] ${entry.title}`);
  try {
    const hit = await searchYoutubeForTek(entry.title);
    if (!hit) {
      return { ...entry, youtube_match_lastTried: new Date().toISOString() };
    }
    const fromTek = YT_CHANNEL_ALLOW.some((a) => hit.channel.toLowerCase().includes(a));
    if (!fromTek) {
      console.log(`    (no Tektronix-channel match; top hit was "${hit.title}" from ${hit.channel}) — SKIPPING`);
      return { ...entry, youtube_match_lastTried: new Date().toISOString() };
    }
    console.log(`    → ${hit.videoId} / ${hit.title}`);
    return {
      ...entry,
      youtube_id: hit.videoId,
      youtube_title: hit.title,
      youtube_match_lastTried: new Date().toISOString(),
    };
  } catch (err) {
    console.log(`    match error: ${err instanceof Error ? err.message : String(err)}`);
    return { ...entry, youtube_match_lastTried: new Date().toISOString() };
  }
}

// ─── Transcription (YouTube captions) ────────────────────────────────
interface PyTranscriptResult {
  ok: boolean;
  entries?: Array<{ start: number; end: number; text: string }>;
  language?: string;
  error?: string;
}

function fetchYtTranscript(youtubeId: string): PyTranscriptResult {
  if (!commandExists(PYTHON_CMD)) {
    return { ok: false, error: `python not in PATH (tried ${PYTHON_CMD}); install python or set PYTHON_CMD` };
  }
  const result = spawnSync(PYTHON_CMD, [PY_TRANSCRIPT, youtubeId], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) return { ok: false, error: String(result.error) };
  const stdout = result.stdout || '';
  try {
    return JSON.parse(stdout) as PyTranscriptResult;
  } catch {
    return { ok: false, error: `helper returned non-JSON: ${stdout.slice(0, 200)}` };
  }
}

async function transcribeEntry(entry: VideoEntry, opts: CliOpts): Promise<VideoEntry> {
  if (!entry.youtube_id) {
    console.log(`  [skip transcribe] ${entry.title} — no youtube_id; run --match-yt first`);
    return entry;
  }
  if (entry.transcript_chunks && entry.transcript_chunks.length > 0 && !opts.forceTranscribe) {
    console.log(`  [skip transcribe] ${entry.title} — already has ${entry.transcript_chunks.length} chunks`);
    return entry;
  }
  console.log(`  [transcribe] ${entry.title} (${entry.youtube_id})`);
  const r = fetchYtTranscript(entry.youtube_id);
  if (!r.ok || !r.entries) {
    console.log(`    fail: ${r.error}`);
    return { ...entry, transcript_error: r.error || 'unknown', transcript_lastFetched: new Date().toISOString() };
  }
  const chunks: TranscriptChunk[] = r.entries.map((e) => ({
    start: +e.start.toFixed(2),
    end: +e.end.toFixed(2),
    text: e.text,
  }));
  console.log(`    ok: ${chunks.length} chunks, ${chunks.reduce((a, c) => a + c.text.length, 0)} chars`);
  const entryOut: VideoEntry = {
    ...entry,
    transcript_chunks: chunks,
    transcript_source: `youtube-${r.language || 'en'}-auto`,
    transcript_lastFetched: new Date().toISOString(),
  };
  delete entryOut.transcript_error;
  return entryOut;
}

// ─── Product-family tagger ───────────────────────────────────────────
// Heuristic map from title/description keywords → product family keys.
// Order matters for ambiguous cases — more specific patterns first.
interface FamilyRule {
  family: string;
  test: RegExp;
}

const FAMILY_RULES: FamilyRule[] = [
  // 6 Series B before 6 Series (more specific)
  { family: 'MSO6B', test: /\b(6\s*Series\s*B\s*MSO|MSO(?:64|66|68)B|6-Series-B)\b/i },
  { family: 'MSO6',  test: /\b(6\s*Series\s*MSO|MSO(?:64|66|68)(?!B)|6-Series-MSO)\b/i },
  { family: 'MSO5B', test: /\b(5\s*Series\s*B\s*MSO|MSO5[468]B)\b/i },
  { family: 'MSO5',  test: /\b(5\s*Series\s*MSO|MSO5[468](?!B)|5-Series-MSO)\b/i },
  { family: 'MSO4B', test: /\b(4\s*Series\s*B\s*MSO|MSO4[46]B)\b/i },
  { family: 'MSO4',  test: /\b(4\s*Series\s*MSO|MSO4[46](?!B)|4-Series-MSO)\b/i },
  { family: 'MSO2',  test: /\b(2\s*Series\s*MSO|MSO2[24]|2-Series-MSO)\b/i },
  { family: 'MDO3',  test: /\b(3\s*Series\s*MDO|MDO3(?!000))\b/i },
  { family: 'MDO4',  test: /\b(4\s*Series\s*MDO|MDO4(?!000))\b/i },
  { family: 'MDO3000', test: /\bMDO3\d{3}\b/i },
  { family: 'MDO4000', test: /\bMDO4\d{3}[A-C]?\b/i },
  { family: 'DPO70000', test: /\bDPO70\d{3}(?:C|DX|SX)?\b|\b70000\s*Series\b/i },
  { family: 'DPO7000',  test: /\b7\s*Series\s*DPO\b|\bDPO7(?!0)/i },
  { family: 'DPO5000',  test: /\bDPO5\d{3}B?\b|\bMSO5\d{3}B?\b/i },
  { family: 'DPO4000',  test: /\b(MSO\/DPO|DPO)4\d{3}B?\b/i },
  { family: 'DPO3000',  test: /\b(MSO\/DPO|DPO)3\d{3}B?\b/i },
  { family: 'DPO2000',  test: /\b(MSO\/DPO|DPO)2\d{3}B?\b/i },
];

function tagProducts(title: string, description: string): string[] {
  const hay = `${title} ${description}`;
  const out = new Set<string>();
  for (const r of FAMILY_RULES) {
    if (r.test.test(hay)) out.add(r.family);
  }
  if (out.size === 0) out.add('general');
  return Array.from(out);
}

function deriveTagsFromTitle(title: string): string[] {
  const tags = new Set<string>();
  const low = title.toLowerCase();
  const hints: Array<[RegExp, string]> = [
    [/^how to|\bhow to\b/, 'how-to'],
    [/\bintroduction\b|\boverview\b|\bhighlights\b/, 'overview'],
    [/\bchapter\s+\d+\b/i, 'chapter-series'],
    [/\bdemo\b/, 'demo'],
    [/\bjitter\b/, 'jitter'],
    [/\bcursor/, 'cursors'],
    [/\bmeasurement|\bmeasure/, 'measurement'],
    [/\bspectrum|\bRF\b/i, 'spectrum'],
    [/\bpower\b/, 'power'],
    [/\btrigger/, 'trigger'],
    [/\bprobe/, 'probing'],
    [/\bDDR|\bDDR\d/i, 'ddr'],
    [/\bEthernet|\bI2C|\bSPI|\bCAN|\bUSB|\bLIN|\bRS232/i, 'protocol-decode'],
    [/\beye\s*diagram\b/, 'eye-diagram'],
    [/\bde-embed|embedding/i, 'de-embedding'],
  ];
  for (const [re, tag] of hints) if (re.test(low)) tags.add(tag);
  return Array.from(tags);
}

// ─── Channel sweep (YouTube) ─────────────────────────────────────────
interface ChannelVideo {
  id: string;
  title: string;
  description?: string;
  duration_s?: number;
  url: string;
}

interface ChannelDump {
  ok: boolean;
  channel?: string;
  channel_id?: string;
  count?: number;
  videos?: ChannelVideo[];
  error?: string;
}

function fetchChannelList(maxVideos: number): ChannelDump {
  if (!commandExists(PYTHON_CMD)) {
    return { ok: false, error: `python not in PATH (tried ${PYTHON_CMD})` };
  }
  const args = [PY_CHANNEL];
  if (maxVideos > 0) args.push(String(maxVideos));
  const result = spawnSync(PYTHON_CMD, args, {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) return { ok: false, error: String(result.error) };
  const stdout = result.stdout || '';
  try { return JSON.parse(stdout) as ChannelDump; }
  catch { return { ok: false, error: `channel helper returned non-JSON: ${stdout.slice(0, 300)}` }; }
}

function ytEntryFromChannel(v: ChannelVideo, existing: VideoEntry | null): VideoEntry {
  const products = (existing?.products && existing.products.length > 0)
    ? existing.products
    : tagProducts(v.title, v.description || '');
  const tagsFromTitle = deriveTagsFromTitle(v.title);
  const mergedTags = Array.from(new Set([...(existing?.tags || []), ...tagsFromTitle]));
  const durationMs = v.duration_s ? Math.round(v.duration_s * 1000) : existing?.duration_ms;
  return {
    id: existing?.id || `tek-yt-${v.id}`,
    title: v.title,
    url: v.url,
    category: existing?.category || 'youtube',
    products,
    tags: mergedTags,
    summary: existing?.summary || (v.description || '').slice(0, 500) || v.title,
    ...(durationMs ? { duration_ms: durationMs, duration: fmtDuration(durationMs) } : {}),
    youtube_id: v.id,
    youtube_title: v.title,
    youtube_match_lastTried: new Date().toISOString(),
    ...(existing?.brightcove_account ? { brightcove_account: existing.brightcove_account } : {}),
    ...(existing?.brightcove_video_id ? { brightcove_video_id: existing.brightcove_video_id } : {}),
    ...(existing?.mp4_url ? { mp4_url: existing.mp4_url } : {}),
    ...(existing?.transcript_chunks ? { transcript_chunks: existing.transcript_chunks } : {}),
    ...(existing?.transcript_source ? { transcript_source: existing.transcript_source } : {}),
    ...(existing?.transcript_lastFetched ? { transcript_lastFetched: existing.transcript_lastFetched } : {}),
    ...(existing?.page_lastFetched ? { page_lastFetched: existing.page_lastFetched } : {}),
  };
}

// ─── Store I/O ────────────────────────────────────────────────────────
function readStore(): VideosStore {
  try {
    const raw = fs.readFileSync(VIDEOS_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.videos)) return parsed as VideosStore;
  } catch { /* fresh */ }
  return { $schema: 'videos.v1', note: 'Curated index of Tektronix instructional videos.', phase: 'production', videos: [] };
}

function writeStore(store: VideosStore) {
  fs.mkdirSync(path.dirname(VIDEOS_PATH), { recursive: true });
  const tmp = `${VIDEOS_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf-8');
  fs.renameSync(tmp, VIDEOS_PATH);
}

// ─── Channel-sweep main ──────────────────────────────────────────────
async function runChannelSweep(opts: CliOpts, store: VideosStore): Promise<void> {
  console.log(`[channel-sweep] max=${opts.maxVideos || 'all'}`);
  const dump = fetchChannelList(opts.maxVideos);
  if (!dump.ok || !dump.videos) {
    console.error(`[fatal] channel list failed: ${dump.error}`);
    process.exit(1);
  }
  console.log(`[channel-sweep] ${dump.count} videos from ${dump.channel}`);

  // Index existing store by youtube_id so we merge with the tek.com-matched
  // entries (keeping Brightcove data, hand-curated summaries, etc.).
  const byYtId = new Map<string, VideoEntry>();
  for (const v of store.videos) if (v.youtube_id) byYtId.set(v.youtube_id, v);

  let touched = 0;
  let transcribed = 0;
  let skipped = 0;
  let failed = 0;

  for (const [idx, yv] of (dump.videos || []).entries()) {
    try {
      const existing = byYtId.get(yv.id) || null;
      let entry = ytEntryFromChannel(yv, existing);

      // Transcript
      const hasChunks = entry.transcript_chunks && entry.transcript_chunks.length > 0;
      if (!hasChunks || opts.forceTranscribe) {
        entry = await transcribeEntry(entry, opts);
        if (entry.transcript_chunks && entry.transcript_chunks.length > 0) transcribed++;
      } else {
        skipped++;
      }

      byYtId.set(yv.id, entry);
      touched++;
      if ((idx + 1) % 10 === 0) {
        console.log(`  [progress] ${idx + 1}/${dump.count} touched=${touched} transcribed=${transcribed} failed=${failed}`);
      }
      await sleep(RATE_LIMIT_MS / 2); // lighter rate on YouTube — we're just reading captions
    } catch (err) {
      failed++;
      console.error(`  [fail] yt=${yv.id} — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Merge back: preserve existing non-YT entries too.
  const merged = new Map<string, VideoEntry>();
  for (const v of store.videos) merged.set(v.id, v);
  for (const v of byYtId.values()) merged.set(v.id, v);
  store.videos = Array.from(merged.values()).sort((a, b) => a.id.localeCompare(b.id));
  store.lastUpdated = new Date().toISOString().slice(0, 10);
  writeStore(store);

  console.log(`[done] touched=${touched} transcribed=${transcribed} skipped=${skipped} failed=${failed} total_in_store=${store.videos.length}`);
}

// ─── Main ────────────────────────────────────────────────────────────
async function main() {
  const opts = parseArgs(process.argv);
  console.log(`[scrape] mode=${opts.mode} family=${opts.family || 'all'}`);

  const store = readStore();

  if (opts.mode === 'channel-sweep') {
    await runChannelSweep(opts, store);
    return;
  }

  const urls: UrlsFile = JSON.parse(fs.readFileSync(URLS_PATH, 'utf-8'));
  const byUrl = new Map<string, VideoEntry>();
  for (const v of store.videos) byUrl.set(v.url, v);

  const families = opts.family ? [opts.family] : Object.keys(urls.families);
  let touched = 0;
  let failed = 0;

  for (const family of families) {
    const urlList = urls.families[family] || [];
    if (urlList.length === 0) { console.log(`[family ${family}] no URLs, skip`); continue; }
    console.log(`[family ${family}] ${urlList.length} URL(s)`);
    for (const url of urlList) {
      try {
        let entry = byUrl.get(url) || null;

        // Stage 1: collect Brightcove metadata if needed
        const needsCollect = opts.mode === 'collect' || opts.mode === 'all' || !entry?.brightcove_video_id;
        if (needsCollect) {
          entry = await collectEntry(url, family, entry);
          await sleep(RATE_LIMIT_MS);
        }
        if (!entry) continue;

        // Stage 2: match YouTube mirror
        const needsMatch = opts.mode === 'match-yt' || opts.mode === 'all' || (opts.mode === 'transcribe' && !entry.youtube_id);
        if (needsMatch) {
          entry = await matchYouTubeEntry(entry, opts.forceMatch);
          await sleep(RATE_LIMIT_MS);
        }

        // Stage 3: fetch transcript via YouTube captions
        if ((opts.mode === 'transcribe' || opts.mode === 'all') && entry.youtube_id) {
          entry = await transcribeEntry(entry, opts);
        }

        byUrl.set(url, entry);
        touched++;
      } catch (err) {
        failed++;
        console.error(`  [fail] ${url} — ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  store.videos = Array.from(byUrl.values()).sort((a, b) => a.id.localeCompare(b.id));
  store.lastUpdated = new Date().toISOString().slice(0, 10);
  writeStore(store);

  const withTranscripts = store.videos.filter((v) => v.transcript_chunks && v.transcript_chunks.length > 0).length;
  console.log(`[done] touched=${touched} failed=${failed} total=${store.videos.length} with_transcripts=${withTranscripts}`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('[fatal]', err instanceof Error ? err.stack || err.message : String(err));
  process.exit(1);
});
