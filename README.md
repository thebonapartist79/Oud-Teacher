# Oud Tutor (CFADGC Tuner + Lessons)

A fast, static site with a **browser-based oud tuner** (preset: CFADGC) and simple lessons page. No server required. Ideal for Cloudflare Pages + a GitHub repo.

## Quick start

1. **Push this folder** to a new GitHub repo (public or private).
2. In **Cloudflare Pages**, create a new project, select your repo.
   - **Build config**: set *Framework preset* to **None** (this is a static site).
   - **Build command**: leave empty.
   - **Build output directory**: `/` (root).
3. Visit your Pages URL and open the **Tuner**. Click **Start Tuner** and allow mic access.

> Tip: On iOS Safari, audio must start from a user gesture. The big **Start Tuner** button handles that.

## Features

- **Accurate tuner** using the YIN (McLeod/YIN variant) pitch detection algorithm, tuned for oud open strings down to **C2**.
- **Beginner UX**: clear CFADGC string order (courses 6 → 1), big note display, cent meter, confidence and input-level indicators.
- **Reference tones**: play a quick target tone per string; optional continuous tone toggle.
- **Privacy**: tuning happens on-device. No audio leaves the browser.
- **Lessons page**: render from `data/lessons.json` with support for:
  - Local/remote video files (`type: "file", src: "https://..."`)
  - YouTube embeds (`type: "youtube", id: "VIDEO_ID"`)
  - **Cloudflare Stream** embeds (`type: "cloudflare-stream", uid: "VIDEO_UID"`)

## Editing lessons

Open `data/lessons.json` and add your videos like so:

```json
[
  {
    "id": "lesson-1",
    "title": "Right-hand basics",
    "description": "Holding the risha and first strokes.",
    "video": { "type": "cloudflare-stream", "uid": "YOUR_STREAM_UID" },
    "duration": "06:23"
  }
]
```

Cloudflare Stream gives you a **UID** per video; paste that into `uid`.

## Accessibility & UX

- High-contrast colors, large text, keyboard focus outlines.
- Screen-reader friendly: live note announcements and labeled controls.
- Hint to pluck **one string of the pair** to avoid beating that confuses detection.

## Tech overview (system level)

- **Audio in**: Web Audio API + `getUserMedia` (no echo cancel / AGC / noise suppression).
- **Signal conditioning**: high‑pass 30 Hz, low‑pass 1.5 kHz; per-frame RMS gating.
- **Pitch**: YIN with parabolic interpolation; median smoothing window to avoid jitter.
- **Mapping**: nearest CFADGC target + cents; ±3¢ = in‑tune.
- **UI**: vanilla HTML/CSS/JS. No frameworks, tiny bundle, mobile-first.

## Notes on accuracy

- Expected steady accuracy: **±1–2 cents** on sustained plucks, normal room noise, phone mic 20–30 cm from instrument.
- For double courses, pluck **one string** of the pair while tuning for best lock-on.
- If the meter “hunts”, increase pluck volume slightly and mute adjacent strings.

## Local testing

Just open `index.html` in a browser. Some browsers require HTTPS for mic; if opening from file doesn’t allow the mic, run a simple local server:

```bash
python3 -m http.server 8080
```

Then visit `http://localhost:8080`. Grant mic permission.

## License

MIT. See `LICENSE`.
