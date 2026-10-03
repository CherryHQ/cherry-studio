---
description: Faithfulness, terminology, structure, and minimal-update rules for English and Simplified Chinese documentation
---

# Documentation Translation Rules

English | [中文](translation-rules.zh.md)

Translate as a technical author, not word by word. Preserve every actor, condition, timing rule, modality, negative guarantee, exception, side effect, failure mode, and consequence without adding new claims.

## Sources of truth

- Use generated [terminology](terminology.md) before translating; do not invent a local rendering for a governed term.
- Verify technical claims against current code and the owning reference. Translation does not repair an inaccurate source silently.
- Treat either language as the authored side for a given update. The unchanged side has no permanent precedence.

## Structure

- Preserve heading depth/order, list kind/start/count, table dimensions, link targets, and code fences.
- Keep code spans, paths, identifiers, commands, interpolation tokens, and protocol values unchanged.
- Translate link labels when natural, but keep normal relative targets on the English `.md` path.
- Preserve frontmatter `sources` exactly. Translate only fields whose contract explicitly allows localization, currently `description`.

## Update existing pairs

Identify which side changed by comparing current blobs with the sidecar. Patch the counterpart at the smallest semantic unit that covers the diff. Preserve all reviewed wording outside that unit. If both sides changed or the recorded blob is unavailable, reconcile the complete affected section manually rather than guessing direction.

After comparison, read the translated passage alone and remove awkward source-language syntax. Then compare clause by clause, re-record the pair, and run the scoped check.

## Create new pairs

Translate section by section while keeping structure locked. For large domain backfills, workers receive disjoint files; the integrating agent owns terminology, links, generated artifacts, sidecars, and the corpus-wide gate.

## Review boundary

Automation cannot judge semantic equivalence. Reviewers reject dropped conditions, added promises, softened MUST/never language, incorrect terminology, translated identifiers, and natural-sounding prose that changes the contract.
