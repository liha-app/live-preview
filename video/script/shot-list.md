# Shot list

Everything on screen is the real product, in real Chrome, against the live
deployment at `livepreview.liha.dev` / `*.liha.review`. The agent scene uses
Chrome's actual `document.modelContext`, reached through the origin trial the
app already ships — `getTools()` and `executeTool()` are the browser's, not a
stand-in.

1920×1080, 30fps. Browser at 1600×900 inside the frame so type stays readable
on a laptop.

| #   | secs      | screen                   | what happens                                                                                                                                                                                                                                                                 | narration |
| --- | --------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 1   | 0:00–0:16 | review screen            | Finished preview, one open comment anchored to `#cta` with a red box. Cut to the agent panel: "publishing 13 tools". Cut to the preview updating.                                                                                                                            | 01        |
| 2   | 0:16–0:38 | terminal                 | `npx @liha-cli/live-preview deploy .` → share URL. Cut to that URL open in the browser.                                                                                                                                                                                      | 02        |
| 3   | 0:38–1:06 | review screen            | Click the CTA button in the artifact → composer opens carrying `#cta`, `BUTTON`, "Get started". Type the comment, send. Draw a box on the feature row, type the second comment.                                                                                              | 03        |
| 4   | 1:06–1:48 | review screen + tool log | Agent panel open: 13 tools listed. Then real calls, each landing on screen: `get_review_summary` → `focus_comment` (screen scrolls, element outlines) → `set_viewport` 390 (preview narrows) → `read_artifact_file` (CSS) → `add_comment` reply appears live in the sidebar. | 04        |
| 5   | 1:48–2:08 | terminal + review screen | Source edited, `deploy .` → v2 at the same URL. Refresh: the button is smaller. Reviewer resolves; "Open 0".                                                                                                                                                                 | 05        |
| 6   | 2:08–2:20 | `/me`                    | Previews I own and review, activity feed underneath. Two seconds each, no login screen.                                                                                                                                                                                      | 06        |
| 7   | 2:20–2:34 | review screen            | Rest on the finished review: resolved thread, v2, the same share URL in the address bar.                                                                                                                                                                                     | 07        |

## Rules for the recording

- No mouse wandering. Every pointer move goes from where it is to where it is
  needed, once.
- No hovering to "show" something. If it matters, it is clicked or it is
  already on screen.
- Nothing is faked. If a tool call fails during a take, the take is redone —
  the failure is not edited around.
- Type at a readable speed; the terminal is not a speed run.
