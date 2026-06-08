# Agent 01 Original Session Audit

> 状态(2026-06-08): 本评审写于实现之前。部分"当前状态"描述已被 baseline + 顺手改动改变(详见 ../../../drift-report-2026-06-08.md)。本篇仍作为待执行计划的依据阅读。

Date: 2026-06-07

## 1. Conclusion

Conclusion: mostly faithful with minor issues.

The current handoff and knowledge design docs are faithful to the final decision trail in the original session. I found no material contradiction on the required topics: material id, FileEntry removal, MinerU output scope, current-v2 search shape, embedding contract, delete semantics, migration, or the current v2 vs v2.x boundary.

The main issues are not blockers:

- Some older product/reference docs describe the v2.x folder-first future, while the current-v2 plan intentionally defers those capabilities. Later agents must keep that boundary explicit.
- The session briefly explored `search_unit` without `material_id`, then later reversed to `search_unit.material_id`. The committed docs reflect the later decision correctly, but the historical trail can confuse reviewers.
- The handoff has minor document hygiene issues, including a duplicate "suggested questions" section number. This does not change technical meaning.

## 2. Codebase Survey

This agent's scope was session/docs audit only. No product code coverage was required beyond the referenced docs; Agents 02-09 are responsible for full project code survey and module-level call graph coverage.

Session/docs inspected:

- Original session record: `/Users/eeee/.codex/sessions/2026/06/06/rollout-2026-06-06T15-54-41-019e9bed-5052-7cd1-bafd-b54be98032a5.jsonl`
- `docs/references/knowledge/handoff-current-v2-knowledge-review-2026-06-06.md`
- `docs/references/knowledge/current-v2-knowledge-index-migration-plan.md`
- `docs/references/knowledge/index-sqlite-schema-design.md`
- `docs/references/knowledge/agent-managed-knowledge-product.md`
- `docs/references/knowledge/knowledge-ui-presentation-options.md`
- `docs/references/knowledge/knowledge-service.md`
- `docs/references/knowledge/operation-guards.md`
- `README.md` and `docs/README.md`; there is no local `README.md` under `docs/references/knowledge/`.

Commands used:

- `wc -l` and `ls -lh` on the JSONL: 2,727 lines, about 9.9 MB.
- `head` / `tail` on the JSONL to confirm structure.
- `jq -r 'select(.type=="event_msg" ...)' ... | rg ...` to extract decision-bearing user/agent messages.
- `jq -r 'select(.type=="response_item" ...)' ... | rg ...` to cross-check assistant messages.
- `sed -n` over extracted line ranges, especially session decision ranges around material identity, schema design, search, migration, and final current-v2 plan.
- `rg -n "material|FileEntry|MinerU|snippet|search result|embedding|delete|migration|v2\\.x|replaceByExternalId|processedFileEntryId|sourceFileEntryId|file_ref|deleteItemChunk|SaveToKnowledge|KnowledgeBase/\\{baseId\\}"` across the scoped docs and session extracts.
- Targeted `rg` for `search_unit.material_id` / `search_unit` binding to verify the earlier no-`material_id` idea was later superseded.

No product source files under `src/`, `packages/`, `migrations/`, or `tests/` were read for this report. That was intentional for Agent 01; the handoff requires Agents 02-09 to perform the full project code survey.

## 3. Confirmed Decisions Represented Correctly

- Current v2 keeps global `knowledge_base` and `knowledge_item`; v2.x later moves material truth toward the real folder plus per-base index.
- Current v2 already stores the per-base index at `KnowledgeBase/{baseId}/.cherry/index.sqlite` (baseline adopted the hidden `.cherry` layout directly; the earlier "root now, move in v2.x" split no longer applies).
- `knowledge_item.id = material.material_id` in current v2. v1 migration should preserve legal old `knowledge_item.id` values when possible.
- `search_unit.material_id` is correct in the current docs. The session first considered content-only units, then later chose material-bound units for current-v2 feasibility and Agent locator clarity.
- FileManager `file_entry` and knowledge `file_ref` should no longer be the material identity for knowledge items.
- File, URL, and note inputs become knowledge-owned files or Markdown snapshots under the base directory; ordinary reindex reads local snapshots, not external sources.
- MinerU/current file processing stores only the final Markdown in the user-visible base directory. No `.cherry/artifacts`, `.cherry/assets`, page cache, bbox cache, or MinerU intermediate assets are part of current v2.
- For processed PDFs in current v2, UI still shows the source PDF item, but indexing reads `indexedRelativePath` Markdown.
- Current v2 keeps old chunk-oriented `KnowledgeSearchResult`; `snippets`, `matchedKinds`, material-level result, and `read(locator)` are v2.x.
- Current v2 still requires embedding model and dimensions. FTS-only knowledge bases are v2.x.
- Embeddings are keyed by `embedding_text_hash` under the current KB embedding contract; model/dimension changes require clearing/rebuilding vectors.
- Delete/rebuild operates by material, not single chunk. `deleteItemChunk` should be removed or return unsupported.
- Leaf deletion must delete index/files before deleting the global `knowledge_item` row.
- Delete base should close the index store handle before deleting `KnowledgeBase/{baseId}/`.
- Restore/duplicate should copy knowledge-owned files, including processed Markdown, rather than reusing external `source`.
- v1 -> current v2 migration is the stable target. Development-only current-v2 vectorstore data can be discarded or rebuilt.

## 4. Missing Decisions, Drift, Or Conflicts

No blocker conflicts found.

Minor issues and drift risks:

- `agent-managed-knowledge-product.md` describes the v2.x product target: folder UI as truth, watcher/fs scan, FTS-first creation, processed Markdown as independent visible material. `current-v2-knowledge-index-migration-plan.md` correctly defers these, but implementers must not blend the two scopes.
- `knowledge-service.md` and `operation-guards.md` describe current backend behavior with `file_ref`, `delete-item-chunk`, and old vector cleanup. These are useful current-state references, not target semantics.
- The handoff has duplicate suggested-question sections (`## 12` and a later `## 10`). This should be cleaned by Agent 10 or whoever owns final docs hygiene.
- The session and schema docs mention v1 embedding reuse only when `embedding_text_hash`, model, and dimensions fully match. The current-v2 plan says rebuilding is safer unless the old rows can be proven reliable. This is compatible, but Agent 07 should decide the implementation default explicitly.

## 5. Specific Required Checks

| Topic | Audit Result | Notes / Owner |
| --- | --- | --- |
| Material id | Correct | `knowledge_item.id = material.material_id`; old legal ids should be preserved in v1 migration. Agents 02, 05, 07. |
| FileEntry | Correct, high risk | Docs correctly remove FileEntry as material identity, but dependencies are likely broad. Agents 02, 03, 04, 08. |
| MinerU | Correct | Final Markdown only; path input/output; `context.dataId` as business identity; no artifacts/assets. Agent 04. |
| Snippet/search result | Correct boundary | Current v2 maps to old chunk result; Agent-first snippets and `matchedKinds` are v2.x. Agents 05, 08. |
| Embedding | Mostly correct | Current v2 requires model/dimensions; reuse only on exact text/model/dimension match. Agents 05, 07. |
| Delete | Correct | Material-level delete/rebuild; row deleted last; base directory deleted after closing index store. Agents 06, 07. |
| Migration | Mostly correct | Stable target is v1 -> current v2 final schema. Old v2 dev data is not a compatibility target. Agent 07. |
| v2 vs v2.x boundary | Correct but fragile | Biggest review risk is accidentally pulling watcher, FTS-only, content-index UI, or material-relation lifecycle into current v2. All agents, final owner Agent 10. |

## 6. Cross-Module Risks To Assign

- Agent 02 Data Model: confirm `knowledge_item.data` DTOs, `material_id` inheritance, `search_unit.material_id`, and "create table but do not enable" boundaries are coherent.
- Agent 03 File Storage: validate centralized path service, path escape protection, keep-both naming, `.cherry` restrictions, and old vectorstore file vs new base directory conflicts.
- Agent 04 File Processing/MinerU: verify path input/output survives JobSnapshot recovery, remote polling, retries, and MinerU `data_id` handling without FileEntry.
- Agent 05 Index/Search: verify `rebuildMaterial` atomicity, FTS rowid mapping, embedding GC, chunk offsets, stable `unit_id`, and old result-shape mapping.
- Agent 06 Workflow/Jobs: verify add/reindex/delete job payloads, completed fast-path behavior, base mutation lock, delete-wins-reindex races, and recovery after enqueue failure.
- Agent 07 Migration/Delete/Restore: verify v1 migration terminal shape, missing embedding model handling, old vector reuse policy, no knowledge `file_ref`, restore/duplicate copy behavior, and base delete handle closing.
- Agent 08 UI/Preload/IPC: verify SaveToKnowledge, AttachmentButton, chunk panel, preload contracts, and removal/unsupported behavior for single-chunk deletion.
- Agent 09 Testing/Rollout: estimate tests for path safety, recovery, migration, missing files, search compatibility, UI IPC contracts, and staged POC rollout.

