---
description: Maintainer runbook for preparing, validating, hotfixing, publishing, and synchronizing release branches
sources:
  - .github/workflows/prepare-release.yml
  - .github/workflows/preview-release.yml
  - .github/workflows/release.yml
  - .github/workflows/backport-release-fixes.yml
  - .github/workflows/post-release.yml
  - .github/workflows/ci.yml
  - .agents/skills/prepare-release/SKILL.md
  - electron-builder.cn.config.cjs
---

# Release Workflow Operations

This runbook is for maintainers operating Cherry Studio releases through GitHub Actions. For the branch model and naming rules, see [Branching Strategy](./branching-strategy.md).

The release branch is the source of every installer and release asset. `main` remains the source of normal development and hotfix pull requests.

## Workflow Overview

| Stage | Source | Workflow | Result |
| --- | --- | --- | --- |
| Preview | Any same-repository branch | **Preview Release** | Creates an isolated draft GitHub Release for internal testing |
| Prepare | `main` | **Pre Release** | Creates `release/v<version>` with a signed release metadata commit |
| Validate | `release/v<version>` | **CI** | Validates the exact release branch commit |
| Build | `release/v<version>` | **Release** | Moves the draft tag to the validated commit and uploads artifacts |
| Hotfix | Merged `main` pull request | **Backport Release Hotfixes** | Opens a backport pull request against the active release branch |
| Publish | `release/v<version>` | **Release** (`publish`) | Revalidates and publishes the current draft |
| Synchronize | Published GitHub Release | **Post Release** | Opens a metadata-only `release-sync/v<version>` pull request |
| Close | `release-sync/v<version>` | **CI** | Validates the metadata pull request before it is merged into `main` |

## Internal Preview Builds

Use **Preview Release** when a maintainer needs installable packages from an unreleased feature branch for internal testing:

1. Open **Actions** → **Preview Release** → **Run workflow**.
2. Select `main` in the workflow branch selector. The workflow definition and its permissions must always come from `main`.
3. Enter a same-repository source branch in the `branch` input.
4. Select `all`, `windows`, `mac`, or `linux`, then run the workflow.
5. Open the resulting draft under **Releases** and download its installers.

Every selected platform builds the same resolved source commit. The package version is changed only inside the runner to `<base-version>-preview.g<commit>`. After every selected platform succeeds, the workflow creates or updates `preview-<branch>-<commit>` as a draft prerelease and uploads the installers there.

Preview source code runs without repository credentials, application service secrets, signing certificates, or notarization credentials, so these internal packages are unsigned and may omit secret-backed integrations. Their non-semantic-version tags do not match `v<version>` or have a corresponding `release/v<version>` branch, so they are excluded from formal release preparation, hotfix backports, and Post Release. They do not acquire the `release-state` lock and cannot be published by the formal **Release** workflow.

## Before Starting

Confirm all of the following:

- The previous release is published.
- Its `chore(release): sync v<version> metadata` pull request is merged into `main` when one was created.
- The intended `main` commit is ready to release.
- Repository secrets used by release preparation, package signing, notarization, and publishing are available.
- You have permission to run workflows and publish GitHub Releases.

Do not create the release branch, release tag, or metadata synchronization pull request by hand during the normal flow. Do not publish from the GitHub Releases page. The workflows own those operations and serialize them with the repository-wide `release-state` concurrency group.

## 1. Prepare the Release Branch

1. Open **Actions** → **Pre Release** → **Run workflow**.
2. Select `main` in the branch selector.
3. Enter one of these values for `version`:
   - `patch`, `minor`, or `major` to bump the version currently recorded on `main`.
   - An exact version such as `2.1.0`, `2.1.0-rc.1`, or `2.1.0-beta.1`.
4. Run the workflow and wait for it to finish.

The workflow freezes the selected `main` commit as the release source and verifies that it records the latest published version. If that published baseline is `v<baseline-version>`, its release-note collection base is that tag when it is an ancestor; otherwise it requires the latest commit whose full message contains the exact line `release-metadata-boundary: v<baseline-version>`. This marker always names the last published version already represented on `main`, not the requested target version. Only metadata sync commits created before that marker existed may use the legacy exact subject `chore(release): sync v<baseline-version> metadata`, optionally followed by GitHub's ` (#<number>)` squash suffix. The requested version must be strictly greater than that baseline. It then collects release notes, extracts only the three source metadata changes from the temporary preparation workspace, restores the frozen source SHA, validates the intended version, bilingual sections, and stable history, and regenerates the product manifest itself without a write token. A fresh job copies only those metadata files from the workflow artifact and creates `release/v<version>` from the frozen source commit through the GitHub API. A later `main` change does not alter or invalidate that release source. Neither the target branch nor a GitHub Release for the target tag may already exist, and the commit must be both Verified and DCO-signed off.

Release preparation may change only these files:

- `package.json`
- `electron-builder.yml`
- `resources/cherry-studio/release-history.json`
- `resources/builtin-agents/cherry-assistant/product-manifest.json`

Stable releases update release history. Prereleases leave `release-history.json` unchanged.

After the workflow succeeds, verify:

- The expected `release/v<version>` branch exists.
- `package.json` contains the same version as the branch name.
- The release commit shows **Verified** on GitHub and contains a `Signed-off-by` trailer.
- The generated English and Chinese release notes are correct.
- No release pull request against `main` was opened. The release branch stays isolated until publication.

If the workflow says the release branch already exists, stop and inspect that branch and any matching draft release. Do not overwrite or delete it until you have confirmed whether it is an active or abandoned release.

To explicitly abandon an unpublished release, first set `TAG=v<version>` and `BRANCH=release/$TAG`, then inspect `gh release view "$TAG" --json isDraft,tagName,url`, `git ls-remote --heads origin "refs/heads/$BRANCH"`, and `gh pr list --base "$BRANCH" --state open`. Continue only after confirming the release is still a draft and every related backport PR is closed. Delete the draft and its movable tag with `gh release delete "$TAG" --cleanup-tag --yes`, then delete the release branch with `git push origin --delete "$BRANCH"`. If only an orphan branch exists, skip the release deletion; if only an orphan draft exists, skip the branch deletion. These deletions are destructive and require an explicit maintainer decision.

## 2. Wait for Release Branch CI

Pushing `release/v<version>` automatically starts **CI**. Wait for the CI run attached to the latest release branch commit to succeed.

The **Release** workflow checks GitHub Actions for a successful `ci.yml` push run whose `head_sha` exactly equals the commit being released. A successful run for an older commit does not satisfy this gate.

Do not start a release build while CI is queued, running, cancelled, or failing. Fix or rerun CI first.

### Repairing the Initial Release Branch

The first release-branch CI run happens before a draft GitHub Release exists, so automatic backporting cannot safely select that branch yet. If code must change for this initial CI run to pass:

1. Fix the root cause through a pull request to `main` titled `hotfix: <description>` or `hotfix(<kebab-case-scope>): <description>`. The workflow adds the `hotfix` label, but it does not backport yet because there is no matching draft.
2. After the hotfix merges, create `backport/v<version>/pr-<source-number>` from `release/v<version>` and apply only the merged hotfix result. Never merge all of `main` into the release branch. Run `PR_BODY="$(gh pr view <source-number> --json body --jq .body)" node scripts/release/hotfix-release-notes.js` on that branch to apply any provided bilingual note; the command leaves release metadata unchanged for `NONE` or a missing block.
3. Push a signed, DCO-signed commit and open a pull request from that topic branch to `release/v<version>`. Put `<!-- release-backport-source-pr: <source-number> -->` on its own line in the pull request body so the lifecycle tracker automatically maintains the source hotfix's `backport/v<version>` and `backported/v<version>` labels.
4. Review the release-specific diff, merge it after CI passes, and wait for CI on the new release branch head.
5. Start the initial **Release** build. Once its draft exists, later merged hotfix pull requests use the automatic backport flow.

## 3. Build or Rebuild the Draft Release

1. Open **Actions** → **Release** → **Run workflow**.
2. Select `release/v<version>` in the branch selector. Never select `main`.
3. Select the `build` operation.
4. Select a platform:
   - `all` for the initial release build.
   - `windows`, `mac`, or `linux` only to retry artifacts for the exact commit already referenced by the draft tag. A new release-branch head requires `all`.
5. Run the workflow and wait for every selected build job to finish.

Before building, the workflow verifies that:

- It was started from a `release/v<semver>` branch.
- The branch version matches `package.json`.
- CI succeeded for the exact branch commit.
- A matching published release does not already exist.

Each selected platform builds both the existing global edition and the independently installable China edition from the same commit. Each runner validates and stages only its own edition and platform artifacts. After every selected build succeeds, one final job downloads that complete staged set, fails on any artifact read or upload error, updates the draft, and only then moves `v<version>` to the exact validated branch commit. A single-platform retry rebuilds both editions for that platform, downloads the existing draft assets, overlays the replacements, uploads the complete set, and never moves the tag. Tag movement is allowed only while the release is still a draft.

Before publishing, inspect the draft release and confirm:

- The tag and release branch point to the same commit.
- All expected platform jobs succeeded.
- Global and China edition installers, archives, update manifests, blockmaps, and release notes are present.
- The version and release notes match the intended release.

Keep the release as a draft while testing or while hotfixes are still expected.

## 4. Include a Hotfix in the Active Draft

All hotfix development still starts from `main`:

1. Create a normal fix branch from current `main`.
2. Open a pull request targeting `main`.
3. Use one of these exact title forms; a scope, when present, must be lowercase alphanumeric kebab-case, the colon must be followed by one space, and the description must not be empty:
   - `hotfix: <description>`
   - `hotfix(<kebab-case-scope>): <description>`
4. If the fix is user-facing, provide exactly one component-tagged English line and one Chinese line in the pull request's `release-note` fence. Do not add bullet prefixes:

   ```text
   <!--LANG:en-->
   [Component] English description.
   <!--LANG:zh-CN-->
   [组件] 中文说明。
   <!--LANG:END-->
   ```

   Otherwise, keep `NONE` in the fence. Omitting the block is also accepted by automation, but preserving the PR template section is preferred. If a bilingual block is present, it must use the exact markers and contain Chinese content in the Chinese description.

5. Wait for review and CI, then merge the pull request into `main`.

The **Backport Release Hotfixes** workflow synchronizes the `hotfix` label from the title and separately validates any provided bilingual note. After merge, it locks release state, finds the single draft semantic-version release with a matching release branch, and applies the source PR result with trusted workflow scripts. If a backport PR is already open for that release, the new fix and source marker are appended to its topic branch; otherwise the workflow creates `backport/v<version>/pr-<source-number>`. This keeps consecutive hotfixes in one reviewed backport pull request instead of creating conflicting PRs from the same release head. Every generated commit is GitHub-verified and DCO-signed off. The workflow revalidates the draft, release head, and aggregate backport head before writing, and never commits directly to the release branch.

Track the source pull request by its labels:

| Label | Meaning | Operator action |
| --- | --- | --- |
| `backport/v<version>` | A backport pull request is open | Review the backport pull request and wait for CI |
| `backported/v<version>` | The backport pull request was merged, or the fix was already present | After a merge, wait for release branch CI and rebuild; if the workflow says the fix was already present, no rebuild is needed |
| `backport-failed/v<version>` | Automation failed before opening a pull request, or the backport pull request closed without merging | Inspect the workflow run, backport manually, or reopen the pull request |

After the backport pull request is created:

1. Confirm its base is `release/v<version>` and its source link points to the intended merged hotfix PR.
2. Review the release-specific diff and wait for the backport pull request's **CI** checks to pass.
3. Merge the backport pull request. The source hotfix PR changes from `backport/v<version>` to `backported/v<version>` only after this merge.
4. Wait for **CI** on the resulting release branch head to succeed.
5. Run **Release** again from `release/v<version>`.
6. Select `all` because the backport changed the release-branch head, then recheck the updated draft release. Single-platform retries are only for the exact commit already referenced by the draft tag.

Closing an automatic backport pull request without merging changes the source hotfix PR to `backport-failed/v<version>`. Reopening it restores the open `backport/v<version>` state. The workflow does not add `backport/v<version>` until an actual backport pull request exists. A preparation failure before a pull request exists sets `backport-failed/v<version>`; if a backport pull request is already open, a rerun reconciles the source PR back to the open `backport/v<version>` state.

GitHub Actions keeps at most one pending run in a concurrency group. If a burst of release-state events supersedes an older pending backport run, that source hotfix remains without `backported/v<version>`, so publication stays blocked. Rerun the cancelled backport workflow; do not bypass the publication gate.

### Resolving a Backport Failure

When the source pull request receives `backport-failed/v<version>` before a backport pull request exists:

1. Create a temporary conflict-resolution branch from the current `release/v<version>` head.
2. Apply only the hotfix pull request's intended changes. Do not merge `main` into the release branch.
3. Resolve conflicts in favor of the release branch plus the required fix; do not bring unrelated later `main` changes into the release.
4. Run `PR_BODY="$(gh pr view <source-number> --json body --jq .body)" node scripts/release/hotfix-release-notes.js` to apply any provided bilingual note to `electron-builder.yml` and, for a stable release, release history. The command is a no-op when the note is `NONE` or absent.
5. Run validation appropriate to all changed code and metadata files.
6. Create a signed, DCO-signed commit and open a pull request targeting `release/v<version>` for review.
7. After it is merged, wait for release branch CI and rebuild the draft release.
8. On the source pull request, replace `backport-failed/v<version>` with `backported/v<version>` and comment with the manual resolution pull request or commit.

If the workflow reports multiple active release branches, leave only the intended release active and rerun the failed workflow. If it reports no active draft release, no backport is performed.

## 5. Publish the Release

Publish only after the latest release branch commit has passed CI and an `all`-platform build for that exact commit has completed successfully.

1. Open the draft under **Releases** and confirm the tag, target commit, notes, and artifacts one final time. Do not select **Publish release** on this page.
2. Open **Actions** → **Release** → **Run workflow**.
3. Select the matching `release/v<version>` branch and the `publish` operation.
4. Run the workflow.

The workflow shares the same release-state lock as preparation, builds, backport creation, and Post Release. Immediately before publishing, it takes one final state snapshot and requires the draft, tag, branch, and selected SHA to agree; rejects open release-branch PRs and every merged `hotfix` after the release branch point that lacks `backported/v<version>`; requires a successful exact-head `all` build; and confirms that artifacts exist. This explicit hotfix gate also blocks publication when a backport job is merely queued and has not opened its PR yet. The fetched `main` SHA in that snapshot is the hotfix cutoff for the release; a hotfix merged after it belongs to the next release. Publication then makes the tag immutable for this workflow. **Release** refuses to update an already published release; any later fix requires a new version.

Publishing triggers **Post Release** automatically.

## 6. Merge the Release Metadata Pull Request

**Post Release** uses the published tag as the canonical metadata source. It computes the metadata-only delta from the release branch point to that tag, applies the delta with a three-way merge on the `main` snapshot checked out by the workflow, and opens `release-sync/v<version>`. The release branch may move or be removed after publication without preventing this synchronization. If `main` advances while the workflow is running, the pull request still contains only the metadata commit; its normal merge checks reconcile the newer base. Non-overlapping edits made on `main` are preserved, while an overlapping edit produces a pull request conflict instead of being overwritten.

The pull request may contain only:

- `package.json`
- `electron-builder.yml`
- `resources/cherry-studio/release-history.json`
- `resources/builtin-agents/cherry-assistant/product-manifest.json`

To finish the release:

1. Review the metadata pull request and confirm it contains no release-branch code or backport commits.
2. Keep its title exactly `chore(release): sync v<version> metadata`.
3. Keep the `release-metadata-boundary: v<version>` marker in its body.
4. Wait for its CI checks to pass.
5. When squash-merging, set the commit title to `chore(release): sync v<version> metadata` with only GitHub's optional ` (#<PR-number>)` suffix, and ensure the squash commit message body contains `release-metadata-boundary: v<version>` on its own line.

That squash commit is the release-note boundary used by the next **Pre Release** run. Do not start the next release until this synchronization is complete.

If the metadata files already match `main`, **Post Release** exits without opening a pull request. If a previous metadata pull request was closed without merging, use GitHub's **Re-run all jobs** control, or `gh run rerun <run-id>`, on the original **Post Release** run to reset the sync branch and create a replacement pull request.

## Failure Guide

| Symptom | Meaning | Resolution |
| --- | --- | --- |
| **Pre Release** is skipped | It was not run from `main` | Rerun it with `main` selected |
| Release branch already exists | The version has already been prepared | Inspect the existing branch and draft; do not overwrite it blindly |
| No successful CI push run found | The selected release commit has not passed CI | Wait for or repair CI on that exact SHA, then rerun **Release** |
| Branch and `package.json` versions differ | The release ref is inconsistent | Stop and correct the preparation flow; do not force a tag |
| Release is already published | Published releases cannot be rebuilt | Prepare a new version |
| Multiple active release branches | Backport target is ambiguous | Resolve the extra draft release state, then rerun the backport workflow |
| `backport-failed/v<version>` | Automatic preparation failed or the backport PR closed unmerged | Inspect the linked workflow run or follow the manual procedure above |
| Backport pull request closed without merging | The hotfix has not reached the release branch | Reopen the pull request or complete a manual backport |
| Published metadata conflicts with `main` | The same metadata lines changed after the release branch was cut | Reconcile those edits on `main`, then rerun **Post Release**; never replace the whole file from the tag |
| Commit is not Verified or lacks DCO | Token identity or signing failed | Fix the workflow/token configuration; never bypass the check |

## Invariants

- Build internal feature previews only with **Preview Release** from a same-repository branch; source builds are credentialless and unsigned, and preview draft releases never become formal release state.
- Build and publish from `release/v<version>`, never from `main`.
- Merge every hotfix into `main` before backporting it to the release branch.
- Merge hotfixes into the release branch through a backport pull request, never through an automatic direct commit.
- Never merge all of `main` into an active release branch.
- Never publish a draft until the exact release commit passes CI and all required artifacts are present.
- Publish only with the **Release** workflow's `publish` operation; never publish directly from the Releases page.
- Never move a published release tag.
- Never merge the complete release branch back into `main`.
- Keep the metadata synchronization pull request title and body boundary marker unchanged, squash-merge it, and finish it before preparing the next release.
