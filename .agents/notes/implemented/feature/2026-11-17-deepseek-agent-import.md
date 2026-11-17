# Agent Note: Import DeepSeek exports into Agent sessions

Status: implemented

English | [中文](2026-11-17-deepseek-agent-import.zh.md)

## Problem

Users need to import a DeepSeek account export into the Agent page and continue conversations with their history available to the model. The existing renderer `ImportService` creates Assistants and Topics; adding a parser there would not meet this requirement. Agent messages retain product history, while each Harness owns its native execution context.

The supplied November 17 export uses `export_format_version: 3`, `chat_session_index.json`, and `chat_sessions/<id>.json`. Local inspection found 106 conversations, 500 messages, and 14 conversations with non-root sibling branches. Messages use `parent_id` and conversations select `current_message_id`. Five file references include four available images and one missing payload (`export_path: null`). Message states include `FINISHED`, `TIMEOUT`, `INCOMPLETE`, and `CONTENT_FILTER`. These are sample observations, not a claim that every DeepSeek export has this shape. Private account data and conversation contents must not enter repository fixtures or PR attachments.

## Decision

### Entry point and scope

Settings → Data → Import external application data provides the DeepSeek import entry. The user selects a destination Agent using the shared Agent selector before opening the import dialog. The Agent group menu has no import action. The user selects the original ZIP, reviews conversation/message counts and warnings, and imports it into new sessions under that Agent. Each source conversation becomes one session; import never appends to an existing conversation. The destination Agent supplies the model, workspace policy, and permissions for future turns. Imports do not run a model or tools.

This version supports the observed DeepSeek v3 ZIP format and the existing Claude Code, Pi and Pi Durable Agents. It does not add ChatGPT/Claude Agent import, synchronize a DeepSeek account, restore DeepSeek authentication, or reconstruct files absent from the export. Existing Assistant import stays independent.

### Archive and content mapping

Main owns bounded ZIP reads and validation, using the existing archive dependency. Read the user-selected ZIP directly without creating a temporary or retained copy. Save its original path and digest with the operation; verify the digest again before import. If the original is moved or unavailable, the user must reselect it to retry. Validate the manifest, session index, unique IDs, parent graph, selected message, and referenced archive entries before publication. Reject unsupported versions, malformed graphs, duplicate normalized paths, absolute/traversal paths, links, and archives exceeding explicit entry/count/uncompressed-size limits. Do not extract arbitrary paths or fetch remote URLs. Read entries incrementally; do not send the entire archive or all message bodies over IPC.

Preserve titles, original timestamps, roles, source IDs, parent relationships, and the selected branch. Generate fresh product IDs. Keep the exact source timestamp in import provenance; advance product ordering timestamps by at least one millisecond per parent edge when source times tie or regress, so pagination preserves consecutive user messages before their answer. Preserve empty or unsuccessful source messages as historical records rather than silently discarding them. They must not become pending submissions, resumable failed tasks, or fabricated successful answers. Store the original source status, and map terminal display status explicitly. Attribute imported answers to DeepSeek without inventing a model version or importing token counts as Cherry billing.

Map `REQUEST`, `RESPONSE`, and `TEMPLATE_RESPONSE` to text. Map `THINK` to completed reasoning with its available duration. Retain `CONTENT_RISK` as visible historical text. Render `TOOL_SEARCH`, `TOOL_OPEN`, and `TOOL_IMAGE_SEARCH` as historical search/open records, preserving queries, URLs, titles, snippets, and available results. Search, page visits, and image searches use completed standard tool parts with generated call IDs, observed input and full output, interleaved with reasoning in source order. Existing tool-call/result components expose queries, links, snippets, source status, and empty results; the continuation context retains the complete labeled record. Search results are not fabricated answer citations: no synthetic citation footer or source list is appended. Imported failures and empty messages show their original export status instead of a runtime error or retry action. These completed display records do not dispatch new tool calls. Unknown fragment types fail validation with the affected conversation identified; they are not silently dropped.

Import available `FILE` payloads through managed file storage and keep stable message references, so reopening does not depend on the original ZIP. Reject conflicting file descriptors sharing an attachment ID within a conversation before publication; repeated references to the same descriptor remain valid. Preserve missing-file metadata with a visible warning and a model-readable unavailable-attachment marker. Available files and images use the destination Harness's existing attachment conversion and capability/size rules. Non-image attachments use the existing Agent attachment representation; an unsupported payload produces an explicit validation error rather than a false success.

### Session context and branches

Import writes the product message tree and managed attachments only. It does not create a native transcript, task, submission, checkpoint, or resume token. Opening an imported session uses the ordinary runtime connection path without executing imported work.

At the first new submission on a branch without prior native input, `AgentSessionRuntimeService` reads the selected ancestor prefix through `readSessionHistory`. The host sends it as model-only `AgentRuntimeCommand.context`, using reference text with explicit user/assistant roles and complete reasoning/tool records, plus managed file parts. The original product message is unchanged. Historical tools are data rather than executable calls. This is a generic Session mechanism: it does not inspect import provenance or select a Harness. Drivers apply their existing input and attachment conversion and keep native input identity tied to the original message.

Fresh native contexts are anchored at the selected product position rather than the common tree root, so sibling branches remain independent. Later turns and reopening reuse ordinary native history; they do not resend the product transcript. An existing native binding or resume identity still follows normal recovery: a missing store is not replaced with reconstructed history. Imported historical answers have no invented native Fork/Edit checkpoints; existing eligibility reasons apply. Answers created after continuation use normal runtime checkpoints.

### Publication and failure recovery

Use a Main-owned import operation with durable identity and progress, accessed through IpcApi. The renderer reviews and observes the operation; dialog visibility does not own its lifetime. Persist operation identity before managed-file preparation. Key each source conversation by target Agent, archive digest, and source conversation ID. Retrying the same archive resumes incomplete work and reports already-imported conversations without duplicates. A different archive digest is a separate import; this version does not merge changed exports.

Publish each conversation's session, message tree, file references, and completion marker in one synchronous product database transaction. Managed files are prepared before publication, and their receipt retains stable IDs across a retry. Cancellation stops between conversations or before publication, preserving already-published sessions. Report imported, already-imported, failed, and remaining counts accurately. Retain managed file entries referenced by published or retryable work; never delete unrelated files. New product schema, if necessary for operation identity, uses appended migrations.

### Decision and verification ownership

Main's Agent-session domain owns import orchestration, publication and first-submission context. `ConversationImporter` exposes source identity, preview and per-conversation loading into normalized messages. `DeepSeekImporter` owns ZIP validation, source fields, content mapping and attachment preparation; `AgentImportService` owns progress, retry receipts, product IDs and atomic publication without reading DeepSeek fields. Operations retain the importer ID so retries select the same adapter; older operations use the default importer. This small boundary follows the renderer importer's parser/persistence separation and gives future ChatGPT/Claude migration a common publication path without migrating them now. Existing runtime drivers own native execution and ordinary input conversion; shared IPC schemas own commands/progress; Settings owns selection, preview and result navigation. Use existing UI components, localization, file ownership, central paths, and lifecycle rules.

The user explicitly authorized implementation without waiting for Spec Approval on November 17 and requested a generic, Harness-independent rebuild. Product publication is atomic per conversation. Import admission and draining participate in Agent lifecycle backup/restore quiescing. The original ZIP is never copied, modified, or deleted by import, and completed sessions depend on managed attachments rather than the ZIP.

## Alternatives considered

- Adding a `DeepSeekImporter` only to Assistant import targets the wrong product surface and cannot provide Agent context.
- Writing only product message rows makes history visible without making it available to the next model request.
- Flattening all branches mixes mutually exclusive histories; importing only the selected path silently loses source messages.
- Replaying historical inputs runs models/tools and changes answers. Keep historical roles as labeled reference data and attachments as managed parts, while preserving the original branch tree in product storage.
- Reconstructing native history separately for each Harness requires native file writers, checkpoint mappings and cross-store recovery. A single Session reference context uses the existing submission contract instead.

## Consequences

The sample is not a published schema guarantee; unsupported formats fail clearly. Preserving all branches and images increases storage and may exceed a destination model's context limits; existing model limits and compaction apply, with no silent truncation by the importer. Reference context preserves historical roles as labeled data rather than native assistant/tool authority. Imported historical Fork/Edit points are not restored. The unavailable file cannot be recovered from this ZIP. An unfinished import needs the original ZIP or a reselected copy with the same digest; completed sessions do not.

## Verification

- AC1 — `ImportMenuSettings.test.tsx` verifies Settings destination selection; `AgentImportPopup.test.tsx` verifies preview and progress after reopening. Existing Assistant import stays independent.
- AC2 — `deepseek.test.ts` and `deepseekArchive.test.ts` cover graph ordering, selected siblings, empty/untitled sessions, unknown fragments, duplicate paths, links and limits. Earlier private-sample validation found 106 sessions and 500 messages.
- AC3 — Content tests preserve reasoning, complete search records, source statuses and missing-file labels. Import publication creates no native contexts or historical submissions.
- AC4 — `sessionHistory.test.ts` verifies a generic selected prefix without import metadata, consecutive user ordering, complete tool records and no repeated history after native input. `PiDurableRuntimeConnection.test.ts` sends both siblings through the real runtime and SQLite to a scripted provider, then closes/reopens the selected native conversation and checks its model request. Claude desktop integration verifies host-supplied history reaches a real SDK request.
- AC5 — History tests retain attachment metadata through normal input conversion; content/archive tests cover managed file references and missing or conflicting descriptors. A real Claude SDK request also verifies historical image bytes through existing attachment conversion. Continuation uses each Harness's existing attachment behavior.
- AC6 — `AgentImportService.test.ts` covers product rollback, service replacement, deduplication, cancellation, pause/drain, post-commit notification failure, no ZIP copy or modification, changed-source rejection and reselecting a moved ZIP. A second importer fixture verifies publication and retry without DeepSeek metadata; `DeepSeekImporter.test.ts` verifies normalization and missing-file warnings.
- AC7 — History tests verify independent context bindings for Claude Code, Pi and Pi Durable siblings without manufacturing source checkpoints. Existing runtime and message-service tests cover continuation and normal Fork/Edit consumers.
- AC8 — Earlier private-sample and Electron acceptance exercised the prior native-history implementation. The simplified path is checked with synthetic file-backed and native-runtime tests; Electron acceptance is not rerun because the user requested that testing not take focus. Private exports and contents are not committed.
