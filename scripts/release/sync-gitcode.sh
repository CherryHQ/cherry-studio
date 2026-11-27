#!/usr/bin/env bash
set -euo pipefail

# Native jq otherwise emits CRLF, which breaks Bash comparisons and upload URLs.
if [ "${RUNNER_OS:-}" = "Windows" ]; then
  jq() { command jq --binary "$@"; }
fi

API_URL="${GITCODE_API_URL:-https://api.gitcode.com/api/v5}"
RELEASE_INFO=$(gh release view "$TAG" --repo "$GH_REPO" --json name,isPrerelease,isDraft)
if [ "$(jq -r '.isDraft' <<< "$RELEASE_INFO")" != "false" ]; then
  echo "Cannot sync a GitHub draft release" >&2
  exit 1
fi
RELEASE_NAME=$(jq -r '.name' <<< "$RELEASE_INFO")
RELEASE_STATUS=""
if [ "$(jq -r '.isPrerelease' <<< "$RELEASE_INFO")" = "true" ]; then
  RELEASE_STATUS="pre"
elif [ "$(gh api "repos/$GH_REPO/releases/latest" --jq '.tag_name' | tr -d '\r')" = "$TAG" ]; then
  RELEASE_STATUS="latest"
fi

# Relative paths work for both Git Bash and native Windows curl/jq.
TEMP_DIR=$(mktemp -d .gitcode-sync.XXXXXX)
pids=()
cleanup() {
  for pid in ${pids[@]+"${pids[@]}"}; do kill "$pid" 2>/dev/null || true; done
  wait || true
  rm -rf "$TEMP_DIR"
}
trap cleanup EXIT
target_commitish=main
if [ "${RELEASE_FROM_COS:-false}" = "true" ]; then
  target_commitish=$(jq -er '.sha | strings | select(test("^[0-9a-f]{40}$"))' cos-release.json)
fi
jq -n --arg tag "$TAG" --arg name "$RELEASE_NAME" --arg status "$RELEASE_STATUS" \
  --arg target "$target_commitish" --rawfile body release_body.txt \
  '{tag_name: $tag, name: $name, body: $body, target_commitish: $target} |
   if $status == "" then . else .release_status = $status end' > "$TEMP_DIR/payload.json"

if [ "${RELEASE_FROM_COS:-false}" = "true" ]; then
  assets=()
  while IFS= read -r file; do assets+=("$file"); done < release-assets.txt
else
  assets=(release-assets/*)
fi

if [ "${DRY_RUN:-false}" = "true" ]; then
  echo "Dry run: no GitCode release writes, uploads or notifications."
  cat "$TEMP_DIR/payload.json"
  printf '%s\n' "${assets[@]}" | sort
  exit 0
fi

: "${GITCODE_TOKEN:?GITCODE_TOKEN is required}"
: "${GITCODE_OWNER:?GITCODE_OWNER is required}"
: "${GITCODE_REPO:?GITCODE_REPO is required}"
REPO_URL="$API_URL/repos/$GITCODE_OWNER/$GITCODE_REPO"
RELEASE_URL="$REPO_URL/releases"
if [ "${RELEASE_FROM_COS:-false}" = "true" ]; then
  for ((attempt = 1; attempt <= 20; attempt++)); do
    STATUS=$(curl -sS --connect-timeout 15 --max-time 30 \
      -H "Authorization: Bearer $GITCODE_TOKEN" \
      -o "$TEMP_DIR/tag.json" -w '%{http_code}' "$REPO_URL/commits/refs%2Ftags%2F$TAG")
    case "$STATUS" in
      200)
        mirror_sha=$(jq -er '.sha' "$TEMP_DIR/tag.json")
        if [ "$mirror_sha" != "$target_commitish" ]; then
          echo "GitCode tag $TAG points to $mirror_sha, expected $target_commitish" >&2
          exit 1
        fi
        echo "Verified GitCode tag $TAG at $mirror_sha"
        break
        ;;
      404)
        if [ "$attempt" != 20 ]; then
          echo "Waiting for GitCode to mirror $TAG (check $attempt/20)"
          sleep 30
        fi
        ;;
      *) echo "Cannot resolve GitCode tag $TAG (HTTP $STATUS)" >&2; exit 1 ;;
    esac
  done
  if [ "$STATUS" = 404 ]; then
    mirror_status=$(curl --fail -sS --connect-timeout 15 --max-time 30 \
      -H "Authorization: Bearer $GITCODE_TOKEN" "$REPO_URL/repo_remote_mirror" | \
      jq -c '{update_status, last_successful_update_at, number_of_failures, mirroring_enabled, force}' || true)
    if [ -n "$mirror_status" ]; then echo "GitCode Pull mirror status: $mirror_status" >&2; fi
    echo "GitCode has not mirrored $TAG at $target_commitish. Sync the GitHub Pull mirror in GitCode project settings, then run Release in sync-only mode." >&2
    exit 1
  fi
fi
STATUS=$(curl -sS --connect-timeout 30 --max-time 60 \
  -H "Authorization: Bearer $GITCODE_TOKEN" \
  -o "$TEMP_DIR/existing.json" -w '%{http_code}' "$RELEASE_URL/tags/$TAG")
case "$STATUS" in
  200)
    METHOD=PATCH
    URL="$RELEASE_URL/$TAG"
    jq 'del(.tag_name, .target_commitish)' "$TEMP_DIR/payload.json" > "$TEMP_DIR/update.json"
    mv "$TEMP_DIR/update.json" "$TEMP_DIR/payload.json"
    ;;
  404) METHOD=POST; URL="$RELEASE_URL" ;;
  *) echo "Cannot query GitCode release (HTTP $STATUS)" >&2; exit 1 ;;
esac
if ! curl --fail-with-body -sS --connect-timeout 30 --max-time 60 -X "$METHOD" \
  -H "Authorization: Bearer $GITCODE_TOKEN" -H 'Content-Type: application/json; charset=utf-8' \
  --data-binary "@$TEMP_DIR/payload.json" "$URL" > "$TEMP_DIR/release.json"; then
  details=$(jq -c 'if type == "object" then {code, message, error_message, error} else null end' \
    "$TEMP_DIR/release.json" 2>/dev/null | cut -c1-1000 || true)
  echo "GitCode release $METHOD failed${details:+, response $details}" >&2
  exit 1
fi

upload_file() (
  local file="$1" filename encoded_filename info upload_url attempt
  local work
  work=$(mktemp -d "$TEMP_DIR/asset.XXXXXX")
  filename=$(basename "$file")
  encoded_filename=$(printf '%s' "$filename" | jq -sRr @uri)
  if [ "${RELEASE_FROM_COS:-false}" = "true" ] && [ "${RELEASE_VIA_SCF:-false}" != "true" ]; then
    echo "Downloading $filename from COS"
    python "$(dirname "$0")/release-cos.py" get-asset "$file" "$work/$filename"
    file="$work/$filename"
  fi
  for attempt in 1 2 3; do
    echo "Uploading $filename (attempt $attempt/3)"
    if ! info=$(curl --fail -sS --connect-timeout 30 --max-time 60 \
      -H "Authorization: Bearer $GITCODE_TOKEN" "$RELEASE_URL/$TAG/upload_url?file_name=$encoded_filename"); then
      :
    elif [ "${RELEASE_VIA_SCF:-false}" = "true" ]; then
      if python "$(dirname "$0")/gitcode-scf.py" upload "$file" <<< "$info"; then return 0; fi
    elif upload_url=$(jq -er '.url | select(length > 0)' <<< "$info") &&
      jq -r '.headers | to_entries[] | "header = " + ((.key + ": " + .value) | tojson)' <<< "$info" > "$work/headers" &&
      curl --fail -sS --connect-timeout 30 --max-time 3600 -X PUT -K "$work/headers" \
        --data-binary "@$file" "$upload_url" > "$work/upload-response"; then
      if [ "${RELEASE_FROM_COS:-false}" = "true" ]; then rm "$file"; fi
      return 0
    fi
    if [ "$attempt" != 3 ]; then sleep 3; fi
  done
  echo "Failed to upload $filename after three attempts" >&2
  return 1
)

wait_uploads() {
  local failed=0 pid
  for pid in ${pids[@]+"${pids[@]}"}; do
    if ! wait "$pid"; then failed=1; fi
  done
  pids=()
  return "$failed"
}

# Publish update pointers only after their packages are available.
for file in "${assets[@]}"; do
  case "$file" in *.yml|*.yaml|*.json) continue ;; esac
  upload_file "$file" &
  pids+=("$!")
  if [ "${#pids[@]}" = 4 ]; then wait_uploads; fi
done
wait_uploads
for file in "${assets[@]}"; do
  case "$file" in *.yml|*.yaml|*.json) upload_file "$file" ;; esac
done
if [ "${RELEASE_VIA_SCF:-false}" = "true" ]; then
  printf '%s\n' "${assets[@]##*/}" | sort -u > "$TEMP_DIR/expected-assets"
  for attempt in 1 2 3 4 5 6; do
    if curl --fail -sS --connect-timeout 20 --max-time 30 \
      -H "Authorization: Bearer $GITCODE_TOKEN" "$RELEASE_URL/tags/$TAG" > "$TEMP_DIR/published.json" &&
      jq -er '.assets[].name' "$TEMP_DIR/published.json" | tr -d '\r' | sort -u > "$TEMP_DIR/published-assets" &&
      [ -z "$(comm -23 "$TEMP_DIR/expected-assets" "$TEMP_DIR/published-assets")" ]; then
      echo "Verified ${#assets[@]} GitCode attachments."
      break
    fi
    if [ "$attempt" = 6 ]; then
      echo "GitCode did not list all expected attachments" >&2
      exit 1
    fi
    sleep 5
  done
fi
echo "GitCode release sync completed."
