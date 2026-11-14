# Stage 1 — Landing (Subtree Merge + Workspace Integration)

## Objective

Land the entire mobile repository under `apps/mobile/` with full history, integrate it into a single
pnpm workspace with a single lockfile, resolve all package-name collisions, and re-establish CI for
both applications.

## Preconditions

- Stage 0 merged (purity guard exists before shared code arrives).
- Announcement to all active branch owners: a lockfile-touching change is landing (see Risks).

## Blast-Radius Contract

Desktop-side diff is confined to: `pnpm-workspace.yaml`, `pnpm-lock.yaml`,
`.github/workflows/*`. Nothing under desktop `src/` is touched. The stage is two PRs: the landing
branch contains one subtree merge and lands through a GitHub merge commit; the second PR contains
the workspace wiring. The landed GitHub merge is the atomic `git revert -m 1` target.

## Design Decisions (ADR summary)

- **`git subtree` over submodule/monorepo-import tooling.** Submodules would preserve the
  two-repository boundary this migration exists to remove. `git subtree add` produces a single
  merge commit whose second parent is the mobile HEAD — full history reachable
  (`git log --follow` works), no rewrite of either history, trivially revertible.
  Mechanism empirically validated: 1,978 commits preserved; repository went 8,369 → 10,347 commits.
- **`--no-tags` on fetch.** Both repositories already own release tags in the `0.x`/`1.x`
  namespaces; identical names such as `0.1.0` and `0.1.1` exist on both sides. Importing tags would
  therefore be ambiguous: existing desktop refs win silently on collisions, while non-colliding
  mobile refs add a second project's release namespace. The commit history does not require tags,
  and historical mobile tags remain resolvable in the archived origin repository. Never bulk-delete
  desktop `v0.*`/`v1.*` tags as landing cleanup.
- **Collision renames applied on the mobile side only** (Invariant I3), scoped strictly to the
  `apps/mobile/` subtree.

---

## 1a. Production landing from a clean branch

Create a dedicated branch at the then-current `origin/main`. Do not reuse a feasibility-spike
worktree and do not put hard resets or broad clean commands in the landing procedure.

```bash
git fetch origin main
git switch -c feat/mobile-subtree-landing origin/main
test -z "$(git status --porcelain)"
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"
git remote add mobile https://github.com/CherryHQ/cherry-studio-app.git   # skip if present
git fetch --no-tags mobile v0.2:refs/remotes/mobile/v0.2
git subtree add --prefix=apps/mobile refs/remotes/mobile/v0.2
```

Post-conditions (assert before proceeding):

```bash
git merge-base --is-ancestor 3707410b9191e6a8ab5ff1e1271f10c4626f5958 HEAD   # exit 0
git cat-file -p HEAD | grep -c ^parent                                        # == 2
```

### 1a-1. Landing merge strategy (history-preservation blocker)

PR 1 must be merged with **Create a merge commit**. Squash or rebase flattens the subtree commit,
disconnects the imported 1,978-commit history from `main`, and invalidates the documented
`git revert -m 1` rollback.

The `main` ruleset measured on 2026-08-18 requires linear history and allows only squash merges, so
PR 1 cannot land correctly under the normal policy. Immediately before merge, a repository admin
must make a time-bounded exception: suspend `required_linear_history` and add `merge` to the PR
rule's allowed merge methods, without weakening review, signature, or status-check requirements.
Merge this PR only, then restore both settings immediately after the assertions below pass. Do not
substitute squash, rebase, or a silent history rewrite.

After GitHub merges PR 1, fetch `main` and assert the landed commit, not merely the pre-PR branch:

```bash
git fetch origin main
git cat-file -p origin/main | grep -c ^parent                                  # == 2
git cat-file -p <subtree-merge-sha> | grep -c ^parent                          # == 2
git merge-base --is-ancestor <subtree-merge-sha> origin/main
git merge-base --is-ancestor 3707410b9191e6a8ab5ff1e1271f10c4626f5958 origin/main
```

Record both the subtree merge SHA before opening PR 1 and the landed GitHub merge SHA afterward.
The latter is the `-m 1` rollback target used below.

**Origin-repository cutover.** After 1c gates pass and the PR merges: freeze
`cherry-studio-app` (README banner, close PR intake). If `v0.2` advances during the landing window,
absorb increments with `git subtree pull --prefix=apps/mobile mobile <ref>`.

---

## 1b. Workspace Integration

### 1b-1. Workspace topology (desktop diff site ①)

Root `pnpm-workspace.yaml`:

```yaml
packages:
  - 'packages/*'
  - 'apps/mobile'
  - 'apps/mobile/packages/*'
```

Prefix and carry over **every** mobile `packages:` glob, not only the known package directory. At
measurement time mobile declares `packages/*`, which becomes `apps/mobile/packages/*` above. At
execution time, diff the discovered workspace member set before and after the merge; if mobile has
added another glob (for example `modules/*`), add its `apps/mobile/…` equivalent before deleting the
nested manifest.

Merge the following non-member keys from `apps/mobile/pnpm-workspace.yaml` into the root file (pnpm
ignores nested workspace manifests; leaving the nested file is inert but misleading):

| Key | Action |
|---|---|
| `minimumReleaseAge: 1440` | Adopt (absent at root; root's existing `minimumReleaseAgeExclude` retained) |
| `trustPolicy: no-downgrade` + `trustPolicyExclude` (5 entries: `eslint-import-resolver-typescript@3.10.1`, `react-native-chart-kit@7.0.2`, `semver@6.3.1`, `tinyexec@1.2.2`, `ua-parser-js@0.7.41\|\|1.0.41`) | Adopt verbatim |
| `packageExtensions` (`@bottom-tabs/react-navigation@1.4.0` block et al.) | Merge verbatim |
| `patchedDependencies` | See 1b-2 |

`apps/mobile/package.json` currently declares `"packageManager": "pnpm@11.8.0"`. Remove that leaf
declaration after verifying compatibility with the root's pinned pnpm version; the root becomes the
single Corepack authority. Audit `engines` on both manifests and reconcile any incompatible Node or
pnpm range before install (mobile has no `engines` field at measurement time).

Then delete `apps/mobile/pnpm-workspace.yaml` and `apps/mobile/pnpm-lock.yaml`.

### 1b-2. Patch reconciliation (measured collision inventory)

pnpm resolves `patchedDependencies` paths relative to the workspace root; all mobile patches must
relocate to root `patches/`.

**Byte-identical on both sides (6)** — delete the mobile copy; the root `patchedDependencies` entry
already exists with the same key:
`@ai-sdk__anthropic.patch`, `@ai-sdk__deepseek@2.0.30.patch`, `@ai-sdk__google@3.0.64.patch`,
`@ai-sdk__xai@3.0.111.patch`, `@openrouter__ai-sdk-provider@2.10.0.patch`,
`@opeoginni__github-copilot-openai-compatible@1.0.0.patch`.

**Content-divergent (4)** — hunk-level reconciliation required (⟳ re-diff at execution):

| Patch | Divergence | Resolution |
|---|---|---|
| `@ai-sdk__openai@3.0.53.patch` | 176 diff lines | Desktop version is the baseline; graft mobile-only hunks; run both sides' provider test suites |
| `@ai-sdk__openai-compatible@2.0.62.patch` | 72 diff lines | Same procedure |
| `ollama-ai-provider-v2@3.3.1.patch` | 163 diff lines | Same procedure |
| `ai@6.0.183.patch` (mobile) vs `ai@6.0.185.patch` (desktop) | Version fork | Root `overrides` pins `ai: 6.0.185` workspace-wide, so mobile's resolution converges on 6.0.185. Verify the 6.0.183 patch's hunks are subsumed by the 6.0.185 patch (reasoning-retention class), then delete the 6.0.183 patch and its manifest entry |

**Mobile-only (11)** — `git mv apps/mobile/patches/* patches/` and merge their
`patchedDependencies` entries into the root manifest:
`@bottom-tabs__react-navigation@1.4.0`, `@magrinj__expo-quick-look@0.3.1`, `expo-widgets@57.0.8`,
`metro@0.84.4`, `metro-runtime@0.84.4`, `react-native-bottom-tabs@1.4.0`,
`react-native-keyboard-controller@1.21.13`, `react-native-nitro-healthkit@1.0.0`,
`react-native-reanimated@4.5.0`, `uniwind@1.6.5`. Delete the emptied `apps/mobile/patches/`.

### 1b-3. Override propagation audit

Root `overrides` apply workspace-wide and therefore now constrain mobile. Measured to be benign —
every desktop pin satisfies the corresponding mobile range:
`ai@6.0.185 ∈ ^6.0.143`, `@ai-sdk/anthropic@3.0.103 ∈ ^3.0.79`,
`@ai-sdk/provider-utils@4.0.40 = 4.0.40`.

Ordinary (non-override) dependencies coexist per-package and are **deliberately not unified** —
pnpm resolves each `package.json` independently. The 32 measured version divergences
(`drizzle-orm` `^0.44.5`/`^0.45.2`, `i18next` 23/26, `react-i18next` 14/17, `uuid` 13/14, `katex`,
`tailwind-merge`, …) remain as-is; unification of any of them is a per-domain decision made when
that domain is unified, not a landing precondition.

Post-`pnpm install` spot-check:
`pnpm ls --filter cherry-studio-app ai drizzle-orm i18next` — assert no unexpected downgrades.

### 1b-4. Collision renames (288 files, `apps/mobile/` subtree only)

Workspace package names must be unique. Four collisions, resolved per naming policy (README):

| Original | New name | Category |
|---|---|---|
| `@cherrystudio/ui` | `@cherrystudio/ui-native` | Permanent (genuine platform fork: Radix/DOM vs RN/Skia/Nitro) |
| `@cherrystudio/ai-core` | `@cherrystudio/mobile-ai-core` | Debt marker → removed in Stage 2c |
| `@cherrystudio/ai-sdk-provider` | `@cherrystudio/mobile-ai-sdk-provider` | Debt marker → removed in Stage 2b |
| `@cherrystudio/provider-registry` | `@cherrystudio/mobile-provider-registry` | Debt marker → removed in Stage 3a |

Batch rewrite (validated: does not touch the external npm packages `@cherrystudio/openai` and
`@cherrystudio/pdf-text-extractor`; negative lookahead on `ui` prevents double application):

```bash
find apps/mobile -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.mjs' \
  -o -name '*.cjs' -o -name '*.json' -o -name '*.md' \) ! -path '*/node_modules/*' -print0 |
xargs -0 perl -pi -e '
  s{\@cherrystudio/ai-sdk-provider}{\@cherrystudio/mobile-ai-sdk-provider}g;
  s{\@cherrystudio/ai-core}{\@cherrystudio/mobile-ai-core}g;
  s{\@cherrystudio/provider-registry}{\@cherrystudio/mobile-provider-registry}g;
  s{\@cherrystudio/ui(?![a-zA-Z0-9-])}{\@cherrystudio/ui-native}g;
'
```

Coverage includes each package's `package.json#name`. Post-rewrite assertion — the specifier
histogram over `apps/mobile` must contain exactly:
`ui-native`, `mobile-provider-registry`, `mobile-ai-core`, `mobile-ai-sdk-provider`,
`universal`, `ai-runtime`, `app-icons`, `design-tokens`, plus external `openai` and
`pdf-text-extractor`.

### 1b-5. Metro resolution scope

`apps/mobile/metro.config.js`: `projectRoot` stays `apps/mobile`; add the repository root to
`watchFolders` and `<repo-root>/node_modules` to `resolver.nodeModulesPaths` (required for
resolving root `node_modules` and, later, promoted root `packages/*`). Mobile was already a
workspace-shaped project; this is a parameter change, not an architectural one.

### 1b-6. CI split (desktop diff site ②)

After the subtree merge, mobile workflows live at `apps/mobile/.github/workflows/` — **GitHub
Actions does not read nested workflow directories; all four are dead on arrival.** Disposition:

| Mobile workflow | Disposition |
|---|---|
| `pr-ci.yml` | Rewrite as root `.github/workflows/mobile-ci.yml`: `on.pull_request.paths: ['apps/mobile/**', 'packages/**']`, `defaults.run.working-directory: apps/mobile` |
| `android-release.yml`, `ios-release.yml` | Relocate as `mobile-android-release.yml` / `mobile-ios-release.yml`; EAS credentials must be provisioned into `CherryHQ/cherry-studio` org secrets (requires org admin; can lag — see Risks) |
| `port-bot.yml` | **Decommission** (cross-repository sync automation; purpose voided by the monorepo) |

Do **not** add workflow-level `paths-ignore` to desktop `ci.yml`. The `main` ruleset currently
requires the `basic-checks`, `general-test`, and `render-test` contexts; if the workflow never
starts, a mobile-only PR remains blocked at "Expected — Waiting for status to be reported."
Instead, add a change-detection job and keep every required job name present on every PR. On a
mobile-only diff, those jobs run an explicit no-op step; on desktop or shared-package diffs, they run
the existing desktop gate. Re-query the active ruleset at execution time and prove the design with a
mobile-only draft PR before merging Stage 1. Delete the now-inert `apps/mobile/.github/` tree.

### 1b-7. Path-aware review policy (non-blocking governance follow-up)

**Goal:** after landing, a PR whose entire diff is under `apps/mobile/**` needs one valid approval so
the mobile team can iterate quickly. A PR touching desktop code, root configuration, workflows, or
shared `packages/**` keeps the existing two-approval policy. Required signatures, status checks,
linear-history policy, and CODEOWNERS review remain unchanged for both classes.

GitHub's built-in `required_approving_review_count` applies to the `main` ref as a whole; it cannot
express a path-specific count. The current ruleset requires two approvals, so lowering it directly
would unintentionally relax every desktop PR. Implement the mobile exception as a separate
repository-governance change, not as a Stage 1 merge blocker:

1. Add `/apps/mobile/` ownership for the nominated mobile maintainer team in `.github/CODEOWNERS`.
2. Add a trusted required check (organization-required workflow or GitHub App, not a workflow that
   the evaluated PR can weaken) that reads the changed-file set and latest non-dismissed reviews:
   - every changed path matches `apps/mobile/**` → require at least 1 approval;
   - any other path → require at least 2 approvals.
3. Trigger/recompute the check on PR open/reopen/synchronize and review submit/dismiss events so a
   new push or dismissed review cannot retain a stale pass.
4. Only after the path-aware check is required on `main`, lower the built-in approval count from 2
   to 1. Never reverse this order.
5. Prove the policy with three draft PRs: mobile-only + 1 approval passes; desktop/shared + 1 remains
   blocked; desktop/shared + 2 passes.

This follow-up is outside the two landing PRs below and may land after Stage 1. Until it does,
mobile-only PRs retain the repository-wide two-approval requirement.

---

## 1c. Dual Green Gates (merge blockers)

```bash
# Desktop non-regression:
pnpm install && pnpm build:check && pnpm test && pnpm test:lint
pnpm build:unpack     # MANDATORY: electron-builder's pnpm file collector is hoisting-sensitive
                      # (see patches/app-builder-lib@26.15.6.patch); must be exercised against the merged lockfile
# Mobile viability:
pnpm --filter cherry-studio-app typecheck
pnpm --filter cherry-studio-app test
pnpm --filter cherry-studio-app dev    # Metro boots; smoke test on simulator/device
```

## Rollback

`git revert -m 1 <landing-pr-merge-sha>` + revert of the wiring PR restores the pre-landing state
exactly (single-lockfile revert included).

## Risks

| Risk | Mitigation |
|---|---|
| Lockfile conflicts against ~110 in-flight branches | Land 1b within one day of 1a; broadcast beforehand. Direction-independent conflict recipe: delete only the conflicted root `pnpm-lock.yaml`, then run `pnpm install` to regenerate it from the reconciled manifests |
| Faulty reconciliation of the 4 divergent patches | Per-patch gate: desktop `pnpm test:main` + mobile `pnpm --filter cherry-studio-app test:ai-runtime` |
| Hoisting shift breaks packaging | `build:unpack` is a hard gate; on failure inspect the app-builder-lib collector patch |
| EAS secrets not yet provisioned | `mobile-ci.yml` (typecheck/test) lands first; release workflows may trail without blocking the landing |

## PR Partitioning

| PR | Content |
|---|---|
| 1 | `feat(monorepo): land mobile application as apps/mobile subtree` — subtree merge only; repository-admin policy exception + GitHub **Create a merge commit** required; never squash/rebase |
| 2 | `chore(workspace): integrate apps/mobile into the root workspace` — all of 1b + 1c evidence. 1b-1…3 and 1b-4 are inseparable (the workspace cannot install with duplicate package names); keep them in one PR |
