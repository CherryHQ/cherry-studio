---
description: Maintainer runbook for preparing, validating, hotfixing, publishing, and synchronizing release branches
sources:
  - .github/workflows/nightly-build.yml
  - .github/workflows/auto-release-build.yml
  - .github/workflows/prepare-release.yml
  - .github/workflows/preview-release.yml
  - .github/workflows/release.yml
  - .github/workflows/release-target.yml
  - scripts/release/release-cos.py
  - scripts/release/sync-gitcode.sh
  - scripts/release/validate-release-state.js
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
| Preview | Any same-repository branch | **Preview Release** | Uploads Actions artifacts for internal testing |
| Prepare | `main` | **Pre Release** | Creates `release/v<version>` with a signed release metadata commit |
| Validate | `release/v<version>` | **CI** | Validates the exact release branch commit |
| Dispatch | Successful release-branch **CI** | **Auto Release Build** | Starts one exact-head all-platform build |
| Build | `release/v<version>` | **Release** | Creates or moves the draft tag, uploads artifacts, and composes the release body |
| Hotfix | Merged `main` pull request | **Backport Release Hotfixes** | Opens a backport pull request against the active release branch |
| Approve and publish | Successful exact-head all-platform build | **Release** | Waits for the `release` Environment approval, revalidates, and publishes the draft |
| Mirror packages | Published GitHub Release | **Release** | Uploads Global and CN assets to GitCode from COS |
| Synchronize | Published GitHub Release | **Post Release** | Opens a metadata-only `release-sync/v<version>` pull request |
| Close | `release-sync/v<version>` | **CI** | Validates the metadata pull request before it is merged into `main` |

## Internal Preview Builds

Use **Preview Release** when a maintainer needs installable packages from an unreleased feature branch for internal testing:

1. Open **Actions** → **Preview Release** → **Run workflow**.
2. Select `main` in the workflow branch selector for normal previews. To test workflow changes, select the trusted topic branch containing the workflow definition. This selector chooses the workflow code; the `branch` input below independently chooses the application source.
3. Enter a same-repository source branch in the `branch` input.
4. Select `all`, `windows`, `mac`, or `linux`, then run the workflow.
5. Open the completed workflow run and use the **Preview downloads** summary table to choose a platform, edition, and architecture; each row includes the version, size, and a direct artifact download link. The files are also listed under **Artifacts**.

Every selected platform builds both the global and China editions from the same resolved source commit. The package version is changed only inside the runner to `<base-version>-preview-<7-character-commit>`. Each successful platform and edition build uploads one installer per architecture as a separate, unarchived Actions artifact: Windows `setup.exe`, macOS `.dmg`, or Linux `.AppImage`. Download only the edition and architecture you need; artifact names are the original installer filenames and retention is 3 days. Portable executables, ZIP archives, DEB/RPM packages, and update metadata are not uploaded for previews. The download table includes available installers even if another build fails; if no installers were uploaded, it points to the build jobs instead. The workflow does not create GitHub Releases or tags.

Preview builds typecheck and compile one JS bundle per edition, then package macOS/Linux architectures in parallel using the formal-release target selection and bundle verification. Windows packages both architectures in one GitHub-hosted job per edition without the USB signing token. The source branch must contain both `build:release` entry points and `scripts/release/js-bundle.js`. Preview macOS builds retain formal-release signing and notarization credentials; application build variables are provided to each edition's bundle job. Preview jobs use repository-level secrets and do not reference a GitHub Environment, so they start without deployment approval. Only dispatch previews for trusted same-repository source branches. Formal publishing still requires approval through the `release` Environment. Preview builds explicitly disable package publishing and do not acquire the `release-state` lock or participate in formal release preparation, hotfix backports, or Post Release.

Preview uses the dependency-cache ownership, tool-asset preparation, and shallow packaging checkouts described under [Build or Retry the Draft Release](#3-build-or-retry-the-draft-release). Its hosted Windows Global job also saves the Windows store on a cache miss; the CN job only restores it. The resolved source must support packaging tool assets version 1 and contain `scripts/release/prepare-tools.js`; resolve rejects unsupported sources before bundle work starts.

## Nightly Builds

**Nightly Build** builds the Global edition from `main` daily at 01:00 Beijing time and can also be dispatched manually. Open the run's **Nightly downloads** summary to choose a platform and architecture; the table includes each installer's build date, size, and download link. Files are also listed under **Artifacts**.

Windows `setup.exe`, macOS `.dmg`, and Linux `.AppImage` installers for x64 and arm64 are uploaded individually without an extra ZIP archive. Names retain the `cherry-studio-nightly-<YYYYMMDD>-<platform>-<architecture>` prefix. Sign in to GitHub to download; retention is 3 days. Portable executables, ZIP archives, DEB/RPM packages, checksum files, and update metadata are not uploaded.

The table lists available installers even if another build fails. Dates come from the individual filenames, so retries on a later day can show different dates in the same run. If no installers are available, check the build jobs for details. Nightly builds are unstable and intended for testing; back up your data and prepare for data migration before installing.

## Before Starting

Confirm all of the following:

- The previous release is published.
- Its `chore(release): sync v<version> metadata` pull request is merged into `main` when one was created.
- The intended `main` commit is ready to release.
- Repository secrets used by release preparation, package signing, notarization, and publishing are available.
- You have permission to run workflows and approve deployments to the `release` Environment.

Do not create the release branch, release tag, or metadata synchronization pull request by hand during the normal flow. Do not publish from the GitHub Releases page. The workflows own those operations and serialize them with the repository-wide `release-state` concurrency group.

An administrator must create the `release` Environment before this flow is enabled and configure the trusted people or teams who may approve publication. GitHub enforces the Environment's current protection rules before the **Release** approval job continues. Configure that Environment's deployment branch policy to allow `main`, where the **Release** workflow and approval job run. A policy allowing only `release/v*` blocks this approval; the release branch identifies the installer source, not the deployment branch.

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

To explicitly abandon an unpublished release, first set `TAG=v<version>` and `BRANCH=release/$TAG`, then inspect `gh release view "$TAG" --json isDraft,tagName,url`, `git ls-remote --heads origin "refs/heads/$BRANCH"`, and `gh pr list --base "$BRANCH" --state open`. Continue only after confirming the version is unpublished and every related backport PR is closed. Delete the draft and its movable tag with `gh release delete "$TAG" --cleanup-tag --yes`, then delete the release branch with `git push origin --delete "$BRANCH"`. If only an orphan branch exists, skip the release deletion; if only an orphan draft exists, skip the branch deletion. These deletions are destructive and require an explicit maintainer decision.

## 2. Wait for Release Branch CI

Pushing `release/v<version>` automatically starts **CI**. After CI succeeds, **Auto Release Build** rechecks that the successful SHA is still the live branch head and dispatches **Release** on `main` with `all`, the release tag, and the exact release SHA. A stale CI completion is ignored, and an exact-head build is never dispatched twice.

The workflow and publication scripts are pinned to the selected `main` commit; only build jobs execute release-branch code. Release metadata is read as data by the trusted control jobs. The run title and archive metadata identify the release SHA, while the Actions run `head_sha` identifies the control workflow SHA.

The **Release** workflow checks GitHub Actions for a successful `ci.yml` push run whose `head_sha` exactly equals the commit being released. A successful run for an older commit does not satisfy this gate.

If CI is queued, running, cancelled, or failing, no build is dispatched. Fix or rerun CI first.

### Repairing the Initial Release Branch

The first release-branch CI run happens before a draft GitHub Release exists. If the release branch needs a fix, merge an eligible hotfix to `main` and review its automatic backport PR. The target is the highest semantic-version release branch, provided its version is higher than every published release. A draft is optional. After the backport merges, successful CI on the new release head automatically starts the build.

## 3. Build or Retry the Draft Release

The initial build and every rebuild after a release-branch change start automatically when exact-head CI succeeds. Use the manual **Release** control only to retry a failed build:

1. Open **Actions** → **Release** → **Run workflow**.
2. Select `main` in the branch selector. Set `tag=v<version>` and `expected_sha` to the full 40-character SHA of the current `release/v<version>` head.
3. Leave `mode=release`. Select `all` to retry the complete build, or `windows`, `mac`, or `linux` to replace only that platform's artifacts for the exact commit already referenced by the draft tag.
4. Run the workflow and wait for every selected build job to finish.

Before building, the workflow verifies that:

- The workflow was started from `main`, with a valid tag and exact release SHA.
- The branch version matches `package.json`.
- CI succeeded for the exact branch commit.
- A matching published release does not already exist.

Formal releases compile Global and CN JS once each in parallel on Linux with `build:release` or `build:release:cn`. Each edition starts packaging as soon as its own bundle succeeds, without waiting for the other edition. Platform jobs download the corresponding `release-js-<edition>` artifact and invoke electron-builder separately. Each bundle includes main, preload, renderer, and utility-process outputs with a source SHA, edition, version, and SHA-256 file inventory. Packaging rejects missing, altered, or mismatched bundles. Native dependencies and helpers are prepared for the packaging target, rather than copied from the bundle builder. Sentry uploads run in each edition's bundle job, including utility-process sourcemaps.

The release entry points rely on the exact-source CI gate instead of repeating the full typecheck; ordinary development, preview, and nightly build commands still run their existing checks. A release source missing either release entry point fails during preparation. Bundle jobs clear `out` before compilation; packaging jobs clear `out` and `dist` before downloading current output. Bundle artifacts have three-day retention; after expiry, retry the bundle jobs as well as packaging.

macOS and Linux package each edition's x64 and arm64 targets in separate jobs using one hosted runner type per OS: `macos-latest` for macOS and `ubuntu-latest` for Linux. Each job passes its target architecture to electron-builder; Linux ARM64 jobs enable QEMU for the Docker-based addon build. Hosted dependency-store caches are separated by runner OS and host architecture. The Global bundle job owns Linux store writes; the Global macOS x64 job owns macOS store writes. All consumers restore the store, and only its owner saves a missing exact key after its work succeeds. An exact cache hit skips saving. This also applies to single-platform builds. Linux SQLite artifacts use an exact cache keyed by target architecture, dependency lockfile, compatibility/download configuration, and patches; the existing pinned hashes and compatibility metadata are verified on reuse. Other native source builds retain their current preparation paths.

Packaging checks out only the resolved source commit with `fetch-depth: 1`; bundle verification needs its SHA, and packaging hooks do not consume Git history. Release control and finalization retain their existing history access for branch/tag validation and release metadata.

The persistent Windows signing machine keeps one job per edition and packages both architectures in that job. It uses its local pnpm store without uploading or restoring an Actions dependency-store cache. Every job still installs with `--frozen-lockfile`. The `clean` input removes node_modules while retaining the store; signing continues through the machine's USB token and Windows CSP.

Release and Preview prepare mise, Bun, uv, ripgrep, and Windows MinGit before packaging. Preparation uses only the checked-out application source; formal preparation rejects a source missing packaging tool assets version 1 or `scripts/release/prepare-tools.js` before expensive work. Existing release branches must contain that interface before using this workflow. Each invocation downloads at most three tools concurrently, verifies pinned SHA-256 digests, and extracts sequentially; Windows prepares x64 then arm64. The packaging hook retains preparation and completeness checks for direct electron-builder use.

Tool assets use a separate `CHERRY_BINARY_CACHE` under the runner tool cache. Formal Windows keeps that cache locally across checkouts. Hosted targets restore an Actions cache keyed by format, target platform/architecture, and download manifest digest, independent of edition and source commit. Global alone saves a missing exact key after successful preparation, before packaging; CN only restores. A simultaneous cold miss does not serialize the editions. GitHub branch cache visibility still applies. Only `complete/` is saved; partial transfers are excluded. Every reused original asset is digest-checked and copied or extracted into private resources; signed output is never cached. Invalid assets are fetched again. Phase logs distinguish cache verification, downloads, asset verification, and extraction/install; they do not establish signature or installer validity.

The **Release build performance** summary and `release-performance` JSON artifact report build job/step durations, runner labels, cache state, source/workflow SHAs, draft readiness, and final inventory sizes. Approval waiting, publication, and GitCode synchronization are excluded from build timing. Parallel job durations contribute to runner time, not summed wall time. Unmeasured native/signing/notarization phases and unavailable inventory sizes remain unknown; reruns do not count time between attempts as queue or elapsed time.

Every selected platform builds both editions from the same commit. Asset names, package IDs and update channels identify the edition. Both editions share the installed product name, executable, shortcut, protocol and `userData` location. Both Windows installers retain the Global NSIS GUID, so either edition can replace the installed app. Tag movement is allowed while the release is a draft.

Each runner validates and uploads its local files directly to the private COS bucket. The self-hosted Windows signing runner uploads through the Shanghai regional endpoint. GitHub-hosted macOS and Linux build runners upload through the global acceleration endpoint. macOS/Linux targets write separate edition/platform/architecture inventories; Windows writes one edition/platform inventory. macOS updater fragments have architecture-specific names until finalization merges their file entries and retains the release notes under the canonical edition channel. Linux updater manifests are already architecture-specific. Missing targets or conflicting file names fail assembly instead of producing a partial draft.

Preparation creates or updates the draft and claims a run/source-specific upload session. After each Global target succeeds, a separate trusted upload job downloads that target’s packages from COS and uploads them to the draft while other targets continue building. Build jobs retain read-only repository tokens; only the trusted upload jobs receive release write permission. Uploads revalidate the live branch, draft target and session owner under the release-state lock. A newer build invalidates earlier upload and publication attempts. CN files remain in COS.

Once all targets and their incremental uploads succeed, finalization downloads only Global update manifests and shared JSON metadata; CN macOS manifest fragments are read separately for aggregation. It merges the macOS manifests, uploads the metadata, and requires the GitHub attachment names and nonzero sizes to match the complete Global/shared COS inventory exactly. It then records the complete file inventory under `releases-sync/<tag>/<run_id>/release.json` after updating the draft. A single-platform retry reuses other platforms from the last complete inventory for the same commit, replaces both editions of its selected platform, and keeps the existing tag. If the baseline is unavailable, rerun an `all` build. The release-source branch must contain `scripts/release/js-bundle.js` and both release entry points before dispatching the optimized control workflow; preparation rejects older sources.

After the tag is exact, the workflow builds the GitHub Release body from the bilingual `electron-builder.yml` notes, a separator, and GitHub's generated `What's Changed` and contributor list. Stable release history remains generated during **Pre Release** in `resources/cherry-studio/release-history.json`; it is not maintained separately during publication.

To test a CN installer before approval, open the **CN installer downloads** table in the run summary. The table lists available Windows installers, macOS DMGs, and Linux AppImages from that run. Its COS links expire after 24 hours. Anyone holding a link can download the corresponding file until it expires.

Before publishing, inspect the draft release and confirm:

- The tag and release branch point to the same commit.
- All expected platform jobs succeeded.
- GitHub contains only Global installers, archives, update manifests, blockmaps and release notes.
- The complete COS inventory contains both Global and China editions, with manifests referencing only their own edition packages.
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

The **Backport Release Hotfixes** workflow synchronizes the `hotfix` label from the title and separately validates any provided bilingual note. After merge, it locks release state, selects the highest semantic-version release branch if its version is higher than every published release, and applies the source PR result with trusted workflow scripts. If a backport PR is already open for that release, the new fix and source marker are appended to its topic branch; otherwise the workflow creates `backport/v<version>/pr-<source-number>`. This keeps consecutive hotfixes in one reviewed backport pull request instead of creating conflicting PRs from the same release head. Every generated commit is GitHub-verified and DCO-signed off. The workflow revalidates the selected branch, published release state, release head, and aggregate backport head before writing, and never commits directly to the release branch.

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
4. Wait for **CI** on the resulting release branch head to succeed. **Auto Release Build** then starts the required `all` rebuild.
5. Recheck the updated draft release after **Release** succeeds. Single-platform retries remain manual and are only for the exact commit already referenced by the draft tag.

Closing an automatic backport pull request without merging changes the source hotfix PR to `backport-failed/v<version>`. Reopening it restores the open `backport/v<version>` state. The workflow does not add `backport/v<version>` until an actual backport pull request exists. A preparation failure before a pull request exists sets `backport-failed/v<version>`; if a backport pull request is already open, a rerun reconciles the source PR back to the open `backport/v<version>` state.

Release-state writers use `queue: max` with `cancel-in-progress: false`. Up to 100 jobs or workflow runs can wait for the shared lock, so target uploads do not replace pending preparation, backport, finalization or publication work. Excess queue entries can still be cancelled; a failed or cancelled target prevents publication. Approval waiting does not hold this lock. Rerun cancelled work; do not bypass the publication gate.

### Resolving a Backport Failure

When the source pull request receives `backport-failed/v<version>` before a backport pull request exists:

1. Create a temporary conflict-resolution branch from the current `release/v<version>` head.
2. Apply only the hotfix pull request's intended changes. Do not merge `main` into the release branch.
3. Resolve conflicts in favor of the release branch plus the required fix; do not bring unrelated later `main` changes into the release.
4. Run `PR_BODY="$(gh pr view <source-number> --json body --jq .body)" node scripts/release/hotfix-release-notes.js` to apply any provided bilingual note to `electron-builder.yml` and, for a stable release, release history. The command is a no-op when the note is `NONE` or absent.
5. Run validation appropriate to all changed code and metadata files.
6. Create a signed, DCO-signed commit and open a pull request targeting `release/v<version>` for review.
7. After it is merged, wait for release branch CI and the automatic draft rebuild.
8. On the source pull request, replace `backport-failed/v<version>` with `backported/v<version>` and comment with the manual resolution pull request or commit.

If the workflow reports no release branch newer than the published releases, it skips the backport. Prepare the next release branch before rerunning the backport workflow.

## 5. Publish the Release

Publish only after the latest release branch commit has passed CI and an `all`-platform build for that exact commit has completed successfully.

1. Open the draft under **Releases** and confirm the tag, target commit, bilingual notes, generated changes, and artifacts one final time. Do not select **Publish release** on this page.
2. Open the same **Release** run and its **Approve production release** job after the exact-head `all` build and draft update succeed.
3. Approve its deployment to the protected `release` Environment. Stable releases are marked latest; prereleases remain prereleases and do not replace the latest stable release.

The approval job does not hold the release-state lock. After approval, the publication job acquires that lock and takes one final state snapshot. It requires the approved run, draft, tag, branch, and selected SHA to agree; rejects open release-branch PRs and every merged `hotfix` after the release branch point that lacks `backported/v<version>`; and confirms that notes and artifacts exist. This explicit hotfix gate also blocks publication when a backport job is merely queued and has not opened its PR yet. If the release branch changed while approval was waiting, publication fails closed and the new exact-head build creates a new approval. The fetched `main` SHA in the final snapshot is the hotfix cutoff for the release; a hotfix merged after it belongs to the next release. Publication makes the tag immutable for this workflow. **Release** refuses to update an already published release; any later fix requires a new version.

Publishing triggers **Post Release** automatically. The GitCode job reads the completed COS inventory and uploads package attachments in batches of at most four concurrent Shanghai SCF invocations. Each invocation streams one file from the regional COS endpoint to the GitCode upload URL. Allow the corresponding concurrency in the SCF function quota. Each file retains its three-attempt retry policy and isolated temporary files. All package uploads must succeed before update manifests or shared JSON metadata are uploaded; a failed batch is drained and stops synchronization. The job then checks that GitCode lists all expected attachments. GitCode synchronization failure fails the workflow without rolling back the GitHub release. GitCode currently has no documented draft API, so it receives assets only after approval and GitHub publication.

### Retry GitCode Synchronization

1. Open **Actions** → **Release** → **Run workflow**, selecting `main` for current synchronization scripts.
2. Set `mode=sync-only`, `tag=v<version>`, and `run_id` to the original all-platform release run ID.
3. Optionally set `dry_run=true` to validate and preview the payload and files without GitCode writes or Feishu notifications.
4. Run synchronization. It requires an already published GitHub Release and a retained complete COS inventory for the original all-platform run. An existing GitCode Release is updated and files are uploaded again, with package files before update manifests.

The COS lifecycle controls retention. Keep referenced objects available for the supported retry window, including objects reused by newer partial builds. Builds created before the COS cutover need separate migration to use this sync path. Use **Re-run failed jobs** to retry a failed sync in the original run. The `clean` input removes signing-runner dependencies before a normal Windows build.

Preparation, build, draft finalization, approval, publication, and GitCode synchronization failures or cancellations are included in the failure notification. Skipped dependent jobs do not hide the originating failure. Sync-only dry runs never send notifications.

Configure `COS_SECRET_ID` and `COS_SECRET_KEY` with read, write, and multipart access under `releases-sync/` in `cherry-studio-1366585212`. The repository also needs `GITCODE_TOKEN`, `GITCODE_OWNER`, `GITCODE_REPO`, optional `GITCODE_API_URL`, Windows signing secrets, and Feishu failure-notification secrets. Builds and approval waits do not hold `release-state`; preparation, draft mutation and publication acquire it separately. GitCode syncs are serialized per tag.

Configure `TENCENT_SECRET_ID` and `TENCENT_SECRET_KEY` for a CAM identity that can invoke the SCF. To deploy code with **Deploy release sync SCF** on `main`, that identity also needs `scf:GetFunction` and `scf:UpdateFunctionCode`. Create `cherry-release-sync` in the `default` namespace in Shanghai as a Python 3.10 event function. Set the timeout to at least 300 seconds, enable outbound HTTPS, and bind a runtime role with COS read access to `releases-sync/`. Run the deploy workflow before enabling release synchronization.

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
| Automatic build was not dispatched | CI failed, the CI result was stale, or an exact-head build already exists | Repair or rerun exact-head CI; retry **Release** manually only when a build already failed |
| Branch and `package.json` versions differ | The release ref is inconsistent | Stop and correct the preparation flow; do not force a tag |
| Release is already published | Published releases cannot be rebuilt | Prepare a new version |
| Publication approval became stale | The release branch moved while approval was waiting | Use the approval run created by the new exact-head all-platform build |
| Release environment protection failed | The environment is missing or does not have the required team, self-review, and branch restrictions | Ask a repository administrator to restore the documented `release` Environment policy |
| No release branch is newer than the published releases | There is no eligible backport target | Prepare the next release branch before retrying |
| `backport-failed/v<version>` | Automatic preparation failed or the backport PR closed unmerged | Inspect the linked workflow run or follow the manual procedure above |
| Backport pull request closed without merging | The hotfix has not reached the release branch | Reopen the pull request or complete a manual backport |
| Published metadata conflicts with `main` | The same metadata lines changed after the release branch was cut | Reconcile those edits on `main`, then rerun **Post Release**; never replace the whole file from the tag |
| Commit is not Verified or lacks DCO | Token identity or signing failed | Fix the workflow/token configuration; never bypass the check |

## Invariants

- Build internal feature previews only with **Preview Release** from a same-repository branch; source branches must be trusted because builds use repository-level secrets without deployment approval, and preview packages are available only as Actions artifacts.
- Start **Release** from `main`, passing `tag` and `expected_sha` for the selected `release/v<version>` commit. Build and publish only that exact approved release SHA; workflow and publication control code come from the pinned `main` commit.
- Merge every hotfix into `main` before backporting it to the release branch.
- Merge hotfixes into the release branch through a backport pull request, never through an automatic direct commit.
- Never merge all of `main` into an active release branch.
- Never publish a draft until the exact release commit passes CI and all required artifacts are present.
- Publish only through the protected **Release** approval; never publish directly from the Releases page.
- Never move a published release tag.
- Never merge the complete release branch back into `main`.
- Keep the metadata synchronization pull request title and body boundary marker unchanged, squash-merge it, and finish it before preparing the next release.
