#!/bin/bash
# ship_min.sh -- verified minimal ship: backup -> verify -> replace -> (rollback)
#
# Usage: ship_min.sh --cand DIR --live DIR --sums FILE --vp FILE [--dry-run]
#   --sums  lines of "<sha256>  <relpath>" (two spaces); relpath is relative to CAND/ and LIVE/
#   --vp    JSON containing {"4_ident":{"sha256":"<hex>"}}; every sums sha must equal it
# Exit: 0 SHIP_OK | 1 usage/preflight | 2 verify failed, nothing written
#       3 replaced, then failed, then rolled back
# Result lines go to stdout; logs go to stderr. bash 3.2, set -u only (errexit off on purpose).
set -u

usage() { printf 'usage: %s --cand DIR --live DIR --sums FILE --vp FILE [--dry-run]\n' "$0" >&2; exit 1; }
log()   { printf '[ship] %s\n' "$*" >&2; }
out()   { printf '%s\n' "$*"; }

CAND=""; LIVE=""; SUMS=""; VP=""; DRY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --cand)    [ $# -ge 2 ] || usage; CAND="$2"; shift 2 ;;
    --live)    [ $# -ge 2 ] || usage; LIVE="$2"; shift 2 ;;
    --sums)    [ $# -ge 2 ] || usage; SUMS="$2"; shift 2 ;;
    --vp)      [ $# -ge 2 ] || usage; VP="$2";   shift 2 ;;
    --dry-run) DRY=1; shift ;;
    *) usage ;;
  esac
done
[ -n "$CAND" ] && [ -n "$LIVE" ] && [ -n "$SUMS" ] && [ -n "$VP" ] || usage

if command -v shasum >/dev/null 2>&1; then
  sha_of() { shasum -a 256 "$1" | cut -d' ' -f1; }
else
  sha_of() { sha256sum "$1" | cut -d' ' -f1; }
fi

# ---- 1a. preflight: resolve dirs, check inputs. Nothing is written before verify passes.
CAND="$(cd "$CAND" 2>/dev/null && pwd -P)"
LIVE="$(cd "$LIVE" 2>/dev/null && pwd -P)"
[ -n "$CAND" ] || { log "E0 CAND_NOT_DIR"; exit 1; }
[ -n "$LIVE" ] || { log "E0 LIVE_NOT_DIR"; exit 1; }
[ -w "$LIVE" ] || { out "E3 LIVE_NOT_WRITABLE $LIVE"; exit 3; }
[ -f "$SUMS" ] && [ -r "$SUMS" ] || { log "E0 SUMS_UNREADABLE $SUMS"; exit 1; }
[ -f "$VP" ]   && [ -r "$VP" ]   || { log "E0 VP_UNREADABLE $VP"; exit 1; }
command -v python3 >/dev/null 2>&1 || { log "E0 NO_PYTHON3"; exit 1; }

# ---- 1c. every replace target must already exist in LIVE (rollback needs a backup)
while read -r sha rel || [ -n "$rel" ]; do # same line tolerance as the verify loop: CRLF, '#' comment, no final newline
  rel="${rel%$'\r'}"
  [ -n "$rel" ] || continue; case "$sha" in '#'*) continue ;; esac
  [ -e "$LIVE/$rel" ] || { out "E5 NEW_FILE_IN_REPLACE_SET $rel"; exit 2; }
done < "$SUMS"

# ---- 2. verify: for every sums line, sha(cand) == sums == vp.
vp_sha="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("4_ident",{}).get("sha256",""))' "$VP" 2>/dev/null)"
[ -n "$vp_sha" ] || { out "E2 VP_KEY_MISSING"; exit 2; }

RELS=(); SHAS=()
while IFS= read -r line || [ -n "$line" ]; do
  line="${line%$'\r'}"
  case "$line" in ''|'#'*) continue ;; esac
  sha="${line%% *}"; rel="${line#* }"; rel="${rel# }"
  [ -n "$sha" ] && [ -n "$rel" ] || { log "E0 SUMS_BAD_LINE: $line"; exit 1; }
  cand="$(sha_of "$CAND/$rel")"
  if [ "$cand" != "$sha" ] || [ "$sha" != "$vp_sha" ]; then
    out "E1 SHA_MISMATCH $rel cand=${cand:-MISSING} sums=$sha vp=$vp_sha"
    exit 2
  fi
  RELS+=("$rel"); SHAS+=("$sha")
done < "$SUMS"
N=${#RELS[@]}
[ "$N" -gt 0 ] || { log "E0 SUMS_EMPTY"; exit 1; }

if [ "$DRY" -eq 1 ]; then
  out "DRYRUN_OK files=$N sha=${SHAS[0]:0:12}"
  exit 0
fi

# ---- 1b. backup (first write): LIVE -> LIVE.bak-<TS>, plus live_pre.sha256 of every file in it
TS="$(date -u +%Y%m%dT%H%M%SZ)"; tries=0
while [ -e "$LIVE.bak-$TS" ] && [ "$tries" -lt 5 ]; do sleep 1; TS="$(date -u +%Y%m%dT%H%M%SZ)"; tries=$((tries+1)); done
BAK="$LIVE.bak-$TS"
[ ! -e "$BAK" ] || { log "E0 BACKUP_EXISTS $BAK"; exit 1; }
bak_fail() { # never leave a partial backup under a plain .bak-<TS> name
  local fail="$LIVE.bak-failed-$TS"
  if [ ! -e "$fail" ] && mv "$BAK" "$fail"; then out "E4 BACKUP_FAILED backup_failed=$fail"
  else rm -rf "$BAK"; out "E4 BACKUP_FAILED backup_failed=$BAK removed=1"; fi
  exit 3
}
cp -Rp "$LIVE" "$BAK" || bak_fail
chmod u+w "$BAK" 2>/dev/null
( cd "$BAK" && find . -type f ! -path ./live_pre.sha256 | LC_ALL=C sort | while IFS= read -r f; do
    printf '%s  %s\n' "$(sha_of "$f")" "${f#./}"
  done ) > "$BAK/live_pre.sha256" || bak_fail
pre_sha_of() { awk -v r="$1" 'substr($0,67)==r {print substr($0,1,64); exit}' "$BAK/live_pre.sha256"; }
PREV="$(pre_sha_of "${RELS[0]}")"
log "backup=$BAK manifest_files=$N"

# ---- 3. replace only listed files (tmp + mv -f), re-hash each; any failure -> rollback
bad=""
for ((i=0; i<N; i++)); do
  rel="${RELS[$i]}"; sha="${SHAS[$i]}"
  tmp="$LIVE/$(dirname "$rel")/.$(basename "$rel").tmp.$$"
  if ! cp "$CAND/$rel" "$tmp" || ! mv -f "$tmp" "$LIVE/$rel"; then
    rm -f "$tmp"; bad="$rel"; log "replace failed: $rel"; break
  fi
  now="$(sha_of "$LIVE/$rel")"
  [ "$now" = "$sha" ] || { bad="$rel"; log "post-replace mismatch: $rel"; break; }
done
if [ -z "$bad" ]; then
  now="$(sha_of "$LIVE/${RELS[0]}")"
  out "SHIP_OK prev=${PREV:0:12} now=${now:0:12}"
  exit 0
fi

# ---- 4. rollback: cp each listed file back from backup, re-hash against live_pre.sha256
rbfail=""
for ((i=0; i<N; i++)); do
  rel="${RELS[$i]}"
  cp -p "$BAK/$rel" "$LIVE/$rel" || { rbfail="$rel"; break; }
  now="$(sha_of "$LIVE/$rel")"; pre="$(pre_sha_of "$rel")"
  [ -n "$pre" ] && [ "$now" = "$pre" ] || { rbfail="$rel"; break; }
done
if [ -z "$rbfail" ]; then
  out "ROLLED_BACK prev=${PREV:0:12}"
else
  out "E9 ROLLBACK_FAILED backup=$BAK"; log "rollback failed at: $rbfail"
fi
exit 3
