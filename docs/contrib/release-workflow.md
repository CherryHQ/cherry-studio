---
description: Maintainer runbook for preparing, validating, hotfixing, publishing, and synchronizing release branches
sources:
  - .github/workflows/prepare-release.yml
  - .github/workflows/release.yml
  - .github/workflows/backport-release-fixes.yml
  - .github/workflows/post-release.yml
  - .github/workflows/ci.yml
  - .agents/skills/prepare-release/SKILL.md
---

# Release Workflow Operations

This runbook is for maintainers operating Cherry Studio releases through GitHub Actions. For the branch model and naming rules, see [Branching Strategy](./branching-strategy.md).

The release branch is the source of every installer and release asset. `main` remains the source of normal development and hotfix pull requests.

## Workflow Overview

| Stage | Source | Workflow | Result |
| --- | --- | --- | --- |
| Prepare | `main` | **Pre Release** | Creates `release/v<version>` with a signed release metadata commit |
| Validate | `release/v<version>` | **CI** | Validates the exact release branch commit |
| Build | `release/v<version>` | **Release** | Moves the draft tag to the validated commit and uploads artifacts |
| Hotfix | Merged `main` pull request | **Backport Release Hotfixes** | Opens a backport pull request against the active release branch |
| Publish | Draft GitHub Release | **Post Release** | Opens a metadata-only `release-sync/v<version>` pull request |
| Close | `release-sync/v<version>` | **CI** | Validates the metadata pull request before it is merged into `main` |

## Before Starting

Confirm all of the following:

- The previous release is published.
- Its `chore(release): sync v<version> metadata` pull request is merged into `main` when one was created.
- There is no other active draft semantic-version release with a matching `release/v<version>` branch. Hotfix automation deliberately refuses to choose between multiple active releases.
- The intended `main` commit is ready to release.
- Repository secrets used by release preparation, package signing, notarization, and publishing are available.
- You have permission to run workflows and publish GitHub Releases.

Do not create the release branch, release tag, or metadata synchronization pull request by hand during the normal flow. The workflows own those operations.

## 1. Prepare the Release Branch

1. Open **Actions** → **Pre Release** → **Run workflow**.
2. Select `main` in the branch selector.
3. Enter one of these values for `version`:
   - `patch`, `minor`, or `major` to bump the version currently recorded on `main`.
   - An exact version such as `2.1.0`, `2.1.0-rc.1`, or `2.1.0-beta.1`.
4. Run the workflow and wait for it to finish.

The workflow collects release notes, updates the release metadata files, and creates `release/v<version>` from the selected `main` commit. The commit is created through the GitHub API and must be both Verified and DCO-signed off.

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

## 2. Wait for Release Branch CI

Pushing `release/v<version>` automatically starts **CI**. Wait for the CI run attached to the latest release branch commit to succeed.

The **Release** workflow checks GitHub Actions for a successful `ci.yml` push run whose `head_sha` exactly equals the commit being released. A successful run for an older commit does not satisfy this gate.

Do not start a release build while CI is queued, running, cancelled, or failing. Fix or rerun CI first.

## 3. Build or Rebuild the Draft Release

1. Open **Actions** → **Release** → **Run workflow**.
2. Select `release/v<version>` in the branch selector. Never select `main`.
3. Select a platform:
   - `all` for the initial release build.
   - `windows`, `mac`, or `linux` to retry or refresh one platform.
4. Run the workflow and wait for every selected build job to finish.

Before building, the workflow verifies that:

- It was started from a `release/v<semver>` branch.
- The branch version matches `package.json`.
- CI succeeded for the exact branch commit.
- A matching published release does not already exist.

The workflow then moves `v<version>` to the exact validated branch commit and creates or updates a draft GitHub Release. Moving the tag is allowed only while the release is still a draft.

Before publishing, inspect the draft release and confirm:

- The tag and release branch point to the same commit.
- All expected platform jobs succeeded.
- Installers, archives, update manifests, blockmaps, and release notes are present.
- The version and release notes match the intended release.

Keep the release as a draft while testing or while hotfixes are still expected.

## 4. Include a Hotfix in the Active Draft

All hotfix development still starts from `main`:

1. Create a normal fix branch from current `main`.
2. Open a pull request targeting `main`.
3. Use one of these exact title forms:
   - `hotfix: <description>`
   - `hotfix(<kebab-case-scope>): <description>`
4. Wait for review and CI, then merge the pull request into `main`.

The **Backport Release Hotfixes** workflow synchronizes the `hotfix` label from the title. After merge, it finds the single draft semantic-version release with a matching release branch, creates a `backport/v<version>/pr-<source-number>` branch with a GitHub-verified, DCO-signed commit, and opens a pull request against `release/v<version>`. It never writes the hotfix commit directly to the release branch.

Track the source pull request by its labels:

| Label | Meaning | Operator action |
| --- | --- | --- |
| `backport/v<version>` | A backport pull request is open or being prepared | Review the backport pull request and wait for CI |
| `backported/v<version>` | The backport pull request was merged, or the fix was already present | Wait for release branch CI, then rebuild the draft |
| `backport-conflict/v<version>` | Automatic application failed, or the backport pull request closed without merging | Resolve or reopen the backport pull request |

After the backport pull request is created:

1. Confirm its base is `release/v<version>` and its source link points to the intended merged hotfix PR.
2. Review the release-specific diff and wait for the backport pull request's **CI** checks to pass.
3. Merge the backport pull request. The source hotfix PR changes from `backport/v<version>` to `backported/v<version>` only after this merge.
4. Wait for **CI** on the resulting release branch head to succeed.
5. Run **Release** again from `release/v<version>`.
6. Select `all` unless only one platform artifact needs to be refreshed, then recheck the updated draft release.

Closing an automatic backport pull request without merging changes the source hotfix PR to `backport-conflict/v<version>`. Reopening it restores the pending `backport/v<version>` state.

### Resolving a Backport Conflict

When the source pull request receives `backport-conflict/v<version>`:

1. Create a temporary conflict-resolution branch from the current `release/v<version>` head.
2. Apply only the hotfix pull request's intended changes. Do not merge `main` into the release branch.
3. Resolve conflicts in favor of the release branch plus the required fix; do not bring unrelated later `main` changes into the release.
4. Run validation appropriate to the changed files.
5. Create a signed, DCO-signed commit and open a pull request targeting `release/v<version>` for review.
6. After it is merged, wait for release branch CI and rebuild the draft release.
7. On the source pull request, replace `backport-conflict/v<version>` with `backported/v<version>` and comment with the manual resolution pull request or commit.

If the workflow reports multiple active release branches, leave only the intended release active and rerun the failed workflow. If it reports no active draft release, no backport is performed.

## 5. Publish the Release

Publish only after the latest release branch commit has passed CI and the draft contains every required artifact.

1. Open the draft under **Releases**.
2. Confirm the tag, target commit, notes, and artifacts one final time.
3. Select **Publish release**.

Publication makes the tag immutable for this workflow. **Release** refuses to update an already published release; any later fix requires a new version.

Publishing triggers **Post Release** automatically.

## 6. Merge the Release Metadata Pull Request

**Post Release** verifies that the published tag and `release/v<version>` still point to the same commit. It then creates `release-sync/v<version>` from the latest `main` and opens a metadata-only pull request.

The pull request may contain only:

- `package.json`
- `electron-builder.yml`
- `resources/cherry-studio/release-history.json`
- `resources/builtin-agents/cherry-assistant/product-manifest.json`

To finish the release:

1. Review the metadata pull request and confirm it contains no release-branch code or backport commits.
2. Keep its title exactly `chore(release): sync v<version> metadata`.
3. Wait for its CI checks to pass.
4. Squash-merge it into `main` without changing the commit subject except for GitHub's optional ` (#<PR-number>)` suffix.

That squash commit is the release-note boundary used by the next **Pre Release** run. Do not start the next release until this synchronization is complete.

If the metadata files already match `main`, **Post Release** exits without opening a pull request. If a previous metadata pull request was closed without merging, rerunning the failed **Post Release** run may reset the sync branch and create a replacement pull request.

## Failure Guide

| Symptom | Meaning | Resolution |
| --- | --- | --- |
| **Pre Release** is skipped | It was not run from `main` | Rerun it with `main` selected |
| Release branch already exists | The version has already been prepared | Inspect the existing branch and draft; do not overwrite it blindly |
| No successful CI push run found | The selected release commit has not passed CI | Wait for or repair CI on that exact SHA, then rerun **Release** |
| Branch and `package.json` versions differ | The release ref is inconsistent | Stop and correct the preparation flow; do not force a tag |
| Release is already published | Published releases cannot be rebuilt | Prepare a new version |
| Multiple active release branches | Backport target is ambiguous | Resolve the extra draft release state, then rerun the backport workflow |
| `backport-conflict/v<version>` | Automatic patch application failed | Follow the manual conflict procedure above |
| Backport pull request closed without merging | The hotfix has not reached the release branch | Reopen the pull request or complete a manual backport |
| Published tag and release branch differ | Release state changed after the build | Stop and reconcile the refs before retrying **Post Release** |
| Commit is not Verified or lacks DCO | Token identity or signing failed | Fix the workflow/token configuration; never bypass the check |

## Invariants

- Build and publish from `release/v<version>`, never from `main`.
- Merge every hotfix into `main` before backporting it to the release branch.
- Merge hotfixes into the release branch through a backport pull request, never through an automatic direct commit.
- Never merge all of `main` into an active release branch.
- Never publish a draft until the exact release commit passes CI and all required artifacts are present.
- Never move a published release tag.
- Never merge the complete release branch back into `main`.
- Keep the metadata synchronization pull request title unchanged and merge it before preparing the next release.
