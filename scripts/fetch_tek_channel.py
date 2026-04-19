#!/usr/bin/env python3
"""
fetch_tek_channel.py — dump the @tektronix YouTube channel video list.

Uses yt-dlp's flat extract mode to get every video's id + title without
downloading video content. Writes JSON to stdout.

Install:
    python -m pip install yt-dlp

Invoke:
    python scripts/fetch_tek_channel.py [max_videos]

Output (stdout): JSON object { ok, channel, count, videos: [{...}] }
                 or { ok: false, error }. Always exits 0; TS caller
                 reads the ok field.

Each video entry: { id, title, description?, duration_s?, url }
"""

from __future__ import annotations

import json
import ssl
import sys

# Windows Store Python doesn't ship a CA bundle; bypass verification.
# We only read public channel metadata. No auth credentials are sent.
ssl._create_default_https_context = ssl._create_unverified_context


def main() -> int:
    max_videos = int(sys.argv[1]) if len(sys.argv) >= 2 else 0  # 0 = all

    try:
        import yt_dlp  # type: ignore
        ydl_opts = {
            'extract_flat': True,
            'skip_download': True,
            'quiet': True,
            'no_warnings': True,
            'nocheckcertificate': True,
        }
        if max_videos > 0:
            ydl_opts['playlistend'] = max_videos

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info('https://www.youtube.com/@tektronix/videos', download=False)

        entries_raw = info.get('entries') or []
        entries = []
        for e in entries_raw:
            if not e:
                continue
            vid = e.get('id')
            if not vid:
                continue
            entries.append({
                'id': vid,
                'title': (e.get('title') or '').strip(),
                'description': (e.get('description') or '').strip()[:2000],
                'duration_s': e.get('duration'),
                'url': e.get('url') or f'https://www.youtube.com/watch?v={vid}',
            })

        out = {
            'ok': True,
            'channel': info.get('channel'),
            'channel_id': info.get('channel_id'),
            'count': len(entries),
            'videos': entries,
        }
    except Exception as e:
        out = {'ok': False, 'error': f'{type(e).__name__}: {e}'}

    sys.stdout.write(json.dumps(out))
    sys.stdout.flush()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
