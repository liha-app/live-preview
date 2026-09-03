# Demo video pipeline

Install Node.js 22+, Playwright/Chrome, and `ffmpeg` with `libx264`. Subtitle cards are rendered with macOS AppKit and composited with ffmpeg's standard `overlay` filter, so `libass` is not required.

1. Set the Gemini key in the shell; do not put it in a file:

   ```sh
   export GEMINI_API_KEY='YOUR_API_KEY'
   ```

2. Generate all narration WAVs:

   ```sh
   node --experimental-strip-types video/tools/generate-narration.ts
   ```

   Existing WAVs are skipped. To replace one take, run `node --experimental-strip-types video/tools/generate-narration.ts --scene 04 --force`.

3. Record the automated scenes against production:

   ```sh
   node video/tools/scene-01-hook.mjs
   node video/tools/scene-02-publish.mjs
   node video/tools/scene-03-review.mjs
   node video/tools/scene-05-same-url.mjs
   node video/tools/scene-06-product.mjs
   node video/tools/scene-07-closing.mjs
   ```

   Scenes 2 and 5 capture a real macOS Terminal window. The helper gives it the generic prompt `demo@northwind $` so no local username or path appears. The owner token is supplied only as a hidden environment variable.

4. Record Scene 4 in the Codex app using the prompt in `BRIEF.md`, with the review UI and visible agent output set to English. Save the full 1920×1080, 30 fps H.264 take at `video/raw/scene-04-en-take.mp4`, then run:

   ```sh
   bash video/tools/enhance-scene-04.sh
   ```

   This condenses the complete real take to the locked 42-second slot and adds compact callouts naming the exact WebMCP calls that occurred. The callout timings and text live in `video/script/scene-04-callouts.srt`.

5. Build the SRT:

   ```sh
   node --experimental-strip-types video/tools/build-subtitles.ts
   ```

6. Assemble both final videos (this also rebuilds the SRT and subtitle cards):

   ```sh
   bash video/tools/assemble.sh
   ```

Outputs:

- `video/output/live-preview-webmcp-challenge.mp4` — clean master
- `video/output/live-preview-webmcp-challenge-subtitled.mp4` — English subtitles burned in
- `video/subtitles/live-preview-demo.srt` — uploadable subtitle track

## Japanese version

The Japanese edit reuses the same English UI footage and WebMCP callouts. It
uses the same Gemini model and `Kore` voice as the English version.

```sh
node --experimental-strip-types video/tools/generate-narration.ts --locale ja --force
LIHA_VIDEO_LOCALE=ja bash video/tools/assemble.sh
```

Japanese outputs:

- `video/output/live-preview-webmcp-challenge-ja.mp4` — Japanese narration, no burned-in subtitles
- `video/output/live-preview-webmcp-challenge-ja-subtitled.mp4` — Japanese narration and burned-in Japanese subtitles
- `video/subtitles/live-preview-demo-ja.srt` — uploadable Japanese subtitle track

The timeline slot length is authoritative. Each clip is trimmed or freeze-padded to that length. Narration and subtitles begin 0.8 seconds into every scene, and the remaining time is the deliberate scene tail.
