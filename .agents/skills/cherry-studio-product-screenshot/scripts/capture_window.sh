#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "usage: capture_window.sh <pid> <window-id> <output.png> <expected-width> <expected-height> [--force]" >&2
}

if [[ $# -lt 5 || $# -gt 6 ]]; then
  usage
  exit 2
fi

pid="$1"
window_id="$2"
output="$3"
expected_width="$4"
expected_height="$5"
force="${6:-}"

if [[ ! "$pid" =~ ^[1-9][0-9]*$ || ! "$window_id" =~ ^[1-9][0-9]*$ || ! "$expected_width" =~ ^[1-9][0-9]*$ || ! "$expected_height" =~ ^[1-9][0-9]*$ ]]; then
  usage
  exit 2
fi

if [[ -e "$output" && "$force" != "--force" ]]; then
  echo "refusing to overwrite existing output: $output" >&2
  exit 3
fi

for command_name in swift screencapture magick osascript; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "required command not found: $command_name" >&2
    exit 4
  fi
done

if ! kill -0 "$pid" 2>/dev/null; then
  echo "process is not running: $pid" >&2
  exit 5
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
for _ in $(seq 1 5); do
  if osascript "$script_dir/raise_main_window.applescript" "$pid" >/dev/null 2>&1; then
    break
  fi
  sleep 0.2
done
window_ready=false
for _ in $(seq 1 15); do
  if swift "$script_dir/window_id.swift" "$pid" "$window_id" >/dev/null 2>&1; then
    window_ready=true
    break
  fi
  sleep 0.2
done

if [[ "$window_ready" != "true" ]]; then
  swift "$script_dir/window_id.swift" "$pid" "$window_id" >/dev/null
fi

mkdir -p "$(dirname "$output")"
sleep 0.4
capture_ready=false
for _ in $(seq 1 5); do
  if screencapture -x -o -l "$window_id" "$output" 2>/dev/null && [[ -s "$output" ]]; then
    capture_ready=true
    break
  fi
  rm -f "$output"
  sleep 0.2
done

if [[ "$capture_ready" != "true" ]]; then
  echo "could not capture verified window after retries: $window_id" >&2
  exit 7
fi

read -r actual_width actual_height < <(magick identify -format '%w %h\n' "$output")
if [[ "$actual_width" != "$expected_width" || "$actual_height" != "$expected_height" ]]; then
  echo "capture dimensions mismatch: expected ${expected_width}x${expected_height}, got ${actual_width}x${actual_height}" >&2
  exit 6
fi

echo "captured verified_window_id=$window_id pid=$pid size=${actual_width}x${actual_height} output=$output"
