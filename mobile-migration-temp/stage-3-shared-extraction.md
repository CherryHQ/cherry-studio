# Stage 3 — provider-registry Reconciliation + `src/shared` Strangler Extraction

## Objective

3a: reconcile the largest package-level fork (`provider-registry`, 11,107-line divergence).
3b: dissolve the `src/shared` ↔ `packages/universal` duplication into domain-named shared packages
using the strangler-fig pattern, preserving all 1,989 desktop `@shared/*` import sites unmodified.

## Preconditions

Stage 1. 3a and 3b are independent; within 3b, each domain is an independent PR, ordered
smallest-first.

---

## 3a. `provider-registry` unification

**Measured divergence:** 161 of 167 files, 11,107 lines, under the identical published version
`0.0.1-alpha.1` — the most drifted mirror pair in the repository.

**Timebox policy:** this reconciliation is the largest in the playbook. If it stalls, retain the
`mobile-provider-registry` fork and proceed; **no later stage depends on 3a** (Stage 5 Track A
consumes whichever registry the mobile side declares).

**Reconciliation strategy** (the package is data-driven: model/provider catalog data + pattern
matchers + generators; desktop additionally participates in a remote-override update pipeline):

1. **Generators and schemas first** (`src/` excluding catalog data): the code-level divergence is
   the small fraction; unify it before touching data.
2. **Catalog data second** (models/providers): the bulk of the 11k lines. Reconcile per-provider;
   desktop is the baseline (its data feeds the remote-override + CI update pipeline); graft
   mobile-only providers/models.
3. Adjudicate the 6 desktop-only and 3 mobile-only files (⟳
   `diff -rq packages/provider-registry/src apps/mobile/packages/provider-registry/src`).
4. Finish with the three-step procedure (Stage 2), `<name> = provider-registry`.

**Purity note:** the `@cherrystudio/provider-registry/node` subpath (`src/registry-loader/`) is
Node-side by contract and excluded from the purity allowlist (Stage 0d). Mobile must not import it;
the lint guard turns any violation into a CI failure rather than a runtime crash.

**Verification.** `pnpm test:provider-registry`,
`pnpm --filter @cherrystudio/provider-registry generate:check`, mobile `typecheck` + `test`.

---

## 3b. `src/shared` domain-by-domain extraction

### Mechanism (identical for every domain)

1. `git mv` the desktop files into the new package: `packages/<domain>/src/`.
2. **Leave a re-export shim at every original module path**, e.g. `src/shared/utils/url.ts`
   becomes the single line `export * from '@cherrystudio/url-safety'`. Consequences:
   - All desktop `@shared/*` import sites (1,989 files) remain valid — zero desktop churn,
     zero merge conflicts against in-flight branches (a shim is an ordinary TS file; concurrent
     edits to the *moved* file surface as regular content conflicts on the package file, not as
     tree conflicts).
   - Type identity is preserved (re-export, not re-declaration).
   - `export *` does not forward a default export. Audit every moved module and add
     `export { default } from '@cherrystudio/<package>'` to its shim when the original module has a
     default export.
3. Mirror on mobile: the corresponding `apps/mobile/packages/universal/src/` module becomes a shim
   (or is repointed directly — mobile branch pressure is low).
4. Append the new package glob to `SHARED_PURE_PACKAGES`.
5. The new `package.json` declares its actual npm dependencies — a subset of `src/shared`'s
   measured dependency surface: `zod`, `es-toolkit`, `semver`, `ai`, `@modelcontextprotocol/sdk`,
   `@anthropic-ai/claude-agent-sdk`, `@cherrystudio/openai`, `@mcp-trace/trace-core`,
   `builder-util-runtime`, `selection-hook` (take per-domain what is actually imported).
6. Test placement: extend the `shared` vitest project's `include` globs to the new package, or
   give the package its own vitest project — follow whichever the first extraction PR establishes.

**Shim amortization policy:** shims are not removed by dedicated PRs. Feature branches touching a
shimmed module inline the direct import opportunistically. Progress metric:
`grep -rl "export \* from '@cherrystudio/" src/shared | wc -l` → 0, then delete emptied
directories.

### Domain inventory and order (smallest first; proven intersection first)

The proven intersection is mobile's `universal/src/utils/` — 7 files that the mobile team already
re-implemented. Extraction starts there, not from the desktop superset.

**Wave 1 — micro-domains**

| New package | Desktop sources (`src/shared/utils/`) | Mobile sources (`universal/src/utils/`) |
|---|---|---|
| `packages/url-safety` | `url.ts`, `dataUrl.ts` (+ `__tests__`) | `url.ts` |
| `packages/text-processing` | `text.ts`, `keywordSearch.ts`, `conversationTitle.ts` | same three + `fnv1a.ts` (mobile-only; absorb) |
| `packages/serialization` | `serializable.ts`, `serialize.ts`, `redaction.ts` | `types/serializable.ts` |

Adjacent files `model.ts`, `provider.ts`, `providerTopology.ts`, `systemProviderId.ts`,
`shortcut.ts`: **merge into `provider-registry`** (their content domain) or defer — do not mint
packages for them.

**Wave 2 — `packages/ai-primitives`**

Desktop `src/shared/ai/` (24 entries) vs mobile `universal/src/ai/` (9 entries); measured drift
2,721 lines. Extract the intersection only (⟳ re-verify): `agentSessionCompaction.ts`,
`anthropicCache.ts`, `builtinTools.ts`, `generateImageTool.ts`, `paintingGenerateError.ts`,
`prompts.ts`, `reasoning.ts`, `tools/`, `transport/`.

This package is only the measured intersection of platform-pure AI primitives; the name describes
that content rather than claiming a broader protocol boundary. The Agent protocol tracked by
[#18802](https://github.com/CherryHQ/cherry-studio/issues/18802) is a separate architecture
initiative, not a deliverable or prerequisite of this migration, and may proceed independently at
any stage.

Desktop-only remainder stays in `src/shared/ai/` (`agentSession*` ×5, `claudecode/`, `dsh*`,
`pi*`, `builtinAgent.ts`, `compaction.ts`, `slashCommands.ts`, …). Individual files graduate when
mobile ships the corresponding feature; this extraction does not wait for #18802, and #18802 does
not wait for this extraction.

**Wave 3 — `packages/data-contract`** (largest: desktop `src/shared/data/` ≈20k lines; measured
drift 13,867 lines)

**Mandatory pre-measurement:** the divergence is a *bidirectional* fork — 43 desktop-only and 13
mobile-only files. Classify each as (a) lag (one side trails; absorb directly) or (b) design fork
(requires a jointly designed API before extraction). The classification outcome determines whether
Wave 3 is a two-week or a one-quarter effort; do not begin moving files before it exists.

Extraction scope: `src/shared/data/{api,cache,preference,presets,types}` ∩
`universal/src/data/{api,cache,preference,presets,types}`.

Explicitly **excluded** from extraction:
- `src/shared/data/bootConfig/` — desktop BootConfig subsystem only.
- `src/shared/data/migration/` — v1→v2 migrator types, desktop-only.
- Codegen caveat: `src/shared/data/preference/preferenceSchemas.ts` is a **generated artifact**
  (data-classify toolchain; never hand-edited). Moving it requires updating the generator output
  path in `v2-refactor-temp/tools/data-classify` within the same PR. Mobile's
  `mobilePreferenceSchemas.ts` remains application-local.

**Permanently excluded from all waves:** `src/shared/ipc/` (3,083 lines), `src/shared/IpcChannel.ts`,
`utils/window.ts`, `utils/command/` — desktop main↔renderer IPC contracts; mobile has no IPC.
`src/shared` is not coextensive with "shareable".

### `universal` dissolution endpoint

After Waves 1–3, `apps/mobile/packages/universal/` consists of shims plus mobile-only residue.
Relocate residue into the mobile app tree, delete the husk, retire the name
`@cherrystudio/universal`.

## Verification (per-domain PR)

```
pnpm build:check && pnpm test:shared && pnpm test        # desktop: shims keep everything green
pnpm --filter cherry-studio-app typecheck && pnpm --filter cherry-studio-app test
```
