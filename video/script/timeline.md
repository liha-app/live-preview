# Timeline

Cut against the narration that actually exists. The English WAVs in
`video/narration/` measure **135.3s** and the Japanese WAVs in
`video/narration-ja/` measure **129.6s**. The picture runs **149s (2:29)**.
Each scene starts with a 0.8-second picture lead; the remaining short tails let
the tool call land, the deploy finish, or the page refresh.

Silence is allocated to the scenes that earn it. Scene 2 and scene 5 need room
for a real CLI to finish; scene 4 needs room for the agent to work after the
narration has stopped explaining it.

| scene      | in   | out  | len | audio             |
| ---------- | ---- | ---- | --- | ----------------- |
| 1 hook     | 0:00 | 0:18 | 18s | `01-hook.wav`     |
| 2 publish  | 0:18 | 0:38 | 20s | `02-publish.wav`  |
| 3 review   | 0:38 | 1:02 | 24s | `03-review.wav`   |
| 4 agent    | 1:02 | 1:44 | 42s | `04-agent.wav`    |
| 5 same url | 1:44 | 2:02 | 18s | `05-same-url.wav` |
| 6 product  | 2:02 | 2:15 | 13s | `06-product.wav`  |
| 7 closing  | 2:15 | 2:29 | 14s | `07-closing.wav`  |

Narration against picture, per scene:

| scene | English narration | English tail | Japanese narration | Japanese tail |
| ----- | ----------------- | ------------ | ------------------ | ------------- |
| 1     | 16.00s            | 1.20s        | 15.28s             | 1.92s         |
| 2     | 18.16s            | 1.04s        | 18.24s             | 0.96s         |
| 3     | 21.80s            | 1.40s        | 21.76s             | 1.44s         |
| 4     | 40.88s            | 0.32s        | 39.84s             | 1.36s         |
| 5     | 15.12s            | 2.08s        | 14.68s             | 2.52s         |
| 6     | 11.64s            | 0.56s        | 10.44s             | 1.76s         |
| 7     | 11.72s            | 1.48s        | 9.32s              | 3.88s         |

Scene 4 is the longest on purpose: it is the one thing that cannot be done
without WebMCP, and it is the reason the entry exists. Calls three, four and
five are narrated in sync with `set_viewport`, `read_artifact_file`, and
`add_comment`; only the reply landing is left to breathe.

This file is the single source of truth for the edit. `build-subtitles.ts` and
`assemble.sh` both parse the first table, so changing a number here changes the
subtitles and the render together.
