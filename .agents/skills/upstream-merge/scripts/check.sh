#!/usr/bin/env bash
# Upstream-merge checks for The Boss fork. Read-only: never merges, commits, or edits files.
#
#   check.sh preflight   fetch upstream, show divergence, dry-run conflicts, scan incoming Cherry identity
#   check.sh verify      after merging (in progress or committed): fork files lost to upstream, Cherry identity added
set -euo pipefail

UPSTREAM_REF="${UPSTREAM_REF:-upstream/main}"

# Product/assistant identity upstream keeps re-introducing. Service names (CherryIN, CherryAI, Cherry Cloud,
# "Cherry account") are real services we consume and are deliberately not matched.
IDENTITY_RE='Cherry[ -]?Studio|Cherry[ -](Assistant|Support|Assistent|Asistanı|Destek)|Cherry ?(助手|小助手|助理|支持|支援|アシスタント)|(Assistente?|Asistente?|Assistant|Ассистент|Βοηθός|Trợ lý) Cherry|cherry-ai\.com'
# Upstream-owned code identifiers that happen to match the pattern.
IGNORE_RE='@cherrystudio/|CherryStudioUi|cherrystudio://'
TEST_RE='(__tests__/|/tests?/|\.test\.|\.spec\.|/e2e/)'

cd "$(git rev-parse --show-toplevel)"

scan_added_identity() { # $1 = diff range args
  local hits
  hits=$(git diff "$@" -- . ':!pnpm-lock.yaml' ':!resources/cherry-studio/release-history.json' \
    | awk '/^\+\+\+ b\//{f=substr($0,7)} /^\+[^+]/{print f"\t"substr($0,2)}' \
    | grep -E "$IDENTITY_RE" | grep -vE "$IGNORE_RE" || true)
  if [ -z "$hits" ]; then echo "  none"; return; fi
  echo "$hits" | grep -vE "^[^	]*$TEST_RE" | cut -c1-220 | sed 's/^/  /' || true
  local tests
  tests=$(echo "$hits" | grep -cE "^[^	]*$TEST_RE" || true)
  [ "$tests" -gt 0 ] && echo "  (+$tests lines in test/e2e files — upstream-owned, normally left alone)"
  return 0
}

preflight() {
  git remote get-url upstream >/dev/null 2>&1 || { echo "No 'upstream' remote — see docs/contrib/upstream-merges.md#remotes"; exit 1; }
  [ "$(git remote get-url --push upstream)" = "DISABLED_read_only_upstream" ] || echo "WARNING: upstream push URL is not disabled"
  git fetch -q upstream main
  local base; base=$(git merge-base HEAD "$UPSTREAM_REF")
  echo "== Divergence (HEAD vs $UPSTREAM_REF)"
  echo "  upstream commits to take: $(git rev-list --count HEAD.."$UPSTREAM_REF")"
  echo "  fork-only commits:        $(git rev-list --count "$UPSTREAM_REF"..HEAD)"
  echo "  upstream version:         $(git show "$UPSTREAM_REF":package.json | grep -m1 '"version"' | tr -d ' ,')"
  echo "== Dry-run conflicts"
  git merge-tree --write-tree HEAD "$UPSTREAM_REF" | grep '^CONFLICT' | sed 's/^/  /' || echo "  none"
  echo "== Files both sides changed (auto-merge candidates to eyeball)"
  comm -12 <(git diff --name-only "$base" HEAD | sort) <(git diff --name-only "$base" "$UPSTREAM_REF" | sort) | sed 's/^/  /'
  echo "== Cherry identity upstream is adding (rebrand after merging)"
  scan_added_identity "$base" "$UPSTREAM_REF"
}

verify() {
  local fork merged
  if git rev-parse -q --verify MERGE_HEAD >/dev/null; then
    [ -z "$(git diff --name-only --diff-filter=U)" ] || { echo "Unresolved conflicts remain:"; git diff --name-only --diff-filter=U; exit 1; }
    fork=HEAD; merged=$(git write-tree)
  else
    git rev-parse -q --verify HEAD^2 >/dev/null || { echo "HEAD is not a merge commit and no merge is in progress"; exit 1; }
    fork=HEAD^1; merged=HEAD^{tree}
  fi
  local base; base=$(git merge-base "$fork" "$UPSTREAM_REF")
  echo "== Fork changes reverted to upstream's version (should be empty)"
  local lost=0 f
  while IFS= read -r f; do
    local m u o
    m=$(git rev-parse -q --verify "$merged:$f" 2>/dev/null || true)
    u=$(git rev-parse -q --verify "$UPSTREAM_REF:$f" 2>/dev/null || true)
    o=$(git rev-parse -q --verify "$fork:$f" 2>/dev/null || true)
    if [ "$m" = "$u" ] && [ "$o" != "$u" ]; then echo "  LOST? $f"; lost=1; fi
  done < <(git diff --name-only "$base" "$fork")
  [ $lost -eq 0 ] && echo "  none"
  echo "== Cherry identity added by this merge (vs fork side)"
  scan_added_identity "$fork" "$merged"
  echo "== Identity anchors"
  grep -E '^(appId|productName):' electron-builder.yml | sed 's/^/  /'
  grep -m1 '"name"' package.json | sed 's/^/  package.json /'
  [ -f src/shared/utils/branding.ts ] && echo "  src/shared/utils/branding.ts present" || echo "  MISSING src/shared/utils/branding.ts"
}

case "${1:-}" in
  preflight) preflight ;;
  verify) verify ;;
  *) sed -n '2,5p' "$0"; exit 2 ;;
esac
