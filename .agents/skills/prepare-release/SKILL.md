---
name: prepare-release
description: Prepare a new release by collecting commits, generating bilingual release notes, updating version files, and creating a release branch with PR. Use when asked to prepare/create a release, bump version, or run `/prepare-release`.
---

# Prepare Release

Automate the Cherry Studio release workflow: collect changes → generate bilingual release notes → update files → create release branch + PR → trigger CI/CD.

## Arguments

Parse the version intent from the user's message. Accept any of these forms:
- Bump type keyword: `patch`, `minor`, `major`
- Exact version: `x.y.z` or `x.y.z-pre.N` (e.g. `1.8.0`, `1.8.0-beta.1`, `1.8.0-rc.1`)
- Natural language: "prepare a beta release", "bump to 1.8.0-rc.2", etc.

Defaults to `patch` if no version is specified. Always echo the resolved target version back to the user before proceeding with any file edits.

- `--dry-run`: Preview only, do not create branch or PR.

## Workflow

### Step 1: Determine Version

1. Get the latest tag:
   ```bash
   git describe --tags --abbrev=0
   ```
2. Read current version from `package.json`.
3. Compute the new version based on the argument:
   - `patch` / `minor` / `major`: bump from the current tag version.
   - `x.y.z` or `x.y.z-pre.N`: use as-is after validating it is valid semver.

### Step 2: Collect Commits

1. List all commits since the last tag:
   ```bash
   git log <last-tag>..HEAD --format="%H %s" --no-merges
   ```
2. For each commit, get the full body:
   ```bash
   git log <hash> -1 --format="%B"
   ```
3. Extract the content inside `` ```release-note `` code blocks from each commit body.
4. Extract the conventional commit type from the title (`feat`, `fix`, `refactor`, `perf`, `docs`, etc.).
5. **Skip** these commits:
   - Titles starting with `🤖 Daily Auto I18N`
   - Titles starting with `Merge`
   - Titles starting with `chore(deps)`
   - Titles starting with `chore: release`
   - Commits where the release-note block says `NONE`

### Step 3: Generate Bilingual Release Notes

Using the collected commit information, generate release notes in **both English and Chinese**.

**Format** (must match exactly):

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

**Rules:**
- Only include categories that have entries (omit empty categories).
- Each commit appears as exactly ONE line item in the appropriate category.
- Use the `release-note` field if present; otherwise summarize from the commit title.
- Component tags should be short: `[Chat]`, `[Models]`, `[Agent]`, `[MCP]`, `[Settings]`, `[Data]`, `[Build]`, etc.
- Chinese translations should be natural, not machine-literal.
- Do NOT include commit hashes or PR numbers.
- Omit purely internal commits (refactor, CI, docs) with no user-facing impact.
- Read the **existing** release notes in `electron-builder.yml` as a style reference before writing.

### Step 4: Update Files

1. **`package.json`**: Update the `"version"` field to the new version.
2. **`electron-builder.yml`**: Replace the content under `releaseInfo.releaseNotes: |` with the generated notes. Preserve the 4-space YAML indentation for the block scalar content.

### Step 5: Present for Review

Show the user:
- The new version number.
- The full generated release notes.
- A summary of which files were modified.

If `--dry-run` was specified, stop here.

Otherwise, ask the user to confirm before proceeding to Step 6.

### Step 6: Create Branch and PR

1. Create and push the release branch:
   ```bash
   git checkout -b release/v{version}
   git add package.json electron-builder.yml
   git commit -m "chore: release v{version}"
   git push -u origin release/v{version}
   ```
2. Create the PR using the `gh-create-pr` skill. If the skill tool is unavailable, read `.agents/skills/gh-create-pr/SKILL.md` and follow it manually. In CI (non-interactive) mode, skip interactive confirmation steps and create the PR directly after filling the template.
   - Use title: `chore: release v{version}`
   - Use base branch: `main`
   - When filling the PR template, incorporate:
     - The generated release notes (English section only, for readability).
     - A list of included commits.
     - A review checklist:
       - [ ] Review generated release notes in `electron-builder.yml`
       - [ ] Verify version bump in `package.json`
       - [ ] CI passes
       - [ ] Merge to trigger release build
3. Report the PR URL and next steps.

## CI Trigger Chain

Creating a PR from `release/v*` to `main` automatically triggers:
- **`release.yml`**: Builds on macOS, Windows, Linux and creates a draft GitHub Release.
- **`ci.yml`**: Runs lint, typecheck, and tests.

## Constraints

- Always read `electron-builder.yml` before modifying it to understand the current format.
- Never modify files other than `package.json` and `electron-builder.yml`.
- Never push directly to `main`.
- Always show the generated release notes to the user before creating the branch/PR (unless running in CI with no interactive user).
