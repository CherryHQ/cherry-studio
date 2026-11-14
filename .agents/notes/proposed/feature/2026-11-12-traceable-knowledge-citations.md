# Agent Note: Traceable knowledge-base citations

Status: proposed

English | [中文](2026-11-12-traceable-knowledge-citations.zh.md)

## Problem

Knowledge-base citations in chat answers cannot be traced back to their evidence. Verified against the current branch:

- `kb_search` output (`kbSearchOutputItemSchema` in `src/shared/ai/builtinTools.ts`) carries no page number or character offset, so a citation has no location.
- `kb_read` returns `charStart` and `charEnd`, but `parseKbReadCitation` in `src/renderer/utils/message/citations.ts` drops them.
- `KnowledgeCitationCard` in `src/renderer/components/chat/citations/KnowledgeCitation.tsx` renders a non-clickable `<span>`. It shows only the document basename and the snippet.
- Citation ids are per-call random-prefixed strings, so they do not identify a source chunk. A reindex cannot preserve them.
- No "unavailable" state exists. A missing source and an unknown citation id both render the same way.

## Proposal

Scope the first delivery to PDF citations, matching the issue's primary verification case. Text-like sources keep a character range but do not get a viewer highlight in this change.

- **Location at indexing.** Persist, per chunk, the source page for PDFs and the character range for other types. Expose both through `kb_search` and `kb_read` outputs as optional fields, so results persisted before this change still parse.
- **Citation model.** Carry `page`, `charStart`, and `charEnd` on the renderer `Citation` built in `src/renderer/utils/message/citations.ts`, and stop dropping them in `parseKbReadCitation`.
- **Stable identity.** Derive a citation id from `baseId`, `conceptId`, and a chunk content hash, rather than the per-call random prefix. Reindexing unchanged content keeps its id, so citations in earlier messages still resolve.
- **Open and highlight.** Make `KnowledgeCitationCard` clickable for PDF citations. Open the source at the referenced page and highlight the excerpt text.
- **Availability.** Before opening, probe the source with `probeKnowledgeSourcePath` (`src/main/features/knowledge/pathStorage.ts`). Show "unavailable" when the source is gone, and "invalid" when the id does not resolve. The two states must differ.

## Alternatives considered

- **Show location only, no viewer.** Smaller, but does not meet "click a PDF citation opens the viewer" in the issue.
- **Keep the per-call id and remap on reindex by content match.** Avoids a new id scheme, but remapping is heuristic and fails when chunk boundaries move on reindex.
- **Store a snapshot of the excerpt in the message and skip the source probe.** Keeps the answer readable after removal, but the issue requires the answer to mark the citation unavailable rather than show stale content.

## Acceptance criteria

- AC1 — A knowledge citation shows the file basename and its location (page for PDFs, character range otherwise). (verification: unit + renderer)
- AC2 — Clicking a PDF citation opens the source at the referenced page with the excerpt highlighted. (verification: Electron)
- AC3 — Reindexing a document with unchanged chunk content keeps existing citation ids, and citations in earlier messages still resolve. (verification: unit)
- AC4 — A citation whose source file was removed renders as "unavailable" and does not open any content. (verification: unit + renderer)
- AC5 — A citation id that does not resolve renders as "invalid", distinct from "unavailable". (verification: unit + renderer)
- AC6 — Citation results persisted before this change still parse and render with no location. (verification: unit)

## Risks

- **Page extraction is unverified.** Whether the current PDF extraction pipeline exposes page boundaries is not confirmed. If it does not, AC2 needs a parser change that may be larger than this spec assumes.
- **Chunk hashing cost.** Content-hash ids add work at index time. Measure on a large base before committing.
- **Migration of persisted results.** Old results have no `page` or stable id. AC6 covers parsing; no backfill is proposed.
- **Open question: non-PDF viewer.** Whether character-range highlighting for Markdown and text sources ships in this change or a follow-up needs a decision.
