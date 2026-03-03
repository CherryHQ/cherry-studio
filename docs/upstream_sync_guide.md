# Upstream Sync Guide

> How to safely pull updates from CherryHQ/cherry-studio without overwriting our rebranding work.

---

## Remote Setup

| Remote | URL | Fetch | Push |
|---|---|---|---|
| `origin` | `https://github.com/imrshohel/automatseo` | Yes | Yes |
| `upstream` | `https://github.com/CherryHQ/cherry-studio.git` | Yes | **DISABLED** |

### Tracked Upstream Branches

| Branch | Purpose | Sync Priority |
|---|---|---|
| `upstream/main` | Active development, bug fixes, new features | **PRIMARY** — sync regularly |
| `upstream/release/*` | Stabilized release candidates (e.g. `release/v1.7.20`) | **HIGH** — sync before our releases |
| `upstream/v2` | Major v2.0 rewrite (Redux/IndexedDB schema changes) | WATCH — evaluate before merging |
| `upstream/migrate/v6` | AI SDK v6 migration | WATCH — evaluate before merging |

> **Note:** Release branches appear temporarily. Fetch them with `git fetch upstream release/v*` and sync before they merge into `main`. Once merged upstream, the branch may be deleted.

---

## Upstream's Workflow (How They Work)

Based on their branching strategy and contribution guidelines:

- **All PRs target `main`** — bug fixes, features, docs, everything
- **Commit convention:** `fix:`, `feat:`, `chore:`, `refactor:`, `docs:`, `ci:`
- **Release branches:** `release/*` created from `main`, only bug fixes allowed
- **Commit frequency:** ~100 commits per cycle (~46% fixes, ~28% features, ~20% maintenance)
- **v2.0 in progress:** Major architectural changes to Redux data models and IndexedDB schemas happening on `v2` branch. These will be the hardest to merge.

---

## File Classification for Merge Safety

### OURS-ONLY Files (always keep our version, never accept upstream)

These files contain our brand identity. On conflict, **always pick ours**.

```
package.json                          # name, author, homepage, desktopName
electron-builder.yml                  # appId, productName, protocols, executableName
src/main/index.ts                     # crash reporter, protocol, window class
src/main/services/ProtocolClient.ts   # protocol scheme, desktop entry
src/renderer/src/config/env.ts        # APP_NAME
src/renderer/index.html               # <title>
src/renderer/miniWindow.html          # <title>
src/renderer/selectionAction.html     # <title>
src/renderer/selectionToolbar.html    # <title>
scripts/notarize.js                   # appBundleId
build/*                               # all icons and assets
src/renderer/src/assets/images/logo.png
src/renderer/src/assets/images/cherry-text-logo.svg
resources/cherry-studio/*             # license, privacy, releases HTML
README.md
CONTRIBUTING.md
SECURITY.md
.github/workflows/*                   # our CI/CD pipelines
.github/ISSUE_TEMPLATE/*              # our issue templates
.github/pull_request_template.md
docs/**/*.md                          # our documentation
CLAUDE.md
AGENTS.md
```

### THEIRS-SAFE Files (usually safe to accept upstream changes)

These files contain pure logic, no branding strings. Upstream fixes are valuable here.

```
src/main/knowledge/**                 # knowledge/RAG logic
src/main/services/MCPService.ts       # MCP protocol logic (not branding parts)
src/main/services/WindowService.ts
src/main/services/PowerMonitorService.ts
src/renderer/src/aiCore/legacy/**     # AI client implementations
src/renderer/src/aiCore/plugins/**    # plugin logic (non-branding parts)
src/renderer/src/components/**        # UI components (non-branding parts)
src/renderer/src/hooks/**             # React hooks
src/renderer/src/store/**             # Redux store logic (non-branding parts)
packages/aiCore/src/core/**           # AI core logic
packages/extension-table-plus/src/**  # table extension logic
packages/mcp-trace/**                 # tracing logic
packages/shared/utils.ts              # shared utilities
```

### CONFLICT-PRONE Files (need manual review every time)

These files contain BOTH branding strings AND upstream logic. Conflicts are expected.

```
packages/shared/config/constant.ts    # HOME_CHERRY_DIR + other constants
src/renderer/src/config/providers.ts  # provider list + cherryin branding
src/renderer/src/databases/index.ts   # DB name + schema logic
src/renderer/src/i18n/locales/*.json  # app name strings + UI translations
src/main/services/AppMenuService.ts   # menu structure + branded URLs
src/renderer/src/pages/settings/AboutSettings.tsx  # about page + branded links
src/main/services/SelectionService.ts # selection logic + bundle ID check
electron.vite.config.ts              # build config + @cherrystudio aliases
tsconfig.web.json                     # TS config + @cherrystudio paths
```

---

## Standard Sync Procedure

### Step 1: Fetch (safe, no changes to working tree)

```bash
git fetch upstream main
git fetch upstream v2
git fetch upstream migrate/v6
```

### Step 2: Review what's incoming

```bash
# See commit list since our last sync
git log main..upstream/main --oneline

# Filter to only bug fixes (most valuable for us)
git log main..upstream/main --oneline --grep="^fix"

# See which files changed
git diff main...upstream/main --stat

# Check if any OURS-ONLY files were touched
git diff main...upstream/main --stat | grep -E "package\.json|electron-builder|ProtocolClient|config/env\.ts|index\.html"
```

### Step 3: Merge with strategy

```bash
# Create a sync branch first (never merge directly to main)
git checkout main
git checkout -b sync/upstream-YYYY-MM-DD

# Merge upstream
git merge upstream/main --no-commit
```

The `--no-commit` flag pauses before committing so you can review conflicts.

### Step 4: Resolve conflicts

For each conflicted file, check which category it falls in:

```bash
# See all conflicts
git diff --name-only --diff-filter=U
```

- **OURS-ONLY files:** `git checkout --ours <file>` then `git add <file>`
- **THEIRS-SAFE files:** `git checkout --theirs <file>` then `git add <file>`
- **CONFLICT-PRONE files:** Open and manually merge — keep our branding, accept their logic changes

### Step 5: Verify and commit

```bash
pnpm install                    # in case dependencies changed
pnpm lint && pnpm test          # verify nothing broke
git commit -m "chore: sync upstream/main (YYYY-MM-DD)"
```

### Step 6: Merge sync branch to main

```bash
git checkout main
git merge sync/upstream-YYYY-MM-DD
git push origin main
```

---

## Cherry-Picking (Alternative: Selective Sync)

When you only want specific bug fixes instead of a full merge:

```bash
# Find the fix you want
git log upstream/main --oneline --grep="^fix"

# Cherry-pick it
git checkout main
git cherry-pick <commit-hash>

# If it conflicts with branding, resolve manually
# Then verify
pnpm lint && pnpm test
```

This is safer but requires more manual tracking of what's been synced.

---

## Sync Schedule Recommendation

| Frequency | What | Why |
|---|---|---|
| **Weekly** | `git fetch upstream` | Stay aware of changes |
| **Bi-weekly** | Review `fix:` commits, cherry-pick critical ones | Get bug fixes fast |
| **Monthly** | Full `merge upstream/main` | Stay reasonably current |
| **On release** | Full sync before our releases | Ensure stability |

---

## Danger Zones

### Never Do

- `git push upstream` — push is DISABLED but don't try to re-enable it
- `git merge upstream/v2` into main without full review — v2 has breaking schema changes
- Accept upstream changes to `package.json` `name` field blindly
- Accept upstream changes to `electron-builder.yml` `appId`/`productName`
- Merge upstream i18n files without checking for "Cherry Studio" strings

### Watch Carefully

- **upstream/v2 branch** — when it merges to main, it will bring massive Redux/IndexedDB changes. Plan a dedicated migration effort for that.
- **New files from upstream** — they may contain "Cherry Studio" branding in new components, settings pages, or services. Always grep new files for branding after merge.
- **Dependency version bumps** — upstream may update `@cherrystudio/*` external packages. These are fine to accept since we keep those as-is.

---

## Post-Merge Checklist

After every upstream sync:

- [ ] `pnpm install` completed without errors
- [ ] `pnpm lint` passes
- [ ] `pnpm test` passes
- [ ] Grep for accidental branding leaks: `grep -ri "Cherry Studio" src/renderer/index.html src/renderer/src/config/env.ts electron-builder.yml package.json`
- [ ] Check HTML titles haven't reverted: `grep "<title>" src/renderer/*.html`
- [ ] Check APP_NAME hasn't reverted: `grep "APP_NAME" src/renderer/src/config/env.ts`
- [ ] Check no new "Cherry Studio" strings in i18n: `git diff --name-only | grep i18n | xargs grep -l "Cherry Studio"`
- [ ] Build runs: `pnpm build:check`

---

## Sync Log

| Date | Branch Synced | Commits | Conflicts | Status |
|---|---|---|---|---|
| 2026-02-25 | `upstream/release/v1.7.20` | 103 (48 fixes) | 4 committed merge + 27 stash pop (all resolved) | Lint: PASS, Tests: 8 fail (pre-existing upstream Windows issues) |
