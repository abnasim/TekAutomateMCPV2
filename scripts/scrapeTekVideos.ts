/**
 * scrapeTekVideos.ts  —  Tek.com video → Brightcove metadata → audio → Whisper transcript.
 *
 * Runs locally (NOT in production runtime). Populates data/videos.json from
 * scripts/tek_video_urls.json. Idempotent: skips videos already fully
 * populated, re-runs only missing stages.
 *
 * ─── Pipeline ───
 * 1. Read seed URL list (scripts/tek_video_urls.json), per-family.
 * 2. For each URL:
 *    a. Fetch the tek.com page HTML → extract data-video-id + data-account.
 *    b. Fetch the Brightcove iframe page → extract policyKey.
 *    c. Call Brightcove Playback API → get metadata (name, description,
 *       duration, MP4 source URL).
 *    d. If no existing transcript and --transcribe is passed, download
 *       the MP4 audio track via ffmpeg, run openai-whisper CLI, parse
 *       the .json output into transcript_chunks[{start,end,text}].
 * 3. Merge into data/videos.json. Preserve hand-edited summaries
 *    (don't clobber non-empty existing summary unless --force-summary).
 * 4. Atomic write (tmp + rename) + bump lastUpdated.
 *
 * ─── Install requirements (local) ───
 *   # Node/tsx (already present in repo)
 *   # Python Whisper:
 *   pip install -U openai-whisper
 *   # ffmpeg must be in PATH:
 *   winget install ffmpeg   # Windows
 *   brew install ffmpeg     # macOS
 *   apt-get install ffmpeg  # Debian/Ubuntu
 *
 * ─── Run ───
 *   # collect metadata only (fast; no transcription)
 *   npx tsx scripts/scrapeTekVideos.ts --collect
 *
 *   # full pipeline (downloads audio + transcribes — slow, heavy)
 *   npx tsx scripts/scrapeTekVideos.ts --all
 *
 *   # restrict to a single family
 *   npx tsx scripts/scrapeTekVideos.ts --all --family MSO2
 *
 *   # use a smaller Whisper model (faster, lower accuracy)
 *   WHISPER_MODEL=medium npx tsx scripts/scrapeTekVideos.ts --all
 *
 *   # force re-transcription even if chunks already exist
 *   npx tsx scripts/scrapeTekVideos.ts --all --force-transcribe
 *
 *
 * ─── Caveats ───
 * - Tek.com publishes NO captions to Brightcove (verified for MSO2);
 *   Whisper is the only transcript path.
 * - Brightcove's policyKey is per-account/per-player; extracted once
 *   from the iframe page and cached in memory for the batch.
 * - Rate-limited: 1 request/sec to tek.com + Brightcove.
 * - Audio downloaded to system temp dir, cleaned up per-video unless
 *   --keep-audio is passed (useful for re-transcribing with a
 *   different model later).
 */

import { execFileSync, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

// ─── Paths ───────────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const _scriptDir = path.dirname(__filename);
const _projectRoot = path.resolve(_scriptDir, '..');
const URLS_PATH = path.join(_scriptDir, 'tek_video_urls.json');
const VIDEOS_PATH = path.join(_projectRoot, 'data', 'videos.json');

// ─── Config ──────────────────────────────────────────────────────────
const WHISPER_MODEL = process.env.WHISPER_MODEL || 'large-v3';
const RATE_LIMIT_MS = 1000;
const USER_AGENT = 'Mozilla/5.0 (Tekautomate-scraper)';

// ─── CLI parsing ─────────────────────────────────────────────────────
interface CliOpts {
  mode: 'collect' | 'transcribe' | 'all';
  family: string | null;
  forceSummary: boolean;
  forceTranscribe: boolean;
  keepAudio: boolean;
}

function parseArgs(argv: string[]): CliOpts {
  const opts: CliOpts = {
    mode: 'collect',
    family: null,
    forceSummary: false,
    forceTranscribe: false,
    keepAudio: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--collect') opts.mode = 'collect';
    else if (a === '--transcribe') opts.mode = 'transcribe';
    else if (a === '--all') opts.mode = 'all';
    else if (a === '--family') opts.family = argv[++i] || null;
    else if (a === '--force-summary') opts.forceSummary = true;
    else if (a === '--force-transcribe') opts.forceTranscribe = true;
    else if (a === '--keep-audio') opts.keepAudio = true;
    else if (a === '--help' || a === '-h') {
      console.log(`usage: npx tsx scripts/scrapeTekVideos.ts [--collect|--transcribe|--all] [--family <name>] [--force-summary] [--force-transcribe] [--keep-audio]`);
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
  start: number; // seconds
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
  duration?: string; // "mm:ss"
  brightcove_account?: string;
  brightcove_video_id?: string;
  mp4_url?: string;
  transcript_chunks?: TranscriptChunk[];
  transcript_lastFetched?: string;
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
const policyKeyCache = new Map<string, string>(); // cache per account/player pair

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
  duration?: number; // ms
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
  // Prefer MP4, highest height ≤ 720 (enough for audio, smaller download)
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
  const summary = (existing?.summary && !existing.summary.startsWith('Short introduction') && existing.summary.length > 40)
    ? existing.summary
    : (bc.description || existing?.summary || '');
  const mp4 = pickBestMp4Source(bc.sources);
  const products = existing?.products && existing.products.length > 0
    ? existing.products
    : [family];

  const entry: VideoEntry = {
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
    ...(existing?.transcript_chunks ? { transcript_chunks: existing.transcript_chunks } : {}),
    ...(existing?.transcript_lastFetched ? { transcript_lastFetched: existing.transcript_lastFetched } : {}),
    page_lastFetched: new Date().toISOString(),
  };
  return entry;
}

// ─── Transcription ───────────────────────────────────────────────────
interface WhisperSegment {
  id?: number;
  start: number;
  end: number;
  text: string;
}

interface WhisperJson {
  text?: string;
  segments?: WhisperSegment[];
  language?: string;
}

function ensureAudioFile(mp4Url: string, workDir: string, videoId: string): string {
  // Use ffmpeg to stream-extract audio only. Output is a compact WAV file.
  const audioPath = path.join(workDir, `${videoId}.wav`);
  if (fs.existsSync(audioPath)) return audioPath;
  console.log(`    [ffmpeg] ${mp4Url} → ${path.basename(audioPath)}`);
  execFileSync(
    'ffmpeg',
    [
      '-y', '-hide_banner', '-loglevel', 'warning',
      '-i', mp4Url,
      '-vn', '-ac', '1', '-ar', '16000', '-acodec', 'pcm_s16le',
      audioPath,
    ],
    { stdio: 'inherit' },
  );
  return audioPath;
}

function whisperTranscribe(audioPath: string, workDir: string): TranscriptChunk[] {
  console.log(`    [whisper] model=${WHISPER_MODEL} ${path.basename(audioPath)}`);
  // openai-whisper CLI writes <basename>.json next to the audio file
  execFileSync(
    'whisper',
    [
      audioPath,
      '--model', WHISPER_MODEL,
      '--output_dir', workDir,
      '--output_format', 'json',
      '--language', 'en',
      '--verbose', 'False',
    ],
    { stdio: 'inherit' },
  );
  const jsonPath = audioPath.replace(/\.wav$/, '.json');
  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) as WhisperJson;
  const segments = data.segments || [];
  return segments.map((s) => ({
    start: +s.start.toFixed(2),
    end: +s.end.toFixed(2),
    text: s.text.trim(),
  }));
}

async function transcribeEntry(entry: VideoEntry, opts: CliOpts): Promise<VideoEntry> {
  if (!entry.mp4_url) {
    console.log(`  [skip transcribe] ${entry.title} — no mp4_url; run --collect first`);
    return entry;
  }
  if (entry.transcript_chunks && entry.transcript_chunks.length > 0 && !opts.forceTranscribe) {
    console.log(`  [skip transcribe] ${entry.title} — already has ${entry.transcript_chunks.length} chunks (pass --force-transcribe to redo)`);
    return entry;
  }
  if (!commandExists('ffmpeg')) throw new Error('ffmpeg not found in PATH');
  if (!commandExists('whisper')) throw new Error('whisper not found in PATH (pip install openai-whisper)');

  const workDir = path.join(os.tmpdir(), 'tekautomate-video-transcribe');
  fs.mkdirSync(workDir, { recursive: true });
  const videoId = entry.brightcove_video_id || slugify(entry.title);

  console.log(`  [transcribe] ${entry.title}`);
  const audioPath = ensureAudioFile(entry.mp4_url, workDir, videoId);
  const chunks = whisperTranscribe(audioPath, workDir);

  if (!opts.keepAudio) {
    try { fs.unlinkSync(audioPath); } catch { /* ignore */ }
    try { fs.unlinkSync(audioPath.replace(/\.wav$/, '.json')); } catch { /* ignore */ }
  }

  return {
    ...entry,
    transcript_chunks: chunks,
    transcript_lastFetched: new Date().toISOString(),
  };
}

// ─── Store I/O ────────────────────────────────────────────────────────
function readStore(): VideosStore {
  try {
    const raw = fs.readFileSync(VIDEOS_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.videos)) return parsed as VideosStore;
  } catch { /* fresh */ }
  return {
    $schema: 'videos.v1',
    note: 'Curated index of Tektronix instructional videos.',
    phase: 'production',
    videos: [],
  };
}

function writeStore(store: VideosStore) {
  const dir = path.dirname(VIDEOS_PATH);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${VIDEOS_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf-8');
  fs.renameSync(tmp, VIDEOS_PATH);
}

// ─── Main ────────────────────────────────────────────────────────────
async function main() {
  const opts = parseArgs(process.argv);
  console.log(`[scrape] mode=${opts.mode} family=${opts.family || 'all'}`);

  const urls: UrlsFile = JSON.parse(fs.readFileSync(URLS_PATH, 'utf-8'));
  const store = readStore();
  const byUrl = new Map<string, VideoEntry>();
  for (const v of store.videos) byUrl.set(v.url, v);

  const families = opts.family ? [opts.family] : Object.keys(urls.families);
  let touched = 0;
  let failed = 0;

  for (const family of families) {
    const urlList = urls.families[family] || [];
    if (urlList.length === 0) {
      console.log(`[family ${family}] no URLs in seed list, skip`);
      continue;
    }
    console.log(`[family ${family}] ${urlList.length} URL(s)`);
    for (const url of urlList) {
      try {
        let entry = byUrl.get(url) || null;
        const alreadyComplete = entry
          && entry.brightcove_video_id
          && (opts.mode === 'collect' || (entry.transcript_chunks && entry.transcript_chunks.length > 0));
        if (alreadyComplete && !opts.forceSummary && !opts.forceTranscribe) {
          console.log(`  [skip] ${url} — already complete for mode ${opts.mode}`);
          continue;
        }

        if (opts.mode === 'collect' || opts.mode === 'all' || !entry) {
          entry = await collectEntry(url, family, entry);
          await sleep(RATE_LIMIT_MS);
        }
        if ((opts.mode === 'transcribe' || opts.mode === 'all') && entry) {
          entry = await transcribeEntry(entry, opts);
        }
        if (entry) {
          byUrl.set(url, entry);
          touched++;
        }
      } catch (err) {
        failed++;
        console.error(`  [fail] ${url} — ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // Merge back into store
  store.videos = Array.from(byUrl.values()).sort((a, b) => a.id.localeCompare(b.id));
  store.lastUpdated = new Date().toISOString().slice(0, 10);
  writeStore(store);

  console.log(`[done] touched=${touched} failed=${failed} total_in_store=${store.videos.length}`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('[fatal]', err instanceof Error ? err.stack || err.message : String(err));
  process.exit(1);
});
