/**
 * scrapeTekVideos.ts — Phase 1 scaffold (NOT READY TO RUN — see below).
 *
 * Populates data/videos.json by scraping Tektronix video pages across
 * product families. Phase 0 shipped the retrieval infrastructure and a
 * hand-curated MSO2 seed; this script is the path to scaling the index
 * to every family.
 *
 * ─── Status ───
 * Scaffold. Do not run against live tek.com yet. The exact URL shape
 * for tek.com's video listing pages needs confirmation (product-support
 * page doesn't expose videos; they live under /en/video/how-to/* and
 * /en/video/product-features/*). Run approach A first manually for a
 * few URLs to validate the parser, then wire it up here.
 *
 * ─── Planned pipeline ───
 * 1. Load per-family video-URL seed list from scripts/tek_video_urls.json
 *    (to be created — one entry per product family; each an array of
 *    canonical video page URLs on tek.com).
 * 2. For each URL:
 *    a. Fetch page HTML (rate-limited, 1 req/sec).
 *    b. Extract: <title>, og:description, page body summary, duration
 *       if present, product tags from breadcrumb/category.
 *    c. If a YouTube embed is present, extract the youtubeId so we can
 *       later fetch captions. If a tek.com-hosted MP4 is present,
 *       record the media URL for a future Whisper pass.
 *    d. Assemble a VideoEntry record.
 * 3. Deduplicate by URL. Merge with existing data/videos.json entries
 *    (preserve hand-edited summaries if present; refresh URL-derived
 *    fields).
 * 4. Write atomic (tmp + rename), bump lastUpdated.
 *
 * ─── Transcript strategy (later phase) ───
 * A. YouTube auto-captions: fetch via timedtext API for each youtubeId.
 *    Cheap, in-band, quality varies.
 * B. Whisper pass over tek.com-hosted audio: highest quality, needs
 *    ffmpeg + whisper.cpp, runs offline.
 * C. Tek.com-supplied transcripts: rare; parse when present.
 * Start with (A); fall back to (C); (B) for high-priority gaps.
 *
 * ─── Run (once ready) ───
 *   npx tsx scripts/scrapeTekVideos.ts --family MSO2
 *   npx tsx scripts/scrapeTekVideos.ts --all
 */

// This file is an intentional scaffold. It deliberately does not
// import anything so it won't pull into the runtime bundle. When
// you're ready to implement, replace this header with the pipeline
// above.

export {};
