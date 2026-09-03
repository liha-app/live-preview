# Production brief — Liha Live Preview demo video

For the OpenAI WebMCP Challenge. Read this whole file before starting. The
script is locked; your job is to capture, narrate, subtitle and assemble it.

---

## 0. The one constraint that shapes everything

`document.modelContext` is **only available in the Codex app's browser** right
now. Stock Chrome and Playwright's Chromium do not have it.

So the video is captured in two halves:

- **Scenes 1, 2, 3, 5, 6, 7** — automated with Playwright against the live
  deployment. No agent involved; these are the human half of the story.
- **Scene 4** — captured in the **Codex app**, with a person at the keyboard,
  as a screen recording. This is the scene the entry exists for.

This split is an improvement, not a compromise. A judge watching Scene 4 sees a
real agentic browser discovering the tools a page published and deciding to
call them — which is a stronger demonstration of WebMCP than a script calling
`executeTool()` would ever be. Do not try to work around it.

---

## 1. What the product is

Liha Live Preview publishes a static build to a URL that never changes, lets
anyone with the link click an element and leave a comment anchored to it, and
publishes that review to the agent in the same tab as WebMCP tools.

Live, in production:

|                        |                                                                     |
| ---------------------- | ------------------------------------------------------------------- |
| App / landing          | `https://livepreview.liha.dev`                                      |
| API                    | `https://api-livepreview.liha.dev`                                  |
| Review screen          | `https://lp-<slug>.liha.review`                                     |
| Artifact (per version) | `https://lp-<slug>--<n>.liha.review`                                |
| CLI                    | `npx @liha-cli/live-preview deploy .` (bin: `liha-preview`, v0.1.1) |

The demo fixture is already published and seeded with one open comment on
`#cta`. Read `video/raw/fixture.json` for its slug, share URL and owner URL.
Share URL: `https://lp-xifuz7kgrb6w.liha.review`.

**The owner URL in that file carries a live owner token.** It is gitignored.
Never print it, never commit it, never let it sit in a visible address bar —
the app scrubs the `#owner=` fragment on load
(`apps/web/src/lib/storage.ts:58`), so navigate and let it settle _before_ the
recorder starts.

---

## 2. What already exists — do not redo it

| Path                                     | State                                                                                  |
| ---------------------------------------- | -------------------------------------------------------------------------------------- |
| `video/script/narration.md`              | **Locked.** 7 scenes, ~299 words. Do not rewrite.                                      |
| `video/script/shot-list.md`              | **Locked.** What is on screen, scene by scene.                                         |
| `video/script/timeline.md`               | **Locked.** In/out points, 2:34 total.                                                 |
| `video/tools/fixture.mjs`                | Publishes + seeds the fixture. Already run.                                            |
| `video/tools/record.mjs`                 | Playwright harness: `open`, `wait`, `clickSlowly`, `finish`, `fixture`, `only`, `OUT`. |
| `playwright@1.62.1`                      | Root devDependency, already installed.                                                 |
| `video/tools/generate-narration.ts` etc. | May already exist from an earlier run. Check before writing.                           |

`record.mjs` launches real Chrome (`channel: 'chrome'`), viewport 1600×900,
`deviceScaleFactor: 2`, and pre-seeds `liha.seen-intro`,
`liha.no-account-prompt`, `liha.locale=en`, `liha.reviewer-name` so no
onboarding dialog appears in a take.

---

## 3. Deliverables

```
video/
  raw/<scene>/…              captures (gitignored)
  narration/NN-<scene>.wav   one WAV per scene (gitignored)
  subtitles/liha-demo.srt    English (gitignored)
  output/liha-demo.mp4       clean master (gitignored)
  output/liha-demo-subtitled.mp4
  tools/…                    every script that made the above (committed)
  README.md                  how to regenerate any single piece
```

1920×1080, 30fps, H.264. Under 3 minutes; target 2:20–2:40.

---

## 4. Phase A — the automated scenes

Write one recorder per scene next to `record.mjs`, using its exports. Follow
`shot-list.md` for content. Recording rules, repeated because they are what
separates this from a screencast:

- No mouse wandering. Every pointer move goes from where it is to where it is
  needed, once.
- No hovering to "show" something. If it matters, it is clicked, or it is
  already on screen.
- Type at a readable speed. The terminal is not a speed run.
- **Nothing is faked.** If a call fails during a take, redo the take. Do not
  edit around a failure, and do not build a mock of anything.

Scene 2 and 5 need a terminal on camera. Record a real shell running the real
published CLI against the real API — not a simulated prompt.

---

## 5. Phase B — Scene 4, in the Codex app

42 seconds, the longest scene, and the only one a human drives.

**Setup.** Codex app open, its browser on the review page (the owner URL from
`fixture.json`, already loaded and scrubbed). Recorder running at 1920×1080.

**The take.** One request, typed by the person, then hands off the keyboard:

> Read the open review comments on this page, take me to the first one, check
> it at phone width, read the CSS behind it, and reply in the thread with what
> you'd change.

Codex should then discover the page's tools and work through roughly:
`get_review_summary` → `focus_comment` → `set_viewport` (mobile = 390px) →
`read_artifact_file` → `add_comment`.

**What has to be visible on screen**, because this is the whole argument:

1. The tools the page published to the agent — however the Codex app surfaces
   them. If it lists them, hold on that list.
2. The reviewer's screen scrolling to the comment and the element outlining,
   caused by the agent, not by a mouse.
3. The preview narrowing to phone width.
4. The reply appearing in the sidebar, under the agent's own name.

If Codex picks a different but sensible route through the tools, keep it — that
is more honest than steering it. Redo the take only if a call errors or nothing
visible happens.

**Recording.** macOS screen capture needs Screen Recording permission granted
to whatever records; that is a human step and cannot be scripted around. Use
`screencapture -v` or `ffmpeg -f avfoundation`. Capture the full screen and
crop to 1920×1080 in the edit rather than fighting a region selection during a
live take.

---

## 6. Phase C — narration

`video/tools/generate-narration.ts`:

- Model `gemini-3.1-flash-tts-preview`, voice **`Kore`**.
- **One WAV per scene**, `video/narration/NN-<scene>.wav`, 24 kHz mono.
- **Max 3 retries with exponential backoff** (1s, 2s, 4s).
- `--scene NN` regenerates one scene; `--force` overwrites existing files.
- Reads the text out of `video/script/narration.md` so the script stays the
  single source of truth.
- **`GEMINI_API_KEY` from the environment only.** Never a file, never a
  default, never committed. Exit code 2 with a clear message if it is unset.

American English, calm, a developer showing a colleague something that works.
`WebMCP`, `CLI`, `DOM`, `CSS selector`, `structured` must come out clearly.

---

## 7. Phase D — subtitles

`video/tools/build-subtitles.ts` writes `video/subtitles/liha-demo.srt` from
the narration text and the measured duration of each WAV — not from guessed
timings. Two lines maximum per cue, broken at clause boundaries.

---

## 8. Phase E — assembly

`video/tools/assemble.sh`:

- Concatenate the scene captures on the timeline in `timeline.md`.
- Normalise narration with `loudnorm` to **-16 LUFS / -1.5 dBTP**.
- Where a scene's picture is longer than its narration, the gap stays silent.
  Those gaps are deliberate: they are where the product does something worth
  watching.
- Video: `libx264`, `-crf 18`, `-preset slow`, `-pix_fmt yuv420p`,
  `-movflags +faststart`. Audio: AAC 192k.
- Two renders: `liha-demo.mp4` (clean) and `liha-demo-subtitled.mp4` (burned-in
  via `subtitles=`).

---

## 9. Hard rules

- **Nothing on screen is fake.** Real product, real deployment, real tool
  calls. No mocked UI, no re-enacted output, no placeholder data.
- **No secrets anywhere.** Not in the repo, not in a log, not in a frame.
  `.env`, `.env.local`, credentials and `video/raw|narration|subtitles|output`
  are already gitignored — keep it that way.
- **Do not refactor the product.** It is finished, tested and deployed. If you
  find a genuine bug while filming, report it — do not quietly fix it and do
  not film around it.
- Work inside `video/`. The only exception is a `.gitignore` line if you add a
  new output directory.

## What not to spend time on

Title cards, logo animation, music, transitions beyond a hard cut, colour
grading, or a second language. The picture is the product; the voice explains
it. That is the whole film.

---

## 10. Self-review before you report

Watch the render end to end and judge it on four axes:

1. **Is the WebMCP claim proven?** Would a judge who knows the spec accept
   Scene 4 as a real agent calling tools a page published?
2. **Is it legible?** Text readable on a laptop, nothing important on screen
   for less than two seconds.
3. **Is it honest?** Every frame is the real product doing the real thing.
4. **Is it under three minutes and does it hold attention?**

Fix what fails. Then report, once, at the end — do not narrate progress:

1. Final duration and file paths
2. Which scenes were automated and which were captured live
3. What Scene 4 actually shows, tool call by tool call
4. Narration: generated or blocked, and why
5. Subtitle timing method and any manual adjustment
6. Encoding settings actually used
7. Anything that had to deviate from this brief, and why
8. Anything that failed and was redone
9. What still needs a human
10. Any bug found in the product while filming
