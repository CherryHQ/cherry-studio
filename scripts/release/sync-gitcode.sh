#!/usr/bin/env bash
set -euo pipefail

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
elif [ "$(gh api "repos/$GH_REPO/releases/latest" --jq '.tag_name')" = "$TAG" ]; then
  RELEASE_STATUS="latest"
fi

TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT
jq -n --arg tag "$TAG" --arg name "$RELEASE_NAME" --arg status "$RELEASE_STATUS" \
  --rawfile body release_body.txt \
  '{tag_name: $tag, name: $name, body: $body, target_commitish: "main"} |
   if $status == "" then . else .release_status = $status end' > "$TEMP_DIR/payload.json"

if [ "${DRY_RUN:-false}" = "true" ]; then
  echo "Dry run: no GitCode release writes, uploads or notifications."
  cat "$TEMP_DIR/payload.json"
  find release-assets -maxdepth 1 -type f -print | sort
  exit 0
fi

: "${GITCODE_TOKEN:?GITCODE_TOKEN is required}"
: "${GITCODE_OWNER:?GITCODE_OWNER is required}"
: "${GITCODE_REPO:?GITCODE_REPO is required}"
RELEASE_URL="$API_URL/repos/$GITCODE_OWNER/$GITCODE_REPO/releases"
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
curl --fail-with-body -sS --connect-timeout 30 --max-time 60 -X "$METHOD" \
  -H "Authorization: Bearer $GITCODE_TOKEN" -H 'Content-Type: application/json; charset=utf-8' \
  --data-binary "@$TEMP_DIR/payload.json" "$URL" > "$TEMP_DIR/release.json"

upload_file() {
  local file="$1" filename encoded_filename info upload_url attempt
  filename=$(basename "$file")
  encoded_filename=$(printf '%s' "$filename" | jq -sRr @uri)
  for attempt in 1 2 3; do
    echo "Uploading $filename (attempt $attempt/3)"
    if info=$(curl --fail -sS --connect-timeout 30 --max-time 60 \
      -H "Authorization: Bearer $GITCODE_TOKEN" "$RELEASE_URL/$TAG/upload_url?file_name=$encoded_filename") &&
      upload_url=$(jq -er '.url | select(length > 0)' <<< "$info") &&
      jq -r '.headers | to_entries[] | "header = " + ((.key + ": " + .value) | tojson)' <<< "$info" > "$TEMP_DIR/headers" &&
      curl --fail -sS --connect-timeout 30 --max-time 3600 -X PUT -K "$TEMP_DIR/headers" \
        --data-binary "@$file" "$upload_url" > "$TEMP_DIR/upload-response"; then
      return 0
    fi
    if [ "$attempt" != 3 ]; then sleep 3; fi
  done
  echo "Failed to upload $filename after three attempts" >&2
  return 1
}

# Publish update pointers only after their packages are available.
for file in release-assets/*; do
  case "$file" in *.yml|*.yaml|*.json) continue ;; esac
  upload_file "$file"
done
for file in release-assets/*; do
  case "$file" in *.yml|*.yaml|*.json) upload_file "$file" ;; esac
done
echo "GitCode release sync completed."
