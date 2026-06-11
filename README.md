# TrackLens PWA

TrackLens is a private, offline-first progress tracking app.

## Features

- Offline-first installable PWA for iPhone Safari and Android Chrome
- Daily photo capture/upload using file input with camera capture hint
- Images are compressed and stored only in IndexedDB (no gallery write)
- One entry per date (`date` as primary key)
- Backdated entries with edit-on-existing behavior
- Current and longest streak calculation
- Timeline with lazy loaded images
- Compare two dates with side-by-side image and note view
- Backup export/import using JSON
- Timelapse video export (WebM via MediaRecorder)
- iOS-compatible fallback export of image set JSON when recording is unsupported

## Run locally

Serve as static files:

```powershell
cd "c:\Users\Joel\Desktop\project A\tutorial\tracker"
python -m http.server 5173
```

Open: `http://localhost:5173`

## Production deploy

Deploy this folder to any static host (GitHub Pages, Netlify, Vercel static output, Cloudflare Pages).

## Notes

- First load requires internet one time (to cache shell and idb ESM dependency).
- After first successful load, the app works offline.
- Backup/import and export actions intentionally create downloaded files.
