---
name: translate-docs
description: Use when explicitly asked to translate, backfill, reconcile, rename, or delete paired Cherry Studio repository documentation in English and Simplified Chinese, including Phase 3 domain-by-domain translation work.
---

# Translate Repository Documentation

Read [the pairing contract](../../../docs/i18n/README.md), [translation rules](../../../docs/i18n/translation-rules.md), generated [terminology](../../../docs/i18n/terminology.md), and `docs-governance` before translating.

## Triage

- Existing pair, one side changed: use the sidecar hashes to identify the authored side and patch the smallest affected counterpart unit.
- Both sides changed or the recorded blob is unavailable: reconcile the complete affected section manually.
- New pair: translate section by section while preserving structure.
- Rename/delete: move/delete English, Chinese, and sidecar together.

Do not silently repair inaccurate technical content during translation. Report the source defect or fix both languages against current code when the task authorizes it.

## Batch work

When the user requests a domain or corpus backfill, divide files into disjoint domain-owned sets. Translation workers read the complete rules and terminology, modify only assigned pairs, and return pending terms. The integrating agent resolves terminology in `scripts/i18n-glossary.json`, regenerates the terminology page and indexes, checks links/structure, records sidecars, and runs the corpus gate.

## Finish

Verify clauses, identifiers, code fences, lists, tables, links, frontmatter, and natural phrasing. Then run:

```sh
pnpm docs:check-pairing --write <pair>
pnpm docs:check-pairing <pair>
```

Run `pnpm docs:check` once at PR level. A green pairing gate does not prove semantic fidelity.
