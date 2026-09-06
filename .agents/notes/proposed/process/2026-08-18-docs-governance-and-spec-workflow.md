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

- **Lifecycle**: `proposed/` (an approved target whose implementation is incomplete) → `implemented/` (shipped, kept current with reality) or `rejected/` (explicitly declined by a human; kept while its rationale prevents a tempting mistake). The dsh `archived/` tier is deferred until volume warrants it.
- **Class**: `feature`, `bug-fix`, `simplification`, `architecture`, `process`, `testing`. There is deliberately no `refactor` class — `simplification` covers it, discriminated by "does observable behavior change?".
- **Format**: header block, `Problem`, lifecycle-specific decision sections, mandatory `Alternatives considered`, and actual `Verification` for implemented notes. Proposed acceptance criteria use contiguous `AC` IDs and observable results rather than implementation tasks.
- A decision is never edited into a different decision: supersede with a new note and cross-link.
- **Threshold**: every PR declares an Agent Note or explicit `N/A`, but a note is required only for a decision a maintainer may reasonably revisit. A simple bug fix that restores an existing contract uses `N/A`; a repair with durable failure, compatibility, concurrency, ownership, or alternative-selection rationale writes an implemented `bug-fix` note in the same PR.
- **Spec-first stack**: substantial feature, architecture, process, and simplification work begins with a bottom Spec PR. Its current head needs explicit human Approval before implementation branches stack above it; a material Spec edit requires re-approval. The final implementation layer rewrites the note as implemented and maps every AC to real evidence.
- **Rejection**: discussion and `CHANGES_REQUESTED` do not trigger rejection. Only an explicit human decision may move a Spec to `rejected/`; a low-value abandoned exploration is closed without merging repository noise.

The full rules live in `.agents/notes/README.md`; subtree `AGENTS.md` files load lifecycle instructions automatically, while `verify-agent-note-format` gates the machine-checkable skeleton.

### P5 — Bilingual pairing

Every in-scope document is an English/Chinese pair plus a consistency sidecar: `foo.md` + `foo.zh.md` + `foo.i18n.yaml` recording the git blob hash of each side as of the last confirmed-consistent state (a port of dsh's `verify-translation-pairing`). Either language may be authored first; an out-of-sync pair is repaired by patching the counterpart against the edited side's diff, never by re-translating whole files.

Scope rolls out by discovery root — a deliberate deviation from dsh's no-rollout-list stance: active `.agents/notes/**`, root `CONTRIBUTING.md`, and new `docs/i18n/**` governance first, extending to the audited documentation corpus only after the final translation backfill. `scripts/i18n-glossary.json` remains the machine terminology owner; `docs/i18n/terminology.md` is its generated bilingual agent view.

The routine gate checks hashes, switchers, Markdown structure, and Cherry frontmatter. A staged-index mode prevents partial commits. Merge drivers, snapshot refs, translation brief generation, and automated semantic translation remain deferred until a measured need exists.

### P6 — Skills

Four public skills make the policy operational: `agent-notes`, `docs-governance`, `translate-docs`, and `find-simplifications`. Root and subtree instructions route ordinary work into them without relying on memory.

One zero-dependency `change:scope` report owns base/head resolution and committed/staged/unstaged/untracked paths. `docs:affected`, PR creation, PR review, and post-stack validation consume it. The generated `docs/sources-index.json` maps source prefixes to candidate docs; `gh-pr-review` treats matches as mandatory semantic inspection, never as an automatic CI failure.

### Rollout

| Phase | Work | Verification |
|---|---|---|
| 0a (this PR) | This proposal; `.agents/notes/` skeleton with stub README | Review of this note is the decision |
| 0b | Per-domain move + audit PRs: relocate, rename, fact-check every claim against code, rewrite or delete. **The gates land last, after the final move**, together with the frontmatter for the whole corpus — `verify-doc-structure` reads the entire `references/` root and `verify-doc-frontmatter` every reference doc, so neither can be green while the tree is half-migrated, and a staged-enforcement allowlist would be more machinery than the short migration is worth | `docs:check-links` green per move PR; full `pnpm docs:check` green once the gates land; moved docs' claims verified against `src/` |
| 1 | Full Agent Note rules, lifecycle instructions, AC/Verification format, and format gate | Format gate green on all notes |
| 2 | Pairing + staged guard, documentation governance, change scope, sources review, PR template, and four public process skills | `pnpm docs:check`, focused script tests, and `pnpm skills:check` green |
| 3 | Final translation backfill of audited-current docs; expand pairing roots and localized generated navigation | Corpus-wide pairing green |

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

- AC1 — `references/` is a closed domain tree whose surviving claims were audited against current code. (verification: docs gate)
- AC2 — Reference and contrib frontmatter drives generated human and source-prefix indexes without hand-maintained drift. (verification: script tests + docs gate)
- AC3 — Agent Notes enforce lifecycle-specific format, observable AC IDs, actual verification, explicit rejection, and supersession rules. (verification: script tests + docs gate)
- AC4 — Active notes, `CONTRIBUTING`, and documentation-governance prose pass complete bilingual pairing in both worktree and staged-index modes. (verification: pairing tests + docs gate + pre-commit hook)
- AC5 — One explicit change-scope report feeds affected-doc review, PR creation/review, and stack revalidation without guessing a base. (verification: script tests + skill review)
- AC6 — PR templates and review workflows carry Agent Note/N/A, Spec approval, covered AC IDs, actual Verification, and implemented-note reality. (verification: skill and template review)
- AC7 — Phase 3 can expand discovery roots and translate the audited corpus without replacing Phase 2's pairing, terminology, or workflow architecture. (verification: docs gate)

## Risks

- **Inbound-link churn.** `docs:check-links` only resolves Markdown links, so it sees none of the other consumers: `CLAUDE.md` prose, lint rule messages in `eslint.config.mjs`, TypeScript comments, and code that *reads a doc by path* — `scripts/uiContract/__tests__/maintainedAnchors.test.ts` opens `ui-semantic-contract.md`, and a missed rename there breaks a test, not a link. Every Phase 0b move therefore greps the **whole repository** for the old path (`src/`, `scripts/`, `packages/`, `tests/`, `.github/`, root config), never just `src/`. Mitigation: moves are atomic per domain (relocate + fix every inbound reference in one PR).
- **Collision with in-flight PRs.** Tree moves conflict with open work touching the same docs. Mitigation: Phase 0b proceeds domain by domain in small windows, not as one big-bang move.
- **Bilingual maintenance cost.** Every paired-doc edit obligates the counterpart and a re-record; churn-heavy docs pay the most. Accepted deliberately — docs are a product here — and bounded by pairing only audited-current material.
- **Translation review burden.** The pairing gate checks structure, not faithfulness; zh quality still needs reviewer attention, and terminology starts thin.
