# Data Model: Remove Knowledge & Files Features (Phase 02)

**Branch**: `002-remove-knowledge-files` | **Date**: 2026-03-04

---

## N/A — Removal Task

This phase introduces no new entities, schemas, or data structures. It is a pure deletion of existing features.

The entities being removed are:

| Entity | Location | Action |
|--------|----------|--------|
| KnowledgeBase | `src/renderer/src/store/knowledge.ts` | Deleted — Redux slice removed |
| KnowledgeItem | `src/renderer/src/store/knowledge.ts` | Deleted with slice |
| OcrState | `src/renderer/src/store/ocr.ts` | Deleted — Redux slice removed |
| PreprocessState | `src/renderer/src/store/preprocess.ts` | Deleted — Redux slice removed |
| KnowledgeBaseParams, KnowledgeSearchResult, etc. | `src/main/services/KnowledgeService.ts` | Deleted with service |

### Persisted State Migration

The only data concern is the persisted Redux store. Migration step `'202'` strips the `knowledge`, `ocr`, and `preprocess` keys on first launch after upgrade. No data migration is needed — these are purely UI/app-state slices with no user-visible data that needs to be preserved.

See `plan.md` for the exact migration implementation.
