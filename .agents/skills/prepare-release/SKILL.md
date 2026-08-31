---
name: prepare-release
description: Prepare a new release by collecting commits, generating bilingual release notes, updating version files, and creating a release branch. Use when asked to prepare/create a release, bump version, or run `/prepare-release`.
---

# Prepare Release

Automate the Cherry Studio release workflow: collect changes → generate bilingual release notes → update files → create release branch → trigger CI/CD.

## Arguments

Parse the version intent from the user's message. Accept any of these forms:
- Bump type keyword: `patch`, `minor`, `major`
- Exact version: strict `x.y.z` or `x.y.z-<prerelease>` without build metadata (e.g. `1.8.0`, `1.8.0-beta.1`, `1.8.0-rc.1`)
- Natural language: "prepare a beta release", "bump to 1.8.0-rc.2", etc.

Defaults to `patch` if no version is specified. Always echo the resolved target version back to the user before proceeding with any file edits.

- `--dry-run`: Preview only, do not create a release branch.

## Workflow

### Step 1: Determine Version

1. For an interactive local run, fetch `origin/main` and all tags, then verify that the checkout is a clean `main` at exactly `origin/main`:
   ```bash
   git fetch origin refs/heads/main:refs/remotes/origin/main --tags
   test "$(git branch --show-current)" = main
   test -z "$(git status --porcelain)"
   test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"
   ```
   Stop before editing files if any check fails. This prevents a standalone run from creating a release branch from an arbitrary or stale checkout.
   In GitHub Actions, use the workflow's frozen dispatch SHA and leave checkout validation to the workflow. Do not fetch or compare the later `origin/main` head.
2. Read the current version from `package.json`. Post Release keeps this synchronized with the last published release.
3. Resolve the baseline tag as `v{current-version}` and verify that it exists:
   ```bash
   git rev-parse --verify refs/tags/v{current-version}
   ```
   Stop if it is missing. Confirm that it is also the latest published, non-draft GitHub Release whose tag is strict `v<semver>`; non-semver preview releases are never a release baseline:
   ```bash
   gh release list --limit 1000 --json isDraft,publishedAt,tagName --jq '[.[] | select(.isDraft == false and (.tagName | test("^v(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(-[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?$")))] | sort_by(.publishedAt) | last | .tagName // empty'
   ```
   Stop on a mismatch: the latest Post Release metadata PR must be merged into `main` before another release is prepared.
4. Compute the new version based on the argument:
   - `patch` / `minor` / `major`: bump from the current version.
   - An exact version must match `^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$` and pass `semver.valid`; build metadata such as `+build.1` is not accepted.
   - In both cases, require the result to be strictly greater than the current version according to semver precedence. Reject equal versions and downgrades.

### Step 2: Collect Commits

1. Determine the release-note collection base:
   - If the baseline tag is an ancestor of `HEAD`, use the tag.
   - Otherwise, use the latest commit whose full message contains the exact marker `release-metadata-boundary: <baseline-tag>`. This machine marker is added to the Post Release pull request body and survives the required squash merge.
   - For metadata pull requests created before the machine marker existed, accept a subject exactly equal to `chore(release): sync <baseline-tag> metadata` or that subject followed only by GitHub's squash suffix ` (#<PR-number>)`.
   - Stop with an error if the tag is not an ancestor and its metadata sync commit is missing; otherwise already-released hotfixes could be included again.
2. List all commits since that base:
   ```bash
   git log <collection-base>..HEAD --format="%H %s" --no-merges
   ```
3. For each commit, get the full body:
   ```bash
   git log <hash> -1 --format="%B"
   ```
4. Extract the content inside `` ```release-note `` code blocks from each commit body.
5. Extract the conventional commit type from the title (`feat`, `fix`, `refactor`, `perf`, `docs`, etc.).
6. **Skip** these commits:
   - Titles starting with `🤖 Daily Auto I18N`
   - Titles starting with `Merge`
   - Titles starting with `chore(deps)`
   - Titles starting with `chore: release`
   - Titles starting with `chore(release)`
   - Commits where the release-note block says `NONE`

### Step 3: Generate Bilingual Release Notes

Using the collected commit information, generate release notes in **both English and Chinese**.

**Recommended format:**

```
<!--LANG:en-->
Cherry Studio {version} - {Brief English Title}

✨ New Features
- [Component] Description

🐛 Bug Fixes
- [Component] Description

💄 Improvements
- [Component] Description

⚡ Performance
- [Component] Description

<!--LANG:zh-CN-->
Cherry Studio {version} - {简短中文标题}

✨ 新功能
- [组件] 描述

🐛 问题修复
- [组件] 描述

💄 改进
- [组件] 描述

⚡ 性能优化
- [组件] 描述
<!--LANG:END-->
```

The language markers are the machine-readable contract: include each marker once, keep them in order, and provide non-empty English and Chinese sections. Titles and surrounding explanatory text are presentation choices, not validation requirements.

**Rules:**
- Only include categories that have entries (omit empty categories).
- Each commit appears as exactly ONE line item in the appropriate category.
- Use the `release-note` field if present; otherwise summarize from the commit title.
- Component tags should be short: `[Chat]`, `[Models]`, `[Agent]`, `[MCP]`, `[Settings]`, `[Data]`, `[Build]`, etc.
- Chinese translations should be natural, not machine-literal.
- Do NOT include commit hashes or PR numbers.
- Read the **existing** release notes in `electron-builder.yml` as a style reference before writing.

**IMPORTANT: User-Focused Content Only**

Release notes are for **end users**, not developers. Exclude anything users don't care about:

- **EXCLUDE** internal refactoring, code cleanup, or architecture changes
- **EXCLUDE** CI/CD, build tooling, or test infrastructure changes
- **EXCLUDE** dependency updates (unless they add user-visible features)
- **EXCLUDE** documentation updates
- **EXCLUDE** developer experience improvements
- **EXCLUDE** technical debt fixes with no user-visible impact
- **EXCLUDE** overly technical descriptions (e.g., "fix race condition in Redux middleware")

**INCLUDE** only changes that users will notice:
- New features they can use
- Bug fixes that affected their workflow
- UI/UX improvements they can see
- Performance improvements they can feel
- Security fixes (simplified, without implementation details)

**Keep descriptions simple and non-technical:**
- ❌ "Fix streaming race condition causing partial tool response status in Redux state"
- ✅ "Fix tool status not stopping when aborting"
- ❌ "Auto-convert reasoning_effort to reasoningEffort for OpenAI-compatible providers"
- ✅ "Fix deep thinking mode not working with some providers"

### Step 4: Update Files

1. **`package.json`**: Update the `"version"` field to the new version.
2. **`electron-builder.yml`**: Replace the content under `releaseInfo.releaseNotes: |` with the generated notes. Preserve the 4-space YAML indentation for the block scalar content.
3. **`resources/cherry-studio/release-history.json`**: For a stable `x.y.z` release, add the version and its exact generated bilingual notes at the start of the array. Replace an existing entry for the same version instead of creating a duplicate. Leave this file unchanged for prereleases.
4. **Validate source metadata**: For an interactive local run, run `node scripts/release/validate-prepared-release.js --target-version {version}` before generating the product manifest, and stop if it rejects the changed paths, version ordering, bilingual sections, or stable history. In GitHub Actions, leave validation to the workflow step that runs after Claude.
5. **Built-in knowledge**: For an interactive local run, run `pnpm build:builtin-knowledge` after validation. This refreshes `resources/builtin-agents/cherry-assistant/product-manifest.json` with the new package version. Never edit the generated manifest by hand. In GitHub Actions, do not run the generator: the workflow runs the same validator first, then runs the trusted generator itself.

### Step 5: Present for Review

Show the user:
- The new version number.
- The full generated release notes.
- A summary of which files were modified.

If `--dry-run` was specified, stop here.

Otherwise, ask the user to confirm before proceeding to Step 6.

### Step 6: Create Release Branch

1. For an interactive local run, repeat Step 1 items 1-3 immediately before creating the branch. Because Step 4 has intentionally prepared and validated release metadata, replace Step 1's clean-worktree assertion with `git status --short` and stop unless every listed path is one of the four allowed release metadata files. Then create and push a signed, DCO-compliant release commit:
   ```bash
   git fetch origin refs/heads/main:refs/remotes/origin/main --tags
   test "$(git branch --show-current)" = main
   test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"
   test "$(node -p "require('./package.json').version")" = "{version}"
   BASELINE_VERSION="$(git show HEAD:package.json | jq -r .version)"
   BASELINE_TAG="v$BASELINE_VERSION"
   git rev-parse --verify "refs/tags/$BASELINE_TAG"
   LATEST_PUBLISHED="$(gh release list --limit 1000 --json isDraft,publishedAt,tagName --jq '[.[] | select(.isDraft == false and (.tagName | test("^v(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(-[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?$")))] | sort_by(.publishedAt) | last | .tagName // empty')"
   test "$LATEST_PUBLISHED" = "$BASELINE_TAG"
   REPO="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
   gh api --paginate --slurp "repos/$REPO/releases?per_page=100" | TAG="v{version}" node scripts/release/validate-release-state.js prepare
   test -z "$(git ls-remote --heads origin refs/heads/release/v{version})"
   git status --short
   UNEXPECTED_RELEASE_PATHS="$(git status --porcelain | cut -c4- | grep -Ev '^(package\.json|electron-builder\.yml|resources/cherry-studio/release-history\.json|resources/builtin-agents/cherry-assistant/product-manifest\.json)$' || true)"
   test -z "$UNEXPECTED_RELEASE_PATHS"
   git checkout -b release/v{version}
   git add package.json electron-builder.yml resources/cherry-studio/release-history.json resources/builtin-agents/cherry-assistant/product-manifest.json
   git commit -S --signoff -m "chore(release): prepare v{version}"
   git cat-file commit HEAD | grep -q '^gpgsig '
   git log -1 --format=%B | grep -q '^Signed-off-by: '
   git push -u origin release/v{version}
   ```
2. In GitHub Actions, stop after updating `package.json` and `electron-builder.yml`, plus `resources/cherry-studio/release-history.json` only for a stable release. Temporary helper files and local Git operations are allowed; the workflow extracts those three file changes, restores the frozen source SHA, and discards everything else before validation. It then generates the product manifest, creates the branch, and uses GitHub's API to create and verify the signed, DCO-compliant commit. Never push from the Claude step.
3. Report the release branch and next steps. Do not create a PR yet: the release must be built and published from this branch first.

## CI Trigger Chain

- Wait for the **CI** push run on the new `release/v{version}` commit to succeed, then run **`release.yml`** manually with that release branch selected. It validates the branch name against `package.json`, builds the exact branch commit on macOS, Windows, and Linux, and creates or updates a draft GitHub Release.
- While a single draft semantic-version release is active, **`backport-release-fixes.yml`** opens a backport PR for the first merged `hotfix: <description>` or `hotfix(<kebab-case-scope>): <description>` PR from `main`, applies any optional bilingual release note, then appends consecutive hotfixes and source markers to that same open topic branch. It manages every source PR's `hotfix` and backport-status labels and reports failures on the source PR; never merge `main` into the release branch.
- Review the backport PR, wait for its CI, and merge it. After the resulting release-branch push passes CI, run **`release.yml`** again from the release branch to rebuild the draft release.
- Publish only through the **`release.yml`** `publish` operation on the release branch. It shares the release-state lock with preparation, builds, and backports; verifies the exact successful all-platform build; then publishes the still-current draft. The final fetched `main` SHA is the hotfix cutoff; a hotfix merged after that snapshot belongs to the next release. Publication triggers **`post-release.yml`**, which uses the published tag as its source, applies only the release metadata delta to the latest `main`, and creates a `release-sync/v{version}` metadata-only PR.
- The metadata PR synchronizes only `package.json`, `electron-builder.yml`, release history, and the generated product manifest. It triggers **`ci.yml`**; merge it only after CI passes.
- When squash-merging the metadata PR, set the commit title to exactly `chore(release): sync v{version} metadata` with only GitHub's optional PR-number suffix, and keep `release-metadata-boundary: v{version}` on its own line in the squash commit body so the next release can find the boundary reliably.

## Constraints

- Always read `electron-builder.yml` before modifying it to understand the current format.
- Never retain changes outside `package.json`, `electron-builder.yml`, `resources/cherry-studio/release-history.json`, and the generated `resources/builtin-agents/cherry-assistant/product-manifest.json`.
- Never push directly to `main`.
- Never create the release metadata PR before the GitHub Release is published; `post-release.yml` owns that step.
- Always show the generated release notes to the user before creating the release branch (unless running in CI with no interactive user).
