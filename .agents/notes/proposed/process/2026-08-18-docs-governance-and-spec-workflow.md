# Agent Note: Docs governance and spec-driven workflow

Status: proposed

English | [中文](2026-08-18-docs-governance-and-spec-workflow.zh.md)

## Problem

The repository's developer documentation has four connected defects, and no mechanism catches any of them.

**Docs rot silently.** `docs/guides/middleware.md` teaches the deleted v1 `AiProviderMiddlewareTypes` middleware system (zero hits in `src/`). `docs/references/messaging/message-system.md` documents a Redux + IndexedDB message store that no longer exists: the repo has no `@reduxjs/toolkit` dependency, no `messageThunk.ts`, no `src/renderer/store/`. Both read as current authority to contributors and agents. The only doc gate, `docs:check-links`, validates that link targets exist — nothing more — and CI never runs it: `ci:basic-check` covers lint, format, typecheck, i18n, and skills, not docs.

**The hierarchy misleads.** The `guides/` vs `references/` split does not hold: `guides/` mostly holds process policy (contributing, branching-strategy, test-plan) and usage references (logging, i18n, diagnostics), not tutorials. The `references/` top level is an open set mixing 17 domain directories with 10 loose files. The docs split one domain into `chat/` and `messaging/` where the code has only chat. `docs/README.md` is a hand-maintained index that has already drifted: `main-process-architecture.md`, `renderer-architecture.md`, `shared-layer-architecture.md`, and `naming-conventions.md` are not listed at all, and `chat/message-tree.md` is listed under the Messaging section. Root `CONTRIBUTING.md` has a drifted near-copy at `docs/guides/contributing.md` whose "中文" language switcher links to itself — the Chinese version does not exist.

**Decisions evaporate.** Rationale and rejected alternatives live only in PR threads and chat. With multiple agents working in parallel, the same declined idea gets re-proposed and re-litigated because nothing records that it lost, or why.

**Docs are a product with a missing half.** A large share of Cherry Studio's users and contributors read Chinese, yet the corpus is ~110 English markdown files with one Chinese pair (`.agents/skills/README.zh.md`).

## Proposal

Adopt the deepseek-harness (dsh) documentation and decision-record process, adapted where explicitly stated. Six parts, then a rollout plan.

### P1 — Target tree

```
docs/
  README.md            # thin index generated from frontmatter descriptions; never hand-edited
  contrib/             # process & repo engineering: contributing pointers, branching-strategy,
                       # development, linux-packaging, test-plan, feishu-notify, app-upgrade
  references/
    architecture/      # architecture-overview, main-process-architecture,
                       # renderer-architecture, shared-layer-architecture, naming-conventions
    <domain>/          # closed set; every domain directory has README.md as the domain home
.agents/notes/         # Agent Notes (decision records) — see P4
```

Rules:

- The `references/` top level is a **closed set** of domain directories — no loose files (gate-enforced, mirroring the closed-set rule the code tree already has in naming-conventions §4.8).
- Every domain directory has a `README.md` that owns the domain: full detail about its own subject, children summarized with links. One fact, one home.
- Files inside a domain directory do not repeat the domain prefix (`window-manager-usage.md` → `usage.md`); existing prefixed files are renamed during their domain's Phase 0b move, when inbound links are being rewritten anyway. **Superseded for Phase 0b:** the [implemented audit outcomes](../../implemented/process/2026-08-19-phase-0b-doc-audit-outcomes.md) preserve existing basenames unless a move or ambiguity requires a rename.
- Division of labor with code-adjacent READMEs (`src/main/core/paths/README.md`, `tests/__mocks__/README.md`, …): cross-cutting or multi-module material lives in `docs/`; module-private facts live next to the module.
- `docs/README.md` becomes a generated thin index; the hand-maintained table is retired.

Disposition of current files (decided here; executed in Phase 0b):

| File | Disposition |
|---|---|
| `references/messaging/message-system.md` | **Delete** — documents a deleted system. |
| `guides/middleware.md` | **Delete** — documents a deleted system; current middleware facts belong to the `src/main/ai` domain docs. |
| `guides/contributing.md` | **Delete** — drifted copy of root `CONTRIBUTING.md`, which becomes the single home (GitHub-special file); its stale "Branch Strategy 🚨" residue is cleaned there. Chinese arrives in Phase 2 as root `CONTRIBUTING.zh.md`. |
| `references/messaging/composer-rich-clipboard.md` | Move → `references/chat/` (its cited code lives entirely under `components/chat/**` and `components/composer/**`). |
| `references/fuzzy-search.md` | Move → `references/file/`. |
| `references/ui-semantic-contract.md` | Move → `references/components/`. |
| `references/lan-transfer-protocol.md` | Move → `references/lan-transfer/` (a protocol spec is its own domain). |
| `references/{architecture-overview,main-process-architecture,renderer-architecture,shared-layer-architecture,naming-conventions}.md` | Move → `references/architecture/`. |
| `guides/{logging,i18n}.md` | Move → their subject domains under `references/`. |
| `guides/diagnostics.md` | Placement (contrib vs reference) decided during its Phase 0b audit. |
| `docs/sponsor.md` | **Stays at the `docs/` root** — a user-facing page linked from the root README, not a developer doc; outside the reference tree, the gates, and bilingual pairing. |
| `references/chat/{adapters,conventions}.md` | **Keep in place** — explicitly marked target-architecture design docs; their home is re-decided when the adapters code lands. Out of Phase 0b scope. **Superseded by the [implemented audit outcomes](../../implemented/process/2026-08-19-phase-0b-doc-audit-outcomes.md).** |
| `references/file/architecture.md` + `file-manager-architecture.md` | **Keep both** — deliberately layered with mutual SoT-scope declarations, not rot. |

### P2 — Frontmatter

Every doc under `docs/references/**` carries:

```yaml
---
description: One-line summary (feeds the generated index and agent doc catalogs)
sources: # code paths this document describes; directories preferred
  - src/main/services/file/tree/
---
```

`docs/contrib/**` requires only `description`. Agent Notes carry **no frontmatter** — their path and header block already encode their metadata, as in dsh. `docs/sponsor.md` is a user-facing page linked from the root README, not a developer doc: it stays at the `docs/` root and is outside every gate's scan scope (which covers `references/` and `contrib/` only) and outside bilingual pairing.

A `sources` entry is a **path prefix**: a diff path is attributed to a doc when it equals the entry or lies beneath it, so a directory entry covers all its descendants. That is what makes the Phase 4 reverse lookup work on subtree changes; it is also why a broad entry weakens the signal, and why an entry names the narrowest directory that still holds the doc's whole subject.

The admission criterion for any future field: it must carry something the path, the H1, or git cannot, **and** name the script that consumes it. Rejected now, each because an owner already exists: `domain`/`category` (the path), `title` (the H1), `updated`/`author` (git), `status: deprecated` (deletion — current-state prose or nothing), `tags` (no consumer), `sidebar_position` (site navigation belongs in one mapping file, dsh-style), and the translation-pairing hash (writing a file's hash into the file changes the hash — it must live in a sidecar).

### P3 — Gates

Three new scripts, all `tsx scripts/*.ts` following the repo's newer script convention (exported functions plus tests under `scripts/__tests__/`, like `i18n-check-values.ts`):

- `verify-doc-structure` — closed set at the `references/` root; every domain directory has a `README.md`.
- `verify-doc-frontmatter` — required fields present; every `sources` path exists. This catches one specific class of rot — the doc whose subject was deleted or moved away, which is exactly what `middleware.md` and `message-system.md` were — on the day the code moves. **It is an existence test, not a freshness test**: a doc that goes stale while its paths survive (behavior changed in place, or a file moved within a broad directory entry) stays green. Semantic staleness is caught by the Phase 4 reverse lookup and by review, not here.
- `gen-doc-index` (with `--check`) — regenerates `docs/README.md` from frontmatter; drift fails.

Wiring: a new aggregate `pnpm docs:check` = `docs:check-links` + the three above; it replaces the bare `docs:check-links` inside `build:check`. Closing the CI gap takes a **workflow** edit, not only a script edit: `.github/workflows/ci.yml` does not invoke `pnpm ci:basic-check` — its `basic-checks` job inlines the individual commands through `concurrently`, so `docs:check` must be added to that step to run in CI at all. The `ci:basic-check` script is updated alongside it to keep the local equivalent honest.

A follow-up consumer of `sources`: intersecting a PR's diff paths with all `sources` lists mechanically yields "docs this PR should have updated", wired into the `gh-pr-review` skill (Phase 4). That turns the "docs accompany every code change" rule from an honor system into a checkable one.

### P4 — Agent Notes

Decision records live in `.agents/notes/{lifecycle}/{class}/yyyy-mm-dd-topic.md`:

- **Lifecycle**: `proposed/` (reviewed before implementation) → `implemented/` (shipped, kept current with reality) or `rejected/` (declined; kept while the rationale prevents a tempting mistake). The dsh `archived/` tier is deferred until volume warrants it.
- **Class**: `feature`, `bug-fix`, `simplification`, `architecture`, `process`, `testing`. There is deliberately no `refactor` class — `simplification` covers it, discriminated by "does observable behavior change?".
- **Format**: header block (`# Agent Note: <title>`, `Status: <lifecycle>`), then `## Problem`, `## Proposal` (proposed) or `## Decision` (implemented, present tense), bespoke sections, a **mandatory `## Alternatives considered`**, then `## Acceptance criteria` + `## Risks` (proposed) or `## Consequences` (implemented). A decision recorded without what it beat invites re-litigation.
- A decision is never edited into a different decision: supersede with a new note and cross-link.
- **Threshold** (deliberate deviation from dsh, which requires a note for every non-trivial PR): a note is required only for **decisions a maintainer may reasonably revisit** — architectural choices, cross-module contracts, data/on-disk/wire formats, process changes, and declined approaches. Cherry Studio's routine-fix volume makes a per-PR mandate a tax, not a record.
- Spec-first features: substantial feature work starts as a `proposed/` note, reviewed before implementation, verified against its own acceptance criteria, then rewritten into `implemented/` when it ships. This note is the first instance of that loop.

The format gate (a port of dsh's `verify-agent-note-format`) lands in Phase 1 alongside the full `.agents/notes/README.md` ruleset.

### P5 — Bilingual pairing

Every in-scope document is an English/Chinese pair plus a consistency sidecar: `foo.md` + `foo.zh.md` + `foo.i18n.yaml` recording the git blob hash of each side as of the last confirmed-consistent state (a port of dsh's `verify-translation-pairing`). Either language may be authored first; an out-of-sync pair is repaired by patching the counterpart against the edited side's diff, never by re-translating whole files.

Scope rolls out by discovery root — a deliberate deviation from dsh's no-rollout-list stance: `.agents/notes/**` and root `CONTRIBUTING.md` first (new corpora are born bilingual), extending to `docs/**` only after the Phase 3 backfill. `docs/i18n/terminology.md` becomes the doc-translation terminology source, seeded from `scripts/i18n-glossary.json` (whose `terms` block is currently five entries and unenforced — it needs growth, but the vocabulary choices it records, e.g. Provider=提供商, Agent=智能体, carry over).

### P6 — Skills

Cherry versions of the dsh process skills, adapted to this repo's domains: a find-simplifications skill (turns "clean this up" into evidence-backed proposed notes; survey domains become renderer hooks, the four data layers, IPC, lifecycle services, v1-migration residue), a doc-standards/prose-standard skill (hierarchy detail rules, tutorial/reference classification, slop checklist), and the `gh-pr-review` reverse-lookup integration from P3.

### Rollout

| Phase | Work | Verification |
|---|---|---|
| 0a (this PR) | This proposal; `.agents/notes/` skeleton with stub README | Review of this note is the decision |
| 0b | Per-domain move + audit PRs: relocate, rename, fact-check every claim against code, rewrite or delete. **The gates land last, after the final move**, together with the frontmatter for the whole corpus — `verify-doc-structure` reads the entire `references/` root and `verify-doc-frontmatter` every reference doc, so neither can be green while the tree is half-migrated, and a staged-enforcement allowlist would be more machinery than the short migration is worth | `docs:check-links` green per move PR; full `pnpm docs:check` green once the gates land; moved docs' claims verified against `src/` |
| 1 | Full `.agents/notes/README.md` ruleset + format gate + backfilled seed notes (bilingual) | Format gate green on all notes |
| 2 | Pairing gate port; discovery roots `.agents/notes` + `CONTRIBUTING.md`; `CONTRIBUTING.zh.md` | `verify-translation-pairing` green |
| 3 | Translation backfill of audited-current docs only; extend pairing scope to `docs/**` | Corpus-wide pairing green |
| 4 | Process skills + `gh-pr-review` sources integration | Skill review |

Quality precedes translation throughout: a doc is audited current before it is paired, because translating rot bakes it into two languages at double the correction cost.

## Alternatives considered

- **Frontmatter-free, path-only metadata (the dsh design).** dsh encodes everything in paths and headers and its docs carry no frontmatter. Rejected here because our two acute needs — a rot gate (`sources`) and a drift-proof generated index (`description`) — both need per-file machine-readable fields; dsh instead covers these with word budgets, `verify-doc-refs`, and hand-curated hierarchy, machinery we are not porting wholesale.
- **Marking stale docs `status: deprecated`.** Rejected: current-state prose or deletion. A deprecation marker is a license to keep rot.
- **Translate first, audit later.** Rejected: every later correction costs two languages plus a pairing re-record.
- **Keeping the `guides/` vs `references/` split.** Rejected: the classification is already fiction; use-based classification (tutorial = ordered steps to an observable outcome) shows almost everything here is reference or process material.
- **Porting dsh's full translation machinery now** (merge driver, `gen-translation-brief`, doc budgets). Deferred: dsh itself marks the heavy paths as explicit-invocation-only; routine one-pass counterpart updates suffice until sync conflicts become a real cost.
- **dsh's per-PR note mandate.** Amended to the decision threshold in P4; the fix volume here would turn the mandate into ritual.
- **Building the website projection now.** Deferred: docs.cherry-ai.com lives in a separate repository; projection is a separate decision after the corpus is governed.

## Acceptance criteria

- `references/` top level is a closed set of domain directories, each with a README home; `verify-doc-structure` green.
- The three dead/duplicate docs are deleted; every surviving reference doc's claims verified against current code.
- Every `references/**` doc carries `description` + existing `sources`; `verify-doc-frontmatter` green.
- `docs/README.md` is generated; `gen-doc-index --check` green.
- CI runs `pnpm docs:check` — verified by the `basic-checks` job in `.github/workflows/ci.yml` invoking it, not merely by the `ci:basic-check` script listing it.
- `.agents/notes/` holds this note plus backfilled seeds, bilingual, format-gate green.
- `.agents/notes/**` and `CONTRIBUTING.md` pass the pairing gate; after Phase 3, `docs/**` does too.

## Risks

- **Inbound-link churn.** `docs:check-links` only resolves Markdown links, so it sees none of the other consumers: `CLAUDE.md` prose, lint rule messages in `eslint.config.mjs`, TypeScript comments, and code that *reads a doc by path* — `scripts/uiContract/__tests__/maintainedAnchors.test.ts` opens `ui-semantic-contract.md`, and a missed rename there breaks a test, not a link. Every Phase 0b move therefore greps the **whole repository** for the old path (`src/`, `scripts/`, `packages/`, `tests/`, `.github/`, root config), never just `src/`. Mitigation: moves are atomic per domain (relocate + fix every inbound reference in one PR).
- **Collision with in-flight PRs.** Tree moves conflict with open work touching the same docs. Mitigation: Phase 0b proceeds domain by domain in small windows, not as one big-bang move.
- **Bilingual maintenance cost.** Every paired-doc edit obligates the counterpart and a re-record; churn-heavy docs pay the most. Accepted deliberately — docs are a product here — and bounded by pairing only audited-current material.
- **Translation review burden.** The pairing gate checks structure, not faithfulness; zh quality still needs reviewer attention, and terminology starts thin.
