<p align="center">
  <img src="public/icons/choreoloop.svg" width="128" alt="ChoreoLoop White Fedora Icon" />
</p>

# ChoreoLoop

[![Free & Open Source](https://img.shields.io/badge/Open%20Source-FOSS-brightgreen.svg)](LICENSE)
[![Platform: iOS | Android | Desktop](https://img.shields.io/badge/Platform-iOS%20%7C%20Android%20%7C%20Desktop-0078D6.svg)](https://github.com/LycosLane/choreoloop)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Telemetry: Zero](https://img.shields.io/badge/Telemetry-Zero-brightgreen.svg)]()
[![Ads: None](https://img.shields.io/badge/Ads-None-success.svg)]()

> **Free, open-source dance practice player and A-B looper.**  
> Load a video or song from your device or YouTube, loop any section from A to B, and practice at your own tempo.  
> *Works in your browser or as an installed app on iPhone, Android, and desktop. No account, no ads, and zero tracking.*

---

## Features

* **Local Files (+ File):** Play audio (`MP3`, `M4A`, `WAV`, `AAC`, `OGG`) and video (`MP4`, `MOV`, `WebM`) directly on your device. Save a local copy in your browser for offline practice, or stream large videos without using extra storage.
* **YouTube Practice (+ YouTube):** Paste any YouTube link or share directly from the YouTube app on Android to practice with A-B looping, speed presets, and count-in.
* **A-B Looping & Bookmarks:** One-tap `Set A`, `Set B`, `Loop`, `Restart A`, fine-tune steppers (`0.1s`, `0.25s`, `0.5s`), and 1-tap named loop bookmarks (`Intro`, `Verse`, `Chorus`, `Bridge`, `8-Count`, or custom).
* **Practice at Your Tempo:** Slow down or speed up without changing pitch (`0.25x` to `1.25x`) using quick presets (`0.5x`, `0.75x`, `0.9x`, `1.0x`), `-5%` / `+5%` steppers, or the slider.
* **Mirror, Zoom & Fullscreen:** Flip videos horizontally (`Mirror`) to match your view, pinch with two fingers to zoom (`1x` to `3x`) and pan, or switch to fullscreen with auto-hiding controls.
* **Count-In & Tap Tempo:** Silent visual countdown (`3s` or `5s`) or beat-synced count-in (`1-16` beats) with live **Tap Tempo**, selectable count-in sounds (`Wood`, `Click`, `Beep`), volume control, and `Each Loop` repeat.
* **Built for Practice:** Keeps your screen awake during breaks, supports Bluetooth headphones and remotes, and adapts the app icon to Light or Dark mode.

---

## Local Files vs. YouTube Links

| Feature | Local File | YouTube Link |
| :--- | :--- | :--- |
| **Works Offline** | Yes (with Keep Copy on) | Not supported by YouTube |
| **Mirror Mode & Fullscreen** | Yes | Not supported by YouTube |
| **Slow-Motion Speed** | Smooth `0.25x` - `1.25x` | Fixed API steps (`0.25x`, `0.5x`, `0.75x`, `1.0x`, `1.25x`) |
| **A-B Loop & Bookmarks** | Yes (frame-accurate) | Yes (online buffering) |

---

## Install as an App & Offline Use

* **iPhone / iPad (Safari):** Tap **Share** -> **Add to Home Screen**.
* **Android (Chrome / Samsung Internet):** Tap browser **Menu** -> **Install app** / **Add to Home screen**.
* **Icon Tip:** Switch between Dark Mode (White Fedora) and Light Mode (Black Fedora) before saving to your Home Screen.
* **Offline Tip:** Refresh once while online before heading to dance class or rehearsal without mobile data. Your local library and bookmarks are never deleted on refresh.

---

## Privacy & Storage

* **100% Private:** Nothing is uploaded to any server. All files, loops, and settings stay inside your browser's local storage.
* **Original Files Untouched:** Removing a track in ChoreoLoop only deletes ChoreoLoop's entry or cached copy. Your original file on your phone or SD card is never modified or deleted.
* **Keep Copy vs. Stream Mode:** For large files (> 250 MB) or caches (> 500 MB), ChoreoLoop lets you stream with 0 MB cache. Due to iOS and Android browser security, streamed files must be re-selected after an app restart, while your saved loops and settings restore automatically.

---

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
