latest_backport_target() {
  local refs releases
  refs="$(gh api --paginate --slurp "repos/$REPO/git/matching-refs/heads/release/v?per_page=100")" || return
  releases="$(gh api --paginate --slurp "repos/$REPO/releases?per_page=100")" || return

  printf '%s\n' "$refs" "$releases" | jq -rs '
    def version:
      capture("^v(?<major>0|[1-9][0-9]*)\\.(?<minor>0|[1-9][0-9]*)\\.(?<patch>0|[1-9][0-9]*)(?:-(?<pre>[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*))?$")
      | [(.major | tonumber), (.minor | tonumber), (.patch | tonumber),
         (.pre == null), ((.pre // "") | split(".") | map(if test("^[0-9]+$") then tonumber else . end))];

    [.[0][][] | select(.ref | startswith("refs/heads/release/v"))
      | {branch: (.ref | ltrimstr("refs/heads/")), head: .object.sha}
      | . + {version: (.branch | ltrimstr("release/") | version)}] as $branches
    | ([.[1][][] | select(.draft == false) | .tag_name | version] | max) as $published
    | ($branches | max_by(.version)) as $latest
    | select($latest.version > $published)
    | [$latest.branch, $latest.head] | @tsv
  '
}

revalidate_backport_target() {
  local target
  target="$(latest_backport_target)" || return
  if [ "$target" != "$RELEASE_BRANCH"$'\t'"$RELEASE_HEAD" ]; then
    echo "The latest unpublished release branch or its head changed while preparing the backport" >&2
    return 1
  fi
}
