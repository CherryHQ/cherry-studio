# Website documentation synchronization

This tooling owns the content mapping, three-way reconciliation, GitHub synchronization PRs and isolated website renderer. The website continues to own its Fumadocs application, scheduled reference-data writer and complete deployment artifact. The initial import and renderer are pinned to website commit `58b0775b594bcf7a8e310131e1bf18c239795fa8` in `config.json`.

## Content and validation

`website-docs/content/`, `locales.json`, `page-aliases.json` and the optional `shadowed-baseline.json` map to the corresponding paths under the website's `docs-site/`. The latest website removed the legacy baseline file; absence on both sides is preserved. Other files are not synchronized. The desktop formatter excludes the imported content; Git attributes also preserve its source bytes and intentional Markdown whitespace. The import retains three existing trailing-whitespace lines in the source corpus. The dedicated Website documentation workflow builds content changes; the desktop validation planner does not select application tests for those files alone.

Run `pnpm website-docs:check`, `pnpm website-docs:build`, or `pnpm website-docs:dev`. They require Node 24, Git 2.43 or later, a Corepack-enabled `pnpm`, and network access for the pinned renderer and dependencies. Both uncommitted and untracked candidate files are overlaid into `.context/website-docs-renderer/`. The website's package manager and lockfile remain independent. `--no-install` skips dependency installation after a successful preparation.

Run focused contracts with `pnpm test:scripts scripts/websiteDocs/content.test.ts`. Tests use real Git trees and merges; they do not prove GitHub App access or production publication.

## Activation

Install one GitHub App on `CherryHQ/cherry-studio` and `CherryHQ/cherry-studio-website`. Grant Contents, Pull requests and Commit statuses write permission. Configure `WEBSITE_DOCS_APP_ID` as a repository variable and `WEBSITE_DOCS_APP_PRIVATE_KEY` as a secret in both repositories. Keep `WEBSITE_DOCS_SYNC_ENABLED` unset until setup is complete.

Merge the import/coordinator and the website companion notification/check workflow first. Recheck both main-branch content trees before bootstrapping. The bootstrap fails if they differ; reconcile any website updates after the initial import through a normal PR first. It never treats a missing import as a deletion.

```sh
gh workflow run sync-website-docs.yml --repo CherryHQ/cherry-studio -f bootstrap=true
gh workflow run sync-website-docs.yml --repo CherryHQ/cherry-studio -f bootstrap=true -f apply=true
```

Inspect the first run's source/destination SHAs, tree IDs and proposed checkpoint before applying. The apply run creates a signed checkpoint in the `docs-sync-state` branch, not on main. After the baseline exists, run a normal dry-run and a controlled edit in each direction. Verify the resulting PR's checks, signature and diff, merge it, and verify convergence. Then set `WEBSITE_DOCS_SYNC_ENABLED=true` in both repositories. No workflow in this change configures credentials, protections, variables, or production deployments automatically.

Require `Website docs content`, `Website docs plan` and `website-docs/freshness` for synchronization PRs in addition to each repository's normal checks. The first two run from ordinary read-only PR workflows. The coordinator maintains the freshness status when either repository changes. Only same-repository `docs-sync/content` PRs need the synchronization-specific requirements; do not add a status that never runs as a global requirement for unrelated PRs. Configure branch rules or a required aggregate accordingly. A cross-repository source can change between a check and merge; this is eventual synchronization, not an atomic release lock.

## Operation and recovery

Both main branches request reconciliation after mapped content changes. Website notifications contain no caller-selected revision. The coordinator always reads both fixed repositories' current main heads. Every six hours it also retries missed notifications. Manual runs default to dry-run; automatic runs write only when the enable variable is true.

The shared baseline records two commit SHAs whose canonical mapped Git trees agree. Git merges text from this common baseline with rename detection disabled; conflicting text, binary, deletion/edit or file types stop the whole batch. The job summary reports all three trees, observed commits and conflict paths. Resolve conflicting paths in normal PRs on both repositories until their content agrees, then rerun. Remaining independent edits are still eligible for reconciliation. Never reset the checkpoint to hide divergence.

The coordinator maintains one `docs-sync/content` PR per repository. GitHub signs its API-authored commit and includes the App identity's sign-off; refreshes use an explicit Git lease so a concurrent branch change cannot be overwritten. Bot-owned temporary `docs-sync/build-*` branches are deleted after use. A hard runner interruption can leave a temporary branch; inspect its signed commit and delete only that unused temporary branch before retrying if necessary. Partial publication does not advance the shared baseline.

Editing a synchronization branch manually stops its automatic refresh. Complete that PR manually or move the intended resolution into an ordinary PR. If the edited synchronization PR is closed instead of merged, preserve its edits and remove its manually edited bot branch before resuming; the coordinator never deletes or overwrites that branch for you. Closing a synchronization PR without merging pauses that direction; closing a converged PR by the coordinator is distinguished from a deliberate pause. Resume explicitly:

```sh
gh workflow run sync-website-docs.yml --repo CherryHQ/cherry-studio -f apply=true -f resume=website
```

Use `resume=desktop` or `resume=all` for the other directions. Duplicate and delayed events compare current content; they do not replay old directory copies. A retry reuses the existing PR when its result and plan are still current. One-sided merges and unchanged bot content do not create a reverse loop. The checkpoint advances only when both current mapped trees agree. Missing history, credentials, permissions, or a stale destination head fails the run without acknowledging unseen content. An interrupted first checkpoint can be retried with `bootstrap=true` after inspecting equal trees.

The website's reference-data job must explicitly dispatch reconciliation after its default-token push, since that push does not trigger another workflow. Its `docs-site/public/models-search/` output remains website-only. The legacy desktop release dispatch to `cherry-studio-docs` is outside this change.

To disable automatic writes, unset `WEBSITE_DOCS_SYNC_ENABLED` in both repositories. Keep the state branch and both copies. Dry-run remains available; after inspecting unsynchronized edits, re-enable and reconcile from the existing checkpoint. A desktop feature does not become public documentation until its website PR is merged and the existing website pipeline deploys it. Website edits may already be public while their return PR awaits review.
