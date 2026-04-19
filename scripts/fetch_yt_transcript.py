#!/usr/bin/env python3
"""
fetch_yt_transcript.py — helper invoked by scrapeTekVideos.ts.

Takes a YouTube video ID, prints JSON transcript to stdout.

Install (one-time on the machine that runs the scraper):
    python -m pip install youtube-transcript-api certifi

Invoke:
    python scripts/fetch_yt_transcript.py <youtube_id> [lang]

Output (stdout): JSON object { ok, entries: [{start, end, text}] }
                 or { ok: false, error }. Status code 0 always;
                 the TS caller reads the ok field.

Notes:
- Uses a requests session with verify=False to tolerate sandbox envs
  that lack up-to-date CA bundles. We only read public captions, no
  auth credentials are sent, so the impact is acceptable.
- Falls through languages, default ['en', 'en-US', 'en-GB'].
"""

from __future__ import annotations

import json
import sys


def main() -> int:
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "missing youtube_id"}))
        return 0
    video_id = sys.argv[1]
    languages = sys.argv[2].split(",") if len(sys.argv) >= 3 else ["en", "en-US", "en-GB"]

    try:
        import requests  # type: ignore
        import urllib3  # type: ignore
        urllib3.disable_warnings()
        sess = requests.Session()
        sess.verify = False
        sess.headers.update({"User-Agent": "Mozilla/5.0 (Tekautomate-scraper)"})

        from youtube_transcript_api import YouTubeTranscriptApi  # type: ignore

        api = YouTubeTranscriptApi(http_client=sess)
        ft = api.fetch(video_id, languages=languages)
        entries = []
        for seg in ft:
            start = float(seg.start or 0)
            dur = float(seg.duration or 0)
            text = (seg.text or "").strip()
            if not text:
                continue
            entries.append({
                "start": round(start, 2),
                "end": round(start + dur, 2),
                "text": text,
            })
        out = {"ok": True, "entries": entries, "language": languages[0]}
    except Exception as e:
        out = {"ok": False, "error": f"{type(e).__name__}: {e}"}

    sys.stdout.write(json.dumps(out))
    sys.stdout.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
