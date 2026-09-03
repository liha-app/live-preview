#!/usr/bin/env bash

set -euo pipefail

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VIDEO_DIR="$(cd "$TOOLS_DIR/.." && pwd)"
SOURCE="$VIDEO_DIR/raw/scene-04-en-take.mp4"
SPEED_BASE="$VIDEO_DIR/raw/scene-04-en-42.mp4"
CALLOUT_DIR="$VIDEO_DIR/raw/scene-04-callouts"
CALLOUT_SRT="$VIDEO_DIR/script/scene-04-callouts.srt"
MANIFEST="$CALLOUT_DIR/manifest.tsv"
OUTPUT="$VIDEO_DIR/recordings/04-agent.mp4"

[[ -f "$SOURCE" ]] || { echo "missing source: $SOURCE" >&2; exit 1; }
mkdir -p "$CALLOUT_DIR" "$VIDEO_DIR/recordings"

# 95.866667 seconds of real activity, condensed uniformly into the locked
# 42-second scene. No event is removed; the callouts name the exact calls made.
ffmpeg -y -hide_banner -loglevel error -i "$SOURCE" \
  -vf "setpts=PTS/2.2825397,fps=30,trim=duration=42,setpts=PTS-STARTPTS,scale=1920:1080:flags=lanczos,setsar=1" \
  -an -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -r 30 -movflags +faststart \
  "$SPEED_BASE"

swift "$TOOLS_DIR/render-subtitles.swift" "$CALLOUT_SRT" "$CALLOUT_DIR" "$MANIFEST" callout

ffmpeg_args=(-y -hide_banner -loglevel error -i "$SPEED_BASE")
filter=""
previous="[0:v]"
index=0
while IFS=$'\t' read -r path start end; do
  [[ -n "$path" ]] || continue
  index="$((index + 1))"
  ffmpeg_args+=(-loop 1 -framerate 30 -i "$path")
  next="[callout${index}]"
  filter+="${previous}[${index}:v]overlay=x=48:y=96:enable='between(t,${start},${end})':eof_action=pass${next};"
  previous="$next"
done < "$MANIFEST"
[[ "$index" -eq 6 ]] || { echo "expected 6 callouts, found $index" >&2; exit 1; }
filter="${filter%;}"

ffmpeg "${ffmpeg_args[@]}" -filter_complex "$filter" -map "$previous" -an -t 42 \
  -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -r 30 -movflags +faststart \
  "$OUTPUT"

echo "Wrote $OUTPUT"
