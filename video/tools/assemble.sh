#!/usr/bin/env bash

set -euo pipefail

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VIDEO_DIR="$(cd "$TOOLS_DIR/.." && pwd)"
RECORDINGS_DIR="$VIDEO_DIR/recordings"
OUTPUT_DIR="$VIDEO_DIR/output"
TIMELINE="$VIDEO_DIR/script/timeline.md"
LEAD_IN="0.8"
LOCALE="${LIHA_VIDEO_LOCALE:-en}"

if [[ "$LOCALE" == "ja" ]]; then
  NARRATION_DIR="$VIDEO_DIR/narration-ja"
  PLAIN_OUTPUT="$OUTPUT_DIR/live-preview-webmcp-challenge-ja.mp4"
  SUBTITLED_OUTPUT="$OUTPUT_DIR/live-preview-webmcp-challenge-ja-subtitled.mp4"
  SRT="$VIDEO_DIR/subtitles/live-preview-demo-ja.srt"
  SUBTITLE_BUILDER="$TOOLS_DIR/build-subtitles-ja.ts"
  SUBTITLE_STYLE="subtitle-ja"
  SUBTITLE_FRAMES="$VIDEO_DIR/raw/subtitle-frames-ja"
elif [[ "$LOCALE" == "en" ]]; then
  NARRATION_DIR="$VIDEO_DIR/narration"
  PLAIN_OUTPUT="$OUTPUT_DIR/live-preview-webmcp-challenge.mp4"
  SUBTITLED_OUTPUT="$OUTPUT_DIR/live-preview-webmcp-challenge-subtitled.mp4"
  SRT="$VIDEO_DIR/subtitles/live-preview-demo.srt"
  SUBTITLE_BUILDER="$TOOLS_DIR/build-subtitles.ts"
  SUBTITLE_STYLE="subtitle"
  SUBTITLE_FRAMES="$VIDEO_DIR/raw/subtitle-frames"
else
  echo "assemble: unsupported LIHA_VIDEO_LOCALE: $LOCALE (expected en or ja)" >&2
  exit 1
fi
SUBTITLE_MANIFEST="$SUBTITLE_FRAMES/manifest.tsv"

die() {
  echo "assemble: $*" >&2
  exit 1
}

for command in ffmpeg ffprobe node awk; do
  command -v "$command" >/dev/null 2>&1 || die "required command not found: $command"
done
[[ -f "$TIMELINE" ]] || die "missing input: $TIMELINE"

scene_audio=(
  "01-hook.wav"
  "02-publish.wav"
  "03-review.wav"
  "04-agent.wav"
  "05-same-url.wav"
  "06-product.wav"
  "07-closing.wav"
)
clips=()
targets=()
audio_durations=()
missing=()
total_duration="0"

timeline_length() {
  awk -F '|' -v wanted="$1" '
    /^\|/ {
      scene = $2
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", scene)
      split(scene, fields, /[[:space:]]+/)
      if (fields[1] == wanted) {
        scene_length = $5
        gsub(/[[:space:]s]/, "", scene_length)
        print scene_length
        exit
      }
    }
  ' "$TIMELINE"
}

shopt -s nullglob
for index in 0 1 2 3 4 5 6; do
  scene="$(printf '%02d' "$((index + 1))")"
  matches=("$RECORDINGS_DIR"/"$scene"-*.mp4)
  if [[ ${#matches[@]} -eq 0 ]]; then
    missing+=("$RECORDINGS_DIR/$scene-*.mp4")
  elif [[ ${#matches[@]} -gt 1 ]]; then
    die "expected one recording for scene $scene, found ${#matches[@]}: ${matches[*]}"
  else
    clips+=("${matches[0]}")
  fi

  wav="$NARRATION_DIR/${scene_audio[$index]}"
  [[ -f "$wav" ]] || missing+=("$wav")
  target="$(timeline_length "$((index + 1))")"
  [[ "$target" =~ ^[0-9]+([.][0-9]+)?$ ]] || die "missing or invalid timeline length for scene $scene"
  targets+=("$target")
  total_duration="$(awk -v total="$total_duration" -v value="$target" 'BEGIN { printf "%.3f", total + value }')"
done
shopt -u nullglob

if [[ ${#missing[@]} -gt 0 ]]; then
  printf 'assemble: missing required input:\n' >&2
  printf '  %s\n' "${missing[@]}" >&2
  exit 1
fi

for index in 0 1 2 3 4 5 6; do
  wav="$NARRATION_DIR/${scene_audio[$index]}"
  duration="$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$wav")"
  [[ "$duration" =~ ^[0-9]+([.][0-9]+)?$ ]] || die "could not read duration from $wav"

  sample_rate="$(ffprobe -v error -select_streams a:0 -show_entries stream=sample_rate -of default=noprint_wrappers=1:nokey=1 "$wav")"
  channels="$(ffprobe -v error -select_streams a:0 -show_entries stream=channels -of default=noprint_wrappers=1:nokey=1 "$wav")"
  [[ "$sample_rate" == "24000" && "$channels" == "1" ]] || die "expected 24 kHz mono audio: $wav"
  if ! awk -v audio="$duration" -v lead="$LEAD_IN" -v target="${targets[$index]}" 'BEGIN { exit !(audio + lead <= target + 0.001) }'; then
    die "${scene_audio[$index]} plus ${LEAD_IN}s lead-in is longer than scene $((index + 1)) (${targets[$index]}s)"
  fi
  audio_durations+=("$duration")
done

node --experimental-strip-types "$SUBTITLE_BUILDER"
[[ -s "$SRT" ]] || die "subtitle generation did not create $SRT"
mkdir -p "$OUTPUT_DIR"

ffmpeg_args=(-y -hide_banner)
filter=""
concat_inputs=""

for index in 0 1 2 3 4 5 6; do
  ffmpeg_args+=(-i "${clips[$index]}" -i "$NARRATION_DIR/${scene_audio[$index]}")
  video_input="$((index * 2))"
  audio_input="$((video_input + 1))"
  label="$(printf '%02d' "$((index + 1))")"
  target="${targets[$index]}"
  tail="$(awk -v target="$target" -v audio="${audio_durations[$index]}" -v lead="$LEAD_IN" 'BEGIN { printf "%.3f", target - audio - lead }')"
  echo "Scene $label: ${LEAD_IN}s lead + ${audio_durations[$index]}s narration + ${tail}s tail = ${target}s"

  filter+="[$video_input:v:0]fps=30,scale=1920:1080:flags=lanczos,setsar=1,tpad=stop_mode=clone:stop_duration=$target,trim=duration=$target,setpts=PTS-STARTPTS[v$label];"
  filter+="[$audio_input:a:0]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=mono,adelay=${LEAD_IN}s:all=1,apad=pad_dur=$target,atrim=duration=$target,asetpts=PTS-STARTPTS[a$label];"
  concat_inputs+="[v$label][a$label]"
done

filter+="${concat_inputs}concat=n=7:v=1:a=1[vcat][acat];"
filter+="[acat]loudnorm=I=-16:TP=-1.5:LRA=7,aresample=48000[aout]"

ffmpeg "${ffmpeg_args[@]}" \
  -filter_complex "$filter" \
  -map "[vcat]" -map "[aout]" \
  -t "$total_duration" \
  -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -r 30 \
  -c:a aac -b:a 192k \
  -movflags +faststart \
  "$PLAIN_OUTPUT"

mkdir -p "$SUBTITLE_FRAMES"
swift "$TOOLS_DIR/render-subtitles.swift" "$SRT" "$SUBTITLE_FRAMES" "$SUBTITLE_MANIFEST" "$SUBTITLE_STYLE"

subtitle_args=(-y -hide_banner -i "$PLAIN_OUTPUT")
subtitle_index=0
subtitle_paths=()
subtitle_starts=()
subtitle_ends=()
while IFS=$'\t' read -r subtitle_path subtitle_start subtitle_end; do
  [[ -n "$subtitle_path" ]] || continue
  subtitle_index="$((subtitle_index + 1))"
  subtitle_paths+=("$subtitle_path")
  subtitle_starts+=("$subtitle_start")
  subtitle_ends+=("$subtitle_end")
  subtitle_args+=(-loop 1 -framerate 30 -i "$subtitle_path")
done < "$SUBTITLE_MANIFEST"
[[ "$subtitle_index" -gt 0 ]] || die "subtitle renderer produced no cues"

segment_types=()
segment_starts=()
segment_ends=()
segment_cues=()
cursor="0"
for index in "${!subtitle_paths[@]}"; do
  start="${subtitle_starts[$index]}"
  end="${subtitle_ends[$index]}"
  if awk -v start="$start" -v cursor="$cursor" 'BEGIN { exit !(start > cursor + 0.0005) }'; then
    segment_types+=("plain")
    segment_starts+=("$cursor")
    segment_ends+=("$start")
    segment_cues+=("0")
  fi
  segment_types+=("cue")
  segment_starts+=("$start")
  segment_ends+=("$end")
  segment_cues+=("$((index + 1))")
  cursor="$end"
done
if awk -v total="$total_duration" -v cursor="$cursor" 'BEGIN { exit !(total > cursor + 0.0005) }'; then
  segment_types+=("plain")
  segment_starts+=("$cursor")
  segment_ends+=("$total_duration")
  segment_cues+=("0")
fi

segment_count="${#segment_types[@]}"
subtitle_filter="[0:v]split=${segment_count}"
for index in "${!segment_types[@]}"; do
  subtitle_filter+="[base${index}]"
done
subtitle_filter+=";"
concat_segments=""
for index in "${!segment_types[@]}"; do
  start="${segment_starts[$index]}"
  end="${segment_ends[$index]}"
  if [[ "${segment_types[$index]}" == "plain" ]]; then
    subtitle_filter+="[base${index}]trim=start=${start}:end=${end},setpts=PTS-STARTPTS[seg${index}];"
  else
    cue_input="${segment_cues[$index]}"
    subtitle_filter+="[base${index}]trim=start=${start}:end=${end},setpts=PTS-STARTPTS[cuebase${index}];"
    subtitle_filter+="[cuebase${index}][${cue_input}:v]overlay=x=(W-w)/2:y=H-h-54:shortest=1[seg${index}];"
  fi
  concat_segments+="[seg${index}]"
done
subtitle_filter+="${concat_segments}concat=n=${segment_count}:v=1:a=0[vsub]"

ffmpeg "${subtitle_args[@]}" \
  -filter_complex "$subtitle_filter" \
  -map "[vsub]" -map 0:a \
  -t "$total_duration" \
  -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -r 30 \
  -c:a copy \
  -movflags +faststart \
  "$SUBTITLED_OUTPUT"

echo "Wrote $PLAIN_OUTPUT"
echo "Wrote $SUBTITLED_OUTPUT"
