#!/usr/bin/env bash
# Transcodes selected archive videos to web-friendly H.264 MP4s in store-content/videos.
set -euo pipefail
SRC="${1:-/run/media/rjaybernardo/Transcend/01 RGB LeatherCrafts}"
OUT="$(cd "$(dirname "$0")" && pwd)/videos"
M="$SRC/04 Marketing & Videos"; CP="$SRC/02 Client Projects"
web() { local w=${3:-1280} q=${4:-26}; ffmpeg -v error -y -i "$1" -vf "scale='min($w,iw)':-2" -c:v libx264 -preset slow -crf $q -pix_fmt yuv420p \
  -c:a aac -b:a 96k -movflags +faststart "$OUT/$2"; echo "  $2 $(du -h "$OUT/$2" | cut -f1)"; }
web "$M/FINISHED VIDEOS AE MP4/Adjustable Leather Catch Cock.mp4" catch-bag-adjustable.mp4
web "$M/FB Post Web Sorted/Demo Insert Removal 00.mp4" catch-bag-insert-removal.mp4 960 29
web "$M/FB Post Web Sorted/Made by RGB.mp4" made-by-rgb.mp4
web "$CP/Project 11222018 Leather Tari Sheath/Sheath Final.mp4" tari-sheath.mp4
web "$CP/Project 11222018 Takera/Leather Takera.mp4" leather-takera.mp4
web "$M/RGB Video (M2)/20230822_162930.mp4" sharpener-case.mp4 720 29
web "$M/FINISHED VIDEOS AE MP4/TariCase_Demo-Vid_No-Text.mp4" tari-case-demo.mp4
