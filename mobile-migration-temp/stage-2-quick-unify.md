# Stage 2 — High-Pain / Low-Surface Unifications

## Objective

Eliminate the three smallest live forks (highest drift-pain-to-effort ratio) and single-source the
design layer. Each substage is an independent PR; all three may proceed in parallel.

## Preconditions

Stage 1 merged.

## The Canonical Unification Procedure ("three-step")

Used by 2b, 2c, and Stage 3a. Preserves Invariant I3 (desktop import specifiers unchanged):

1. **Reconcile.** Diff the desktop package against its mobile counterpart; graft mobile-only
   changes into the root (desktop-named) package. Both test suites green against the reconciled
   source.
2. **Repoint the mobile consumer.**
   - `apps/mobile/package.json`: replace the `@cherrystudio/mobile-<name>` dependency with
     `@cherrystudio/<name>: workspace:*`.
   - Revert the Stage 1b-4 rename within the mobile subtree:
     ```bash
     find apps/mobile -type f \( -name '*.ts*' -o -name '*.json' \) ! -path '*/node_modules/*' -print0 |
     xargs -0 perl -pi -e 's{\@cherrystudio/mobile-<name>}{\@cherrystudio/<name>}g'
     ```
   - Audit `apps/mobile/tsconfig.json#paths`, Babel config, and Metro `resolver` for aliases
     pointing at the local package directory; repoint to the root package.
3. **Delete the mobile copy.** `git rm -r apps/mobile/packages/<name>`. The root package's glob
   joins `SHARED_PURE_PACKAGES` (Stage 0d) if not already present.

---

## 2a. Design layer single-sourcing

### design-tokens promotion

**Current state.** `apps/mobile/packages/design-tokens/` (1,010 lines) maintains a token set
synchronized *manually* against desktop's `DESIGN.md`/theme sources via
`scripts/sync-desktop.ts` + `src/sync-manifest.json`. Both applications speak Tailwind v4
(desktop: `tailwindcss`; mobile: `uniwind`), so a single token source is consumable by both.

**Procedure.**
1. `git mv apps/mobile/packages/design-tokens packages/design-tokens`.
   No workspace-manifest change needed (`packages/*` glob covers it); the package name
   `@cherrystudio/design-tokens` is collision-free, so mobile consumers are untouched.
2. Append the package glob to `SHARED_PURE_PACKAGES`.
3. **Desktop adoption (separate follow-up PR).** Locate the desktop theme source of truth
   (`pnpm styles:canonical`, `DESIGN.md`), replace literal token values with imports from
   `@cherrystudio/design-tokens`.
4. On completion of (3): delete `packages/design-tokens/scripts/sync-desktop.ts` and
   `src/sync-manifest.json`; the `design-catalog` sync-manifest domain transitions to
   "shared package" status.

### Icon single-sourcing

Coordinate with the pre-existing `icons-static-webp-export` branch to avoid duplicated effort.

**Current state** (sync-manifest domain `design-catalog`, status `aligned` — i.e., manually kept
in lockstep):
- Desktop source of truth: `packages/ui/icons/`,
  `packages/ui/src/components/icons/{registry.ts,models/,providers/}`.
- Mobile mirrors: `apps/mobile/packages/ui/icons/`, `.../src/icons/`, `.../src/icons-webp/`,
  plus `apps/mobile/packages/app-icons/` (1,322 lines).

**Procedure.** Create `packages/icon-source/` holding SVG sources + registry data with a build
emitting two artifact sets: TSX components (web, consumed by `@cherrystudio/ui`) and WebP
(React Native, consumed by `ui-native`/`app-icons`). Repoint mobile's `ui:icons:generate*` scripts
(`apps/mobile/package.json`) at icon-source artifacts. `app-icons` either becomes a thin RN
wrapper or is absorbed into icon-source's artifact tree (decide against its actual contents at
execution time).

---

## 2b. `ai-sdk-provider` unification

**Measured divergence:** 1 of 4 source files, 14 lines, under the identical published version
`0.1.6` — i.e., npm identity `@cherrystudio/ai-sdk-provider@0.1.6` currently denotes two different
artifacts depending on which repository built it. Unification resolves this integrity defect.

Apply the three-step procedure with `<name> = ai-sdk-provider`. Reconciliation step: ⟳ re-diff to
confirm direction of the 14-line delta before grafting.

**Verification.**
```
pnpm --filter @cherrystudio/ai-sdk-provider build && pnpm --filter @cherrystudio/ai-sdk-provider test
pnpm test:aicore                                # desktop downstream consumer
pnpm --filter cherry-studio-app typecheck && pnpm --filter cherry-studio-app test
```
Mobile's `test:ai-sdk-provider` script: repoint at the root package or delete.
Changeset: patch bump (dual-artifact ambiguity eliminated).

---

## 2c. `ai-core` unification

**Measured divergence:** 13 of 75 files, 321 lines, plus structural asymmetries — under identical
published version `2.0.1`.

Apply the three-step procedure with `<name> = ai-core`. Reconciliation inventory (⟳):

| Divergence | Resolution |
|---|---|
| 13 content-divergent files: `core/agents/createAgent.ts`, `core/providers/core/ProviderExtension.ts`, `core/providers/core/initialization.ts`, `core/providers/types/index.ts`, `core/plugins/built-in/index.ts`, `core/runtime/{executor,index,pluginEngine}.ts`, `src/index.ts`, + 4 test files | File-by-file merge; desktop is the baseline; graft mobile-only capabilities |
| Mobile-only: `core/plugins/built-in/webSearchPlugin/` | Absorb into the root package (platform-pure plugin) |
| Desktop-only: `core/context/`, `core/plugins/built-in/__tests__/`, `core/runtime/__tests__/resolveLanguageModel.test.ts` | Retain |

Note: the desktop root `typecheck` script already invokes
`pnpm --filter @cherrystudio/ai-core typecheck`; the package name is unchanged, so root scripts
need no modification. Repoint mobile's `test:ai-core` script.

**Verification.** `pnpm test:aicore && pnpm build:check`; mobile `typecheck` + `test`.
Changeset: minor bump (webSearchPlugin is additive capability).

---

## Exit Criterion

```
grep -r "@cherrystudio/mobile-ai" apps/mobile --include='*.ts*' | wc -l   # → 0
```
(Only `mobile-provider-registry` remains, owned by Stage 3a.)
