#!/usr/bin/env bash
# Restores workflow files accidentally stripped in commit a35ad3a88e on PR #16688.
# Run from repo root on branch fix/16660-disabling-thinking-doesn't-work, then push to your fork.
set -euo pipefail
upstream="${1:-https://github.com/CherryHQ/cherry-studio.git}"
ref="${2:-main}"
files=(
  .github/workflows/backport-release-fixes.yml
  .github/workflows/prepare-release.yml
  .github/workflows/release-packages.yml
  .github/workflows/release.yml
)
git fetch "$upstream" "$ref"
for f in "${files[@]}"; do
  git checkout "FETCH_HEAD" -- "$f"
done
git commit -S --signoff -m "fix(ci): restore workflow permissions dropped during rebase"
echo "Committed. Push with: git push origin fix/16660-disabling-thinking-doesn't-work"
