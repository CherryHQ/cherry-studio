# Mobile → Monorepo Incremental Migration Playbook

Absorb the `cherry-studio-app` repository (mobile client, ref `origin/v0.2`, 1,978 commits) into this
repository as a fully co-located application, then incrementally eliminate the duplicated business
logic currently tracked by `desktop-sync-manifest.json` (13 sync domains: 7 `unbaselined`,
1 `blocked`, 5 `aligned`-but-manually-synchronized).

This directory is the execution runbook. Every document is file-precise and independently
executable. The directory is deleted when the exit criteria in
[stage-6-finish.md](stage-6-finish.md) are met.

## Prime Directive: Zero Disruption to Desktop Development

The desktop repository has ~110 active worktrees/branches at time of writing. Every stage MUST
preserve the following invariants:

| # | Invariant | Mechanism |
|---|---|---|
| I1 | Desktop source tree (`src/`) is not relocated or renamed before Stage 6 | Asymmetric layout: mobile lands under `apps/mobile/`; desktop remains at repository root |
| I2 | Desktop import specifiers never change en masse | Strangler-fig re-export shims at original module paths; measured blast radius: 1,989 desktop files import `@shared/*` — all remain valid |
| I3 | Package name collisions are resolved on the mobile side only | Desktop retains canonical names (`@cherrystudio/ai-core`, …); mobile adopts prefixed names, then converges back when unified |
| I4 | Every stage lands on `main` as a conventional PR passing the full desktop gate | No long-lived migration branch; merge gate = `pnpm build:check && pnpm test && pnpm test:lint` |
| I5 | The whole landing is atomically revertible | Stage 1 is one subtree-landing merge PR (`git revert -m 1`) plus one wiring PR |
| I6 | Desktop root relocation (`src/` → `apps/desktop/`) is explicitly deferred | Trigger-based (Stage 6), not scheduled; symmetry is an aesthetic property, not a functional dependency |

## Target Topology

```
cherry-studio/
├── apps/
│   └── mobile/                  # Entire mobile application (Expo/React Native)
│       ├── src/                 # {app, backend, bootstrap, frontend, shared}
│       ├── packages/            # Mobile-only workspace packages (ui-native, ui-nitro, mobile-*)
│       ├── modules/             # Expo native modules (pdf-text-extractor)
│       ├── migrations/          # Mobile SQLite migration chain (disjoint from desktop's; never merged)
│       ├── metro.config.js, app.json, eas.json, babel.config.js
│       └── package.json         # Expo application manifest
├── packages/                    # Shared tier + legacy desktop-only packages (transitional co-location)
├── src/, migrations/, electron.vite.config.ts, …   # Desktop, untouched until Stage 6
├── pnpm-workspace.yaml          # Single workspace definition
└── pnpm-lock.yaml               # Single lockfile
```

### Directory Position Encodes Sharing Tier (lint-enforced, see Stage 0)

| Location | Semantics | Banned imports |
|---|---|---|
| `packages/*` (shared-tier members) | Consumed by both applications; platform-pure | `electron`, `expo-*`, `react-native*`, `node:*`, bare Node builtins |
| `apps/mobile/packages/*` | Mobile-only | `electron`, `node:*` |
| Desktop-only packages (transitional, co-located in `packages/`) | Desktop-only | `expo-*`, `react-native*` |

### Package Naming Policy

- Package names describe **content domain** (`url-safety`, `data-contract`, `lifecycle-kernel`),
  never the consumer set. Banned name tokens: `universal`, `shared`, `common`, `core`, `utils`.
- A `mobile-` name prefix is a **unification debt marker**, removed when the corresponding
  package pair is reconciled. Progress metric:
  `grep -r "@cherrystudio/mobile-" --include='*.ts*' apps/ | wc -l` → must reach 0.
- `ui-native` is a **permanent** name (genuine platform fork; see stage-5-track-d), not debt.

## Stage Graph

```
stage-0 (hygiene, guards) ──► stage-1 (landing)
                                  ├──► stage-2 (design-tokens/icons, ai-sdk-provider, ai-core)
                                  ├──► stage-3 (provider-registry, src/shared extraction)
                                  ├──► stage-4 (lifecycle-kernel, db-schema)
                                  └──► stage-5 Track B (service decomposition)

stage-2b/2c (+ stage-4a for Wave 2) ──► stage-5 Track A
stage-4a/4b ──► stage-5 Track C
stage-2a ──► stage-5 Track D
all migration tracks ──► stage-6 (trigger-based)
```

| Document | Scope | Independently pausable |
|---|---|---|
| [stage-0-hygiene.md](stage-0-hygiene.md) | Pre-existing violations, purity lint guards, shared-package conventions | Yes |
| [stage-1-landing.md](stage-1-landing.md) | Subtree merge, workspace wiring, patch reconciliation, CI split, dual green gates | Yes (atomically revertible) |
| [stage-2-quick-unify.md](stage-2-quick-unify.md) | design-tokens promotion, icon single-sourcing, `ai-sdk-provider` (14-line drift), `ai-core` (321-line drift) | Yes, per package |
| [stage-3-shared-extraction.md](stage-3-shared-extraction.md) | `provider-registry` reconciliation (11,107-line drift), `src/shared` domain-by-domain extraction | Yes, per domain |
| [stage-4-enablers.md](stage-4-enablers.md) | `lifecycle-kernel` extraction, shared DB schema definitions | Yes |
| [stage-5-track-a-ai-runtime.md](stage-5-track-a-ai-runtime.md) | AI runtime unification, 3 waves over 215 semantically-ported files | Yes, per wave |
| [stage-5-track-b-services.md](stage-5-track-b-services.md) | `src/main/services` decomposition via ports-and-adapters | Yes, per service |
| [stage-5-track-c-data-services.md](stage-5-track-c-data-services.md) | 30 same-name data services: business-rule layer extraction | Yes, per service |
| [stage-5-track-d-ui.md](stage-5-track-d-ui.md) | Cross-platform UI primitives with platform-forked implementations | Yes, per component |
| [stage-6-finish.md](stage-6-finish.md) | Desktop relocation, exit criteria, decommissioning ledger | Trigger-based |

**Stability invariant between stages:** at any pause point, the repository satisfies
*desktop unimpaired + mobile buildable + no regression of already-unified surfaces*.

## Measurement Provenance

All quantitative claims (diff line counts, coupling histograms, file inventories) were measured on
2026-08-18 against desktop `9754c9267e` (branch base of `mono-repo-full-migration`) × mobile
`3707410b` (`origin/v0.2` HEAD). Items marked ⟳ are staleness-sensitive and MUST be re-measured at
execution time. Key aggregate measurements:

| Domain pair | Divergence (lines) | Notes |
|---|---|---|
| `packages/ai-sdk-provider` (both) | 14 | 1 of 4 files differs; same published version `0.1.6` on both sides |
| `packages/aiCore` ↔ `packages/ai-core` | 321 | 13 of 75 files differ; same published version `2.0.1` |
| `packages/provider-registry` (both) | 11,107 | 161 of 167 files differ under identical version `0.0.1-alpha.1` |
| `src/shared/ai` ↔ `universal/src/ai` | 2,721 | 22 common-modified, 20 desktop-only, 5 mobile-only |
| `src/shared/data` ↔ `universal/src/data` | 13,867 | 80 common-modified, 43 desktop-only, 13 mobile-only (bidirectional fork) |
| `src/main/data/services` ↔ `backend/data/services` | n/a | 30 of 33 services re-implemented under identical class names |
| `src/main/core/lifecycle` ↔ `backend/core/lifecycle` | near-total textual rewrite, ~90% API-congruent | **Not covered by any sync-manifest domain** (untracked drift) |
| `src/main/ai` ↔ `ai-runtime` + `backend/ai` | 608-entry file-level map | 215 `semantic-port` / 317 `blocked` / 76 `explicit-exclusion` |
