---
description: Bilingual documentation pairing contract, rollout scope, consistency records, and validation commands
---

# Bilingual Documentation

English | [中文](README.zh.md)

English and Simplified Chinese carry equal authority. A change may start in either language, but an in-scope document merges only as one complete pair whose current contents were reviewed together.

## Pairing contract

Each pair consists of three sibling files:

- `foo.md` — English.
- `foo.zh.md` — Simplified Chinese.
- `foo.i18n.yaml` — the Git blob hash of each side at the last confirmed-consistent state.

The sidecar is a consistency fingerprint, not proof of translation quality. After editing either side, patch only the affected counterpart prose, review the meaning, then explicitly re-record the pair. Rename or delete all three files together.

Normal documents place the canonical English/中文 sibling switcher immediately after the H1. Agent Notes place it after their fixed `Status:` header.

## Enforced structure

The gate checks:

- complete triplets and current blob hashes;
- canonical language switchers;
- equal heading depth/order, fenced code, table dimensions, list kind/start/count, and non-switcher link targets;
- matching frontmatter keys, exact non-description values, and a non-empty localized `description` on both sides.

Code fences remain byte-identical, including comments. Normal links keep the same `.md` target on both sides; only the language switcher targets `.zh.md`.

## Phase 2 scope

The discovery roots live in `scripts/translation-pairing.manifest.json` and initially cover:

- active Agent Notes and the Agent Notes README;
- root `CONTRIBUTING.md`;
- this documentation-governance directory.

`terminology.md` is generated as one bilingual table and is excluded from pairing. Agent instruction files are English-only. Phase 3 expands the roots only after audited reference and contrib translations exist.

## Commands

| Command | Purpose |
|---|---|
| `pnpm docs:check-pairing` | Check every current root. |
| `pnpm docs:check-pairing <pair...>` | Check named pairs during an update. |
| `pnpm docs:check-pairing --write <pair...>` | Record pairs that were semantically reviewed. |
| `pnpm docs:check-pairing --write --all` | Explicitly record every complete pair after a corpus operation. |
| `pnpm docs:check-pairing --list` | Report pair states without failing. |

The pre-commit hook runs `--cached` only for staged pair artifacts, preventing a sidecar from confirming unstaged content. `pnpm docs:check` and CI still run the complete worktree check.

## Failure model

`missing`, `invalid`, and `out-of-sync` are contract violations. A green gate establishes file completeness and structure only; reviewers remain responsible for technical accuracy, natural language, and semantic equivalence under [the translation rules](translation-rules.md).
