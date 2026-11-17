# Agent Note: Import DeepSeek exports into Agent sessions

Status: implemented

English | [中文](2026-11-17-deepseek-agent-import.zh.md)

## Problem

Users need to import a DeepSeek account export into the Agent page and continue conversations with their history available to the model. The existing renderer `ImportService` creates Assistants and Topics; adding a parser there would not meet this requirement. Agent messages are display projections, while Pi Durable owns the model context in a separate native store.

The supplied November 17 export uses `export_format_version: 3`, `chat_session_index.json`, and `chat_sessions/<id>.json`. Local inspection found 106 conversations, 500 messages, and 14 conversations with non-root sibling branches. Messages use `parent_id` and conversations select `current_message_id`. Five file references include four available images and one missing payload (`export_path: null`). Message states include `FINISHED`, `TIMEOUT`, `INCOMPLETE`, and `CONTENT_FILTER`. These are sample observations, not a claim that every DeepSeek export has this shape. Private account data and conversation contents must not enter repository fixtures or PR attachments.

## Decision

### Entry point and scope

Settings → Data → Import external application data provides the DeepSeek import entry. The user selects a destination Agent using the shared Agent selector before opening the import dialog. The Agent group menu has no import action. The user selects the original ZIP, reviews conversation/message counts and warnings, and imports it into new sessions under that Agent. Each source conversation becomes one session; import never appends to an existing conversation. The destination Agent supplies the model, workspace policy, and permissions for future turns. Imports do not run a model or tools. Unsupported Agent runtimes show an explanation rather than silently creating ordinary chat Topics or changing the Agent type.

This first version supports the observed DeepSeek v3 ZIP format and Pi Durable. It does not add ChatGPT/Claude Agent import, synchronize a DeepSeek account, restore DeepSeek authentication, or reconstruct files absent from the export. Existing Assistant import stays independent.

### Archive and content mapping

Main owns bounded ZIP reads and validation, using the existing archive dependency. Validate the manifest, session index, unique IDs, parent graph, selected message, and referenced archive entries before publication. Reject unsupported versions, malformed graphs, duplicate normalized paths, absolute/traversal paths, links, and archives exceeding explicit entry/count/uncompressed-size limits. Do not extract arbitrary paths or fetch remote URLs. Read entries incrementally; do not send the entire archive or all message bodies over IPC.

Preserve titles, original timestamps, roles, source IDs, parent relationships, and the selected branch. Generate fresh product IDs. Keep the exact source timestamp in import provenance; advance product ordering timestamps by at least one millisecond per parent edge when source times tie or regress, so pagination preserves consecutive user messages before their answer. Preserve empty or unsuccessful source messages as historical records rather than silently discarding them. They must not become pending submissions, resumable failed tasks, or fabricated successful answers. Store the original source status, and map terminal display status explicitly. Attribute imported answers to DeepSeek without inventing a model version or importing token counts as Cherry billing.

Map `REQUEST`, `RESPONSE`, and `TEMPLATE_RESPONSE` to text. Map `THINK` to completed reasoning with its available duration. Retain `CONTENT_RISK` as visible historical text. Render `TOOL_SEARCH`, `TOOL_OPEN`, and `TOOL_IMAGE_SEARCH` as historical search/open records, preserving queries, URLs, titles, snippets, and available results. Search, page visits, and image searches use completed standard tool parts with generated call IDs, observed input and full output, interleaved with reasoning in source order. Existing tool-call/result components expose queries, links, snippets, source status, and empty results; native context retains the complete labeled record. Search results are not fabricated answer citations: no synthetic citation footer or source list is appended. Imported failures and empty messages show their original export status instead of a runtime error or retry action. These completed display records do not dispatch new tool calls. Unknown fragment types fail validation with the affected conversation identified; they are not silently dropped.

Import available `FILE` payloads through managed file storage and keep stable message references, so reopening does not depend on the original ZIP. Reject conflicting file descriptors sharing an attachment ID within a conversation before publication; repeated references to the same descriptor remain valid. Preserve missing-file metadata with a visible warning and a model-readable unavailable-attachment marker. Available images enter native context as images subject to the destination model's existing capability/size rules. Non-image attachments use the existing Agent attachment representation; an unsupported payload produces an explicit validation error rather than a false success.

### Native history and branches

Extend the Pi Durable integration at its native-history boundary. Use public native transaction APIs (`createConversation`, `appendEntry`, `forkConversation`) with inert application-owned import entries and model-facing messages. Do not manufacture generation task IDs for `AssistantEntry`, patch native SQLite tables, or replay historical user submissions through `submit`.

Use native conversations for divergent paths and existing product message-tree/context bindings for branch selection. The initial selection follows `current_message_id`, even when another branch appears later in the export. Changing branch and sending a new message must select that branch's native prefix. Completed assistant boundaries receive valid native checkpoints; unavailable historical actions keep their existing explicit eligibility reasons. Imported reasoning and search records remain readable history, not native task, goal, approval, or tool authority. Model context retains user/assistant roles; reasoning and search material are labeled historical text instead of forged provider-specific reasoning signatures or tool results.

The native preparation must finish and verify its context before the product session becomes visible. Reopening and subsequent projection updates must preserve imported display records without duplicating them. Existing [Pi Durable fork ownership](../../implemented/feature/2026-11-09-pi-durable-desktop-fork.md) and backend identity rules remain authoritative; this implementation adds external-history construction, not a second runtime owner.

### Publication and failure recovery

Use a Main-owned import operation with durable identity and progress, accessed through IpcApi. The renderer reviews and observes the operation; dialog visibility does not own its lifetime. Persist operation identity before native/file preparation. Key each source conversation by target Agent, archive digest, and source conversation ID. Retrying the same archive resumes incomplete work and reports already-imported conversations without duplicates. A different archive digest is a separate import; this version does not merge changed exports.

Publish each conversation's session, message tree, file references, context bindings, and completion marker in one synchronous product database transaction. Native storage and product SQLite are separate commits: reconcile a prepared native identity after interruption, never claim a cross-store transaction. Cancellation stops between conversations or before publication, preserving already-published sessions. Report imported, already-imported, failed, and remaining counts accurately. Retain identifiable inert preparations until recovery or proven operation-owned cleanup; never delete shared native ancestry or unrelated files. New product schema, if necessary for operation identity, uses appended migrations.

### Decision and verification ownership

Main's Agent-session domain owns orchestration and publication; the Pi Durable adapter owns native entries and checkpoints; shared IPC schemas own commands/progress; the existing Agent UI owns selection, preview, and result navigation. Use existing UI components, localization, file ownership, central paths, and lifecycle rules. Keep parsing separate enough to test with synthetic fixtures without turning this into a general import framework.

The user explicitly authorized implementation without waiting for Spec Approval on November 17. Native construction uses the public Session API with one committed conversation prefix per message and per-node recovery receipts. Product publication is atomic per conversation. Import admission and draining participate in Agent lifecycle backup/restore quiescing. Frozen ZIPs, prepared stores, and manual-cleanup file entries are retained for recovery; this version has no automatic import-artifact reclamation.

## Alternatives considered

- Adding a `DeepSeekImporter` only to Assistant import targets the wrong product surface and cannot provide Agent context.
- Writing only product message rows makes history visible without making it available to the next model request.
- Flattening all branches mixes mutually exclusive histories; importing only the selected path silently loses source messages.
- Replaying historical inputs runs models/tools and changes answers. Importing one giant user-message transcript loses roles, branches, and attachment semantics.
- Supporting all runtimes immediately requires separate native-history contracts and broadens this feature beyond the verified Pi Durable primitives.

## Consequences

The sample is not a published schema guarantee; unsupported formats must fail clearly. Preserving all branches and images increases storage and may exceed a destination model's context limits; existing model limits and compaction apply, with no silent truncation by the importer. Cross-store recovery and projection reconciliation need real-runtime evidence, not parser tests alone. The native SDK has no general public conversation deletion API, so failed preparations may remain inert and identifiable. The unavailable file cannot be recovered from this ZIP. The initial Pi Durable-only scope is an explicit compatibility limit.

## Verification

- AC1 — `ImportMenuSettings.test.tsx` verifies destination selection and opening Agent import from Settings; `AgentImportPopup.test.tsx` verifies preview, unsupported runtimes, and progress after dialog reopening. Electron imports through the new dialog and normal Agent navigation. Existing Assistant import code is untouched.
- AC2 — `deepseek.test.ts` and `deepseekArchive.test.ts` cover parent ordering, sibling selection, empty/untitled sessions, invalid graphs, unknown fragments, duplicate paths, link entries, and limits. The private sample passes aggregate assertions for 106 sessions and 500 messages.
- AC3 — Content tests preserve reasoning, search text, missing-file labels, and zero historical usage. File-backed import publishes all 500 sample messages without starting a Harness; native tests observe no provider calls before a new submission.
- AC4 — `durableImport.test.ts` closes/reopens real native SQLite, retries preparation, and submits each sibling to a scripted provider with branch-specific context assertions. The projection test excludes duplicate imported display entries. Electron continuation before and after process restart reaches a local OpenAI-compatible stub with both historical roles and matched original content.
- AC5 — FileManager integration checks independent image bytes, stable file references, and unavailable-file markers. Electron sends an imported image as a data URI to the local stub after reopening. Archive tests reject duplicates, links, and excessive entry sizes.
- AC6 — `AgentImportService.test.ts` covers product-commit rollback, replacement-service retry, deduplication, immediate cancellation, pause/drain, and a failed post-commit notification. Native per-node receipts survive close/reopen. Electron restarts with the completed operation and continues imported history. Abrupt process termination at every individual write boundary is not separately exercised.
- AC7 — Publication tests check the selected native binding and imported Fork checkpoint; the affected `AgentSessionMessageService` suite covers existing Fork/Edit eligibility. Only successful source assistant messages receive anchors, and imported entries contain no executable tool/task records.
- AC8 — The supplied archive passes real file-backed import and Electron import: 106 sessions, 500 messages, 14 conversations with non-root sibling branches, four image payloads, and one unavailable file. A local stub verifies subsequent text and image requests; no private content is sent to an external provider or committed as fixtures.
