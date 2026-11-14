# ChoreoLoop

Lightweight, offline-first Progressive Web App (PWA) for dancers to practice choreography with A-B looping, slow-motion speed control, video mirror mode, and a count-in timer.

## Features

- **Local Audio & Video Import:** Import MP3, M4A, WAV, MP4, or MOV files directly from iOS Files/Photos or desktop. Everything is stored locally in IndexedDB with zero server uploads.
- **A-B Loop Studio:** One-handed touch controls for Set A, Set B, Loop On/Off, Clear A-B, `-0.5s`/`+0.5s` fine-tuning, visual loop range on the timeline, and named loop bookmarks (e.g. Chorus, Bridge).
- **Slow-Motion Playback:** Quick presets (`0.5x`, `0.75x`, `0.85x`, `1.0x`) and continuous slider (`0.25x` to `1.25x`) with pitch preservation.
- **Dance Extras:** Horizontal video Mirror Mode (`scaleX(-1)`) and optional Count-In pre-roll timer (`3s` or `5s`).
- **Offline PWA:** Full `manifest.json`, iOS home screen support, and Service Worker caching for offline studio use.

## Local Development

```bash
npm install
npm run dev
```

Build for production:

```bash
npm run build
npm run preview
```

## License

MIT License © 2026 LycosLane
