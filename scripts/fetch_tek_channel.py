#!/usr/bin/env python3
"""
fetch_tek_channel.py — dump the @tektronix YouTube channel video list.

Uses yt-dlp's flat extract mode to get every video's id + title without
downloading video content. Writes JSON to stdout.

Install:
    python -m pip install yt-dlp

Invoke:
    # full @tektronix channel (optional video limit):
    python scripts/fetch_tek_channel.py [max_videos]
    # a specific playlist:
    python scripts/fetch_tek_channel.py --playlist <playlist_id_or_url> [max_videos]

Output (stdout): JSON object { ok, source, count, videos: [{...}] }
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
    args = sys.argv[1:]
    playlist_arg = None
    max_videos = 0
    if args and args[0] == '--playlist':
        if len(args) < 2:
            print(json.dumps({'ok': False, 'error': '--playlist requires an ID or URL'}))
            return 0
        playlist_arg = args[1]
        if len(args) >= 3:
            try: max_videos = int(args[2])
            except Exception: max_videos = 0
    elif args:
        try: max_videos = int(args[0])
        except Exception: max_videos = 0

    if playlist_arg:
        if playlist_arg.startswith('http'):
            url = playlist_arg
        else:
            url = f'https://www.youtube.com/playlist?list={playlist_arg}'
        source = f'playlist:{playlist_arg}'
    else:
        url = 'https://www.youtube.com/@tektronix/videos'
        source = 'channel:@tektronix'

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
            info = ydl.extract_info(url, download=False)

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
            'source': source,
            'channel': info.get('channel') or info.get('uploader'),
            'channel_id': info.get('channel_id'),
            'playlist_id': info.get('id') if playlist_arg else None,
            'playlist_title': info.get('title') if playlist_arg else None,
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
