#!/usr/bin/env bash
# Prints the format of each docs/media video and saves 3 frames of each
# (at 15%, 50% and 85% of its length) to look at: `check.sh [frames dir]`.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
media="$(cd "$here/../../docs/media" && pwd)"
frames="${1:-$here/out/frames}"
mkdir -p "$frames"

for video in "$media"/*.mp4; do
  name="$(basename "$video" .mp4)"
  probe="$(ffprobe -v error -select_streams v:0 \
    -show_entries stream=codec_name,width,height,pix_fmt:format=duration \
    -of compact=p=0:nk=0 "$video" | tr '\n' ' ')"
  echo "$name.mp4 $(du -h "$video" | cut -f1) $probe gif $(du -h "$media/$name.gif" | cut -f1)"
  duration="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$video")"
  for percent in 15 50 85; do
    at="$(echo "$duration * $percent / 100" | bc -l)"
    ffmpeg -y -loglevel error -ss "$at" -i "$video" -frames:v 1 "$frames/$name-$percent.png"
  done
done
echo "frames: $frames"
