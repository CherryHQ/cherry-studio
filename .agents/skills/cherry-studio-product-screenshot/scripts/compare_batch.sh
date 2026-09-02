#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "usage: compare_batch.sh <reference-dir> <candidate-dir> <qa-dir> [width height [max-normalized-rmse]]" >&2
}

if [[ $# -lt 3 || $# -gt 6 || $# == 4 ]]; then
  usage
  exit 2
fi

reference_dir="$1"
candidate_dir="$2"
qa_dir="$3"
width="${4:-2212}"
height="${5:-1448}"
maximum="${6:-0.20}"

if [[ ! -d "$reference_dir" || ! -d "$candidate_dir" ]]; then
  echo "reference and candidate directories must exist" >&2
  exit 3
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mkdir -p "$qa_dir"
summary="$qa_dir/summary.tsv"
printf 'filename\tnormalized_rmse\n' >"$summary"

count=0
while IFS= read -r -d '' candidate; do
  filename="$(basename "$candidate")"
  reference="$reference_dir/$filename"
  if [[ ! -f "$reference" ]]; then
    echo "matching reference not found: $reference" >&2
    exit 4
  fi
  item_qa="$qa_dir/${filename%.png}"
  "$script_dir/compare_capture.sh" "$reference" "$candidate" "$item_qa" "$width" "$height" "$maximum"
  rmse="$(awk -F= '$1 == "normalized_rmse" { print $2 }' "$item_qa/metrics.txt")"
  printf '%s\t%s\n' "$filename" "$rmse" >>"$summary"
  count=$((count + 1))
done < <(find "$candidate_dir" -maxdepth 1 -type f -name '*.png' -print0 | sort -z)

if [[ "$count" -eq 0 ]]; then
  echo "no PNG candidates found: $candidate_dir" >&2
  exit 5
fi

echo "batch comparison complete count=$count summary=$summary"
