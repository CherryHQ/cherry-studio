# Agent Note: Import DeepSeek exports into Agent sessions

Status: proposed

English | [中文](2026-11-17-deepseek-agent-import.zh.md)

## Problem

Users need to import a DeepSeek account export into the Agent page and continue conversations with their history available to the model. The existing renderer `ImportService` creates Assistants and Topics; adding a parser there would not meet this requirement. Agent messages are display projections, while Pi Durable owns the model context in a separate native store.

The supplied November 17 export uses `export_format_version: 3`, `chat_session_index.json`, and `chat_sessions/<id>.json`. Local inspection found 106 conversations, 500 messages, and 14 conversations with branches. Messages use `parent_id` and conversations select `current_message_id`. Five file references include four available images and one missing payload (`export_path: null`). Message states include `FINISHED`, `TIMEOUT`, `INCOMPLETE`, and `CONTENT_FILTER`. These are sample observations, not a claim that every DeepSeek export has this shape. Private account data and conversation contents must not enter repository fixtures or PR attachments.

## Proposal

### Entry point and scope

Add an import action to the Agent page for a selected Pi Durable Agent. The user selects the original ZIP, reviews conversation/message counts and warnings, and imports it into new sessions under that Agent. Each source conversation becomes one session; import never appends to an existing conversation. The destination Agent supplies the model, workspace policy, and permissions for future turns. Imports do not run a model or tools. Unsupported Agent runtimes show an explanation rather than silently creating ordinary chat Topics or changing the Agent type.

This first version supports the observed DeepSeek v3 ZIP format and Pi Durable. It does not add ChatGPT/Claude Agent import, synchronize a DeepSeek account, restore DeepSeek authentication, or reconstruct files absent from the export. Existing Assistant import stays independent.

### Archive and content mapping

Main owns bounded ZIP reads and validation, using the existing archive dependency. Validate the manifest, session index, unique IDs, parent graph, selected message, and referenced archive entries before publication. Reject unsupported versions, malformed graphs, duplicate normalized paths, absolute/traversal paths, links, and archives exceeding explicit entry/count/uncompressed-size limits. Do not extract arbitrary paths or fetch remote URLs. Read entries incrementally; do not send the entire archive or all message bodies over IPC.

Preserve titles, original timestamps, roles, source IDs, parent relationships, and the selected branch. Generate fresh product IDs. Preserve empty or unsuccessful source messages as historical records rather than silently discarding them. They must not become pending submissions, resumable failed tasks, or fabricated successful answers. Store the original source status, and map terminal display status explicitly. Attribute imported answers to DeepSeek without inventing a model version or importing token counts as Cherry billing.

Map `REQUEST`, `RESPONSE`, and `TEMPLATE_RESPONSE` to text. Map `THINK` to completed reasoning with its available duration. Retain `CONTENT_RISK` as visible historical text. Render `TOOL_SEARCH`, `TOOL_OPEN`, and `TOOL_IMAGE_SEARCH` as historical search/open records, preserving queries, URLs, titles, snippets, and available results. They are not executable tool calls. Unknown fragment types fail validation with the affected conversation identified; they are not silently dropped.

Import available `FILE` payloads through managed file storage and keep stable message references, so reopening does not depend on the original ZIP. Preserve missing-file metadata with a visible warning and a model-readable unavailable-attachment marker. Available images enter native context as images subject to the destination model's existing capability/size rules. Non-image attachments use the existing Agent attachment representation; an unsupported payload produces an explicit validation error rather than a false success.

### Native history and branches

Extend the Pi Durable integration at its native-history boundary. Use public native transaction APIs (`createConversation`, `appendEntry`, `forkConversation`) with inert application-owned import entries and model-facing messages. Do not manufacture generation task IDs for `AssistantEntry`, patch native SQLite tables, or replay historical user submissions through `submit`.

Use native conversations for divergent paths and existing product message-tree/context bindings for branch selection. The initial selection follows `current_message_id`, even when another branch appears later in the export. Changing branch and sending a new message must select that branch's native prefix. Completed assistant boundaries receive valid native checkpoints; unavailable historical actions keep their existing explicit eligibility reasons. Imported reasoning and search records remain readable history, not native task, goal, approval, or tool authority. Model context retains user/assistant roles; reasoning and search material are labeled historical text instead of forged provider-specific reasoning signatures or tool results.

The native preparation must finish and verify its context before the product session becomes visible. Reopening and subsequent projection updates must preserve imported display records without duplicating them. Existing [Pi Durable fork ownership](../../implemented/feature/2026-11-09-pi-durable-desktop-fork.md) and backend identity rules remain authoritative; this proposal adds external-history construction, not a second runtime owner.

### Publication and failure recovery

Use a Main-owned import operation with durable identity and progress, accessed through IpcApi. The renderer reviews and observes the operation; dialog visibility does not own its lifetime. Persist operation identity before native/file preparation. Key each source conversation by target Agent, archive digest, and source conversation ID. Retrying the same archive resumes incomplete work and reports already-imported conversations without duplicates. A different archive digest is a separate import; this version does not merge changed exports.

Publish each conversation's session, message tree, file references, context bindings, and completion marker in one synchronous product database transaction. Native storage and product SQLite are separate commits: reconcile a prepared native identity after interruption, never claim a cross-store transaction. Cancellation stops between conversations or before publication, preserving already-published sessions. Report imported, already-imported, failed, and remaining counts accurately. Retain identifiable inert preparations until recovery or proven operation-owned cleanup; never delete shared native ancestry or unrelated files. New product schema, if necessary for operation identity, uses appended migrations.

### Implementation and verification ownership

Main's Agent-session domain owns orchestration and publication; the Pi Durable adapter owns native entries and checkpoints; shared IPC schemas own commands/progress; the existing Agent UI owns selection, preview, and result navigation. Use existing UI components, localization, file ownership, central paths, and lifecycle rules. Keep parsing separate enough to test with synthetic fixtures without turning this into a general import framework.

Implement native import and file-backed publication first, then the UI and end-to-end verification. No implementation layer starts until this Spec head is approved. If public native APIs cannot satisfy a contract, revise this Spec for an upstream solution before implementing a workaround.

## Alternatives considered

- Adding a `DeepSeekImporter` only to Assistant import targets the wrong product surface and cannot provide Agent context.
- Writing only product message rows makes history visible without making it available to the next model request.
- Flattening all branches mixes mutually exclusive histories; importing only the selected path silently loses source messages.
- Replaying historical inputs runs models/tools and changes answers. Importing one giant user-message transcript loses roles, branches, and attachment semantics.
- Supporting all runtimes immediately requires separate native-history contracts and broadens this feature beyond the verified Pi Durable primitives.

## Acceptance criteria

- AC1 — Selecting a valid v3 ZIP from a Pi Durable Agent previews counts/warnings and creates new Agent sessions; cancellation before starting creates nothing, unsupported runtimes are explained, and ordinary Assistant import still works. (verification: renderer and Electron; owner: UI implementer)
- AC2 — Synthetic fixtures preserve every source message, role, title, timestamp, parent edge, and selected message; malformed IDs/graphs/indexes and unsupported versions/fragments fail explicitly. (verification: unit; owner: parser implementer)
- AC3 — Text, reasoning duration, refusal/risk text, search records, and unsuccessful/empty messages remain visible with truthful terminal state; import performs zero model/tool calls and records no Cherry usage charge. (verification: unit and real runtime; owner: native import implementer)
- AC4 — A scripted model's first request after import and after close/reopen contains the selected branch's historical roles/content and excludes sibling tails; branch switching and a subsequent turn use the corresponding native prefix without duplicating display history. (verification: real runtime and file-backed integration; owner: native import implementer)
- AC5 — Available images remain viewable after the source ZIP is removed and reach a compatible model request; missing payloads retain metadata and an explicit warning/marker; unsafe paths, links, duplicate entries, and archive limits are rejected before publication. (verification: unit, file-backed integration, and Electron; owner: archive implementer)
- AC6 — Failure injection before/after native preparation and product commit, cancellation, and process restart never expose a partially published conversation or delete unrelated data; retrying the same archive produces one product session per source conversation and truthful progress counts. (verification: file-backed integration and process restart; owner: import coordinator implementer)
- AC7 — Imported completed assistant checkpoints support existing Fork/Edit eligibility with the correct context, while failed boundaries remain ineligible; historical tool/task metadata never becomes executable work on reopen. (verification: real runtime and affected history-action tests; owner: native import implementer)
- AC8 — Local acceptance with the supplied archive accounts for 106 conversations and 500 messages, retains the 14 branched conversations and four image payloads, reports the one absent file, and successfully continues a selected conversation in Electron. Only synthetic fixtures and aggregate results are published. (verification: Electron and local archive inspection; owner: integrating implementer)

## Risks

The sample is not a published schema guarantee; unsupported formats must fail clearly. Preserving all branches and images increases storage and may exceed a destination model's context limits; existing model limits and compaction apply, with no silent truncation by the importer. Cross-store recovery and projection reconciliation need real-runtime evidence, not parser tests alone. The native SDK has no general public conversation deletion API, so failed preparations may remain inert and identifiable. The unavailable file cannot be recovered from this ZIP. The initial Pi Durable-only scope is an explicit compatibility limit to review before implementation.
