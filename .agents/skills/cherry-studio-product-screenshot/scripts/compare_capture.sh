#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "usage: compare_capture.sh <reference.png> <candidate.png> <qa-output-dir> [expected-width expected-height [max-normalized-rmse]]" >&2
}

if [[ $# != 3 && $# != 5 && $# != 6 ]]; then
  usage
  exit 2
fi

reference="$1"
candidate="$2"
output_dir="$3"
expected_width="${4:-}"
expected_height="${5:-}"
max_normalized_rmse="${6:-0.20}"

if [[ ! "$max_normalized_rmse" =~ ^0(\.[0-9]+)?$|^1(\.0+)?$ ]]; then
  echo "invalid max normalized RMSE: $max_normalized_rmse" >&2
  exit 2
fi

if ! command -v magick >/dev/null 2>&1; then
  echo "required command not found: magick" >&2
  exit 3
fi

for image_path in "$reference" "$candidate"; do
  if [[ ! -f "$image_path" ]]; then
    echo "image not found: $image_path" >&2
    exit 4
  fi
done

read -r reference_width reference_height < <(magick identify -format '%w %h\n' "$reference")
read -r candidate_width candidate_height < <(magick identify -format '%w %h\n' "$candidate")

if [[ "$reference_width" != "$candidate_width" || "$reference_height" != "$candidate_height" ]]; then
  echo "reference/candidate size mismatch: ${reference_width}x${reference_height} vs ${candidate_width}x${candidate_height}" >&2
  exit 5
fi

if [[ -n "$expected_width" && ( "$candidate_width" != "$expected_width" || "$candidate_height" != "$expected_height" ) ]]; then
  echo "candidate dimensions mismatch: expected ${expected_width}x${expected_height}, got ${candidate_width}x${candidate_height}" >&2
  exit 6
fi

channels="$(magick identify -format '%[channels]' "$candidate")"
if [[ "$channels" != *a* ]]; then
  echo "candidate has no alpha channel: $channels" >&2
  exit 7
fi

max_x=$((candidate_width - 1))
max_y=$((candidate_height - 1))
read -r alpha_top_left alpha_top_right alpha_bottom_left alpha_bottom_right < <(
  magick "$candidate" -format \
    "%[fx:round(255*p{0,0}.a)] %[fx:round(255*p{${max_x},0}.a)] %[fx:round(255*p{0,${max_y}}.a)] %[fx:round(255*p{${max_x},${max_y}}.a)]\n" info:
)

if [[ "$alpha_top_left" != 0 || "$alpha_top_right" != 0 || "$alpha_bottom_left" != 0 || "$alpha_bottom_right" != 0 ]]; then
  echo "candidate outer corners are not transparent: $alpha_top_left $alpha_top_right $alpha_bottom_left $alpha_bottom_right" >&2
  exit 8
fi

mkdir -p "$output_dir"
magick "$reference" "$candidate" +append "$output_dir/reference-vs-sample.png"

rmse="$(magick compare -metric RMSE "$reference" "$candidate" "$output_dir/difference.png" 2>&1 || true)"
normalized_rmse="$(printf '%s' "$rmse" | awk -F'[()]' '{print $2}')"

{
  echo "reference=$reference"
  echo "candidate=$candidate"
  echo "dimensions=${candidate_width}x${candidate_height}"
  echo "channels=$channels"
  echo "corner_alpha=$alpha_top_left,$alpha_top_right,$alpha_bottom_left,$alpha_bottom_right"
  echo "rmse=$rmse"
  echo "normalized_rmse=$normalized_rmse"
  echo "max_normalized_rmse=$max_normalized_rmse"
} > "$output_dir/metrics.txt"

if awk -v actual="$normalized_rmse" -v maximum="$max_normalized_rmse" 'BEGIN { exit !(actual > maximum) }'; then
  echo "comparison exceeds normalized RMSE threshold: actual=$normalized_rmse maximum=$max_normalized_rmse" >&2
  exit 9
fi

echo "comparison complete size=${candidate_width}x${candidate_height} corners=transparent normalized_rmse=$normalized_rmse maximum=$max_normalized_rmse output_dir=$output_dir"
