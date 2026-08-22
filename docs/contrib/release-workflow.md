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
---

# Release Workflow Operations

This runbook is for maintainers operating Cherry Studio releases through GitHub Actions. For the branch model and naming rules, see [Branching Strategy](./branching-strategy.md).

The release branch is the source of every installer and release asset. `main` remains the source of normal development and hotfix pull requests.

## Workflow Overview

| Stage | Source | Workflow | Result |
| --- | --- | --- | --- |
| Preview | Any trusted repository branch | **Preview Release** | Creates an isolated draft GitHub Release for internal testing |
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
3. Enter the trusted same-repository source branch in the `branch` input.
4. Select `all`, `windows`, `mac`, or `linux`, then run the workflow.
5. Open the resulting draft under **Releases** and download its installers.

Every selected platform builds the same resolved source commit. The package version is changed only inside the runner to `<base-version>-preview.g<commit>`. After every selected platform succeeds, the workflow creates or updates `preview-<branch>-<commit>` as a draft prerelease and uploads the installers there.

Preview builds use packaging secrets, so never run this workflow for an untrusted branch. Their non-semantic-version tags do not match `v<version>` or have a corresponding `release/v<version>` branch, so they are excluded from formal release preparation, hotfix backports, and Post Release. They do not acquire the `release-state` lock and cannot be published by the formal **Release** workflow.

## Before Starting

Confirm all of the following:

- The previous release is published.
- Its `chore(release): sync v<version> metadata` pull request is merged into `main` when one was created.
- There is no other active draft semantic-version release with a matching `release/v<version>` branch. Hotfix automation deliberately refuses to choose between multiple active releases.
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

The workflow first verifies that `main` records the latest published version, contains its tag or metadata boundary, and is still at the selected remote head. The requested version must be strictly greater than that baseline. It then collects release notes, updates the release metadata source files, validates that only the intended version, notes, and stable history entry changed, regenerates the product manifest itself, and creates `release/v<version>` through the GitHub API. The commit must be both Verified and DCO-signed off.

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

### Repairing the Initial Release Branch

The first release-branch CI run happens before a draft GitHub Release exists, so automatic backporting cannot safely select that branch yet. If code must change for this initial CI run to pass:

1. Fix the root cause through a pull request to `main` titled `hotfix: <description>` or `hotfix(<kebab-case-scope>): <description>`. The workflow adds the `hotfix` label, but it does not backport yet because there is no matching draft.
2. After the hotfix merges, create a topic branch from `release/v<version>` and apply only the merged hotfix result. Never merge all of `main` into the release branch. Run `PR_BODY="$(gh pr view <number> --json body --jq .body)" node scripts/release/hotfix-release-notes.js` on that branch to add its bilingual note to the prepared release metadata.
3. Push a signed, DCO-signed commit and open a pull request from that topic branch to `release/v<version>`.
4. Review the release-specific diff, merge it after CI passes, and wait for CI on the new release branch head.
5. Start the initial **Release** build. Once its draft exists, later merged hotfix pull requests use the automatic backport flow.

## 3. Build or Rebuild the Draft Release

1. Open **Actions** → **Release** → **Run workflow**.
2. Select `release/v<version>` in the branch selector. Never select `main`.
3. Select the `build` operation.
4. Select a platform:
   - `all` for the initial release build.
   - `windows`, `mac`, or `linux` to retry or refresh one platform.
5. Run the workflow and wait for every selected build job to finish.

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
3. Use one of these exact title forms; a scope, when present, must be lowercase alphanumeric kebab-case, the colon must be followed by one space, and the description must not be empty:
   - `hotfix: <description>`
   - `hotfix(<kebab-case-scope>): <description>`
4. In the pull request's `release-note` fence, provide exactly one component-tagged English line and one Chinese line with these markers. Do not add bullet prefixes:

   ```text
   <!--LANG:en-->
   [Component] English description.
   <!--LANG:zh-CN-->
   [组件] 中文说明。
   <!--LANG:END-->
   ```

5. Wait for review and CI, then merge the pull request into `main`.

The **Backport Release Hotfixes** workflow synchronizes the `hotfix` label from the title and validates this bilingual note contract. After merge, it locks release state, finds the single draft semantic-version release with a matching release branch, captures and checks out its exact head, applies the source PR result, appends both note lines to `electron-builder.yml` and stable release history, and creates a `backport/v<version>/pr-<source-number>` branch with a GitHub-verified, DCO-signed commit. It then revalidates that the release is still a draft and the release branch has not moved before opening a pull request against `release/v<version>`. It never writes the hotfix commit directly to the release branch.

Track the source pull request by its labels:

| Label | Meaning | Operator action |
| --- | --- | --- |
| `backport/v<version>` | A backport pull request is open | Review the backport pull request and wait for CI |
| `backported/v<version>` | The backport pull request was merged, or the fix was already present | Wait for release branch CI, then rebuild the draft |
| `backport-failed/v<version>` | Automation failed before opening a pull request, or the backport pull request closed without merging | Inspect the workflow run, backport manually, or reopen the pull request |

After the backport pull request is created:

1. Confirm its base is `release/v<version>` and its source link points to the intended merged hotfix PR.
2. Review the release-specific diff and wait for the backport pull request's **CI** checks to pass.
3. Merge the backport pull request. The source hotfix PR changes from `backport/v<version>` to `backported/v<version>` only after this merge.
4. Wait for **CI** on the resulting release branch head to succeed.
5. Run **Release** again from `release/v<version>`.
6. Select `all` unless only one platform artifact needs to be refreshed, then recheck the updated draft release.

Closing an automatic backport pull request without merging changes the source hotfix PR to `backport-failed/v<version>`. Reopening it restores the open `backport/v<version>` state. The workflow does not add `backport/v<version>` until an actual backport pull request exists, and any later preparation failure transitions the source PR to `backport-failed/v<version>`.

### Resolving a Backport Failure

When the source pull request receives `backport-failed/v<version>` before a backport pull request exists:

1. Create a temporary conflict-resolution branch from the current `release/v<version>` head.
2. Apply only the hotfix pull request's intended changes. Do not merge `main` into the release branch.
3. Resolve conflicts in favor of the release branch plus the required fix; do not bring unrelated later `main` changes into the release.
4. Run validation appropriate to the changed files.
5. Create a signed, DCO-signed commit and open a pull request targeting `release/v<version>` for review.
6. After it is merged, wait for release branch CI and rebuild the draft release.
7. On the source pull request, replace `backport-failed/v<version>` with `backported/v<version>` and comment with the manual resolution pull request or commit.

If the workflow reports multiple active release branches, leave only the intended release active and rerun the failed workflow. If it reports no active draft release, no backport is performed.

## 5. Publish the Release

Publish only after the latest release branch commit has passed CI and an `all`-platform build for that exact commit has completed successfully.

1. Open the draft under **Releases** and confirm the tag, target commit, notes, and artifacts one final time. Do not select **Publish release** on this page.
2. Open **Actions** → **Release** → **Run workflow**.
3. Select the matching `release/v<version>` branch and the `publish` operation.
4. Run the workflow.

The workflow shares the same release-state lock as preparation, builds, backport creation, and Post Release. Immediately before publishing, it requires the draft, tag, branch, and selected SHA to agree, rejects any open pull request targeting the release branch, requires a successful exact-head `all` build, and confirms that artifacts exist. Publication then makes the tag immutable for this workflow. **Release** refuses to update an already published release; any later fix requires a new version.

Publishing triggers **Post Release** automatically.

## 6. Merge the Release Metadata Pull Request

**Post Release** verifies that the published tag and `release/v<version>` still point to the same commit. It computes the metadata-only delta from the release branch point to the published tag, applies that delta with a three-way merge on the latest `main`, and opens `release-sync/v<version>`. Non-overlapping edits made on `main` are preserved; an overlapping edit fails the workflow for maintainer resolution instead of being overwritten.

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
5. Squash-merge it into `main` without changing the commit subject except for GitHub's optional ` (#<PR-number>)` suffix.

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
| `backport-failed/v<version>` | Automatic preparation failed or the backport PR closed unmerged | Inspect the linked workflow run or follow the manual procedure above |
| Backport pull request closed without merging | The hotfix has not reached the release branch | Reopen the pull request or complete a manual backport |
| Published tag and release branch differ | Release state changed after the build | Stop and reconcile the refs before retrying **Post Release** |
| Published metadata conflicts with `main` | The same metadata lines changed after the release branch was cut | Reconcile those edits on `main`, then rerun **Post Release**; never replace the whole file from the tag |
| Commit is not Verified or lacks DCO | Token identity or signing failed | Fix the workflow/token configuration; never bypass the check |

## Invariants

- Build internal feature previews only with **Preview Release** from a trusted same-repository branch; preview draft releases never become formal release state.
- Build and publish from `release/v<version>`, never from `main`.
- Merge every hotfix into `main` before backporting it to the release branch.
- Merge hotfixes into the release branch through a backport pull request, never through an automatic direct commit.
- Never merge all of `main` into an active release branch.
- Never publish a draft until the exact release commit passes CI and all required artifacts are present.
- Publish only with the **Release** workflow's `publish` operation; never publish directly from the Releases page.
- Never move a published release tag.
- Never merge the complete release branch back into `main`.
- Keep the metadata synchronization pull request title and body boundary marker unchanged, squash-merge it, and finish it before preparing the next release.
