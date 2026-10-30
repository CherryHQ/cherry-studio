# Agent Note: Shared memory

Status: proposed

English | [中文](2026-10-29-shared-memory.zh.md)

## Problem

Agent file memory currently keeps durable facts in each Agent's `memory/FACT.md` and events in `memory/JOURNAL.jsonl`. It cannot directly share long-term user preferences with other Agents or opted-in Assistants. A growing collection of facts also needs an entry point that stays small without producing a separate tiny file for every fact.

Removing a dedicated memory MCP tool does not make native file edits safe. Concurrent sessions can overwrite unseen changes, and a failed multi-file reorganization can leave content or links incomplete. The feature needs program-enforced reads, saves, backups, recovery, and background scheduling alongside model-driven content selection.

The existing [memory overview](../../../../docs/references/memory/overview.md), [Agent prompt builder](../../../../src/main/ai/agents/prompt.ts), and [Agent memory MCP implementation](../../../../src/main/ai/mcp/servers/agentMemory.ts) describe the current integration. This Spec defines its successor for file memory; the Knowledge Base and the independent `@cherry/memory` knowledge-graph MCP remain separate.

## Proposal

### 1. Scope and ownership

Provide shared user preferences and per-Agent private knowledge. Project and customer knowledge remains private to its owning Agent. A private scope belongs to an Agent across sessions and workspaces; it is not automatically isolated by project.

The first delivery includes entry injection, controlled file access, file-management controls, pre-change backups, latest-operation recovery, and Dreaming that reorganizes existing memory. A conversation model with controlled write access may save an explicit durable preference or a user-requested memory in its current turn after inspecting existing content. Temporary tasks, ordinary questions, unsupported guesses, and credentials are not long-term memory.

An additional stacked layer implements conversation extraction under the global generation switch. Existing-file organization remains an independent capability. Extraction accepts only new successful desktop conversation turns with shared-memory permission, through main-owned completion events. It never scans historical chats. Cross-Agent private-to-shared extraction, channels, headless work, multi-device sync, full version history, a recall model, and a duplicate candidate-content store remain deferred.

Extraction uses the same idle worker and physical mutex as organization. One bounded source message is read per task, with one default-model call and no automatic retry. The model classifies up to five exact user-text quotes as general preferences, explicitly requested enduring personal facts, project knowledge, customer knowledge, or uncertain. Only the first two categories qualify for shared memory. Project/customer knowledge remains excluded even when requested as a global preference; preserve ownership and applicability context in mixed messages. Missing or unknown classifications fail validation. Classification is a model judgment, not a trusted authorization or proof of semantic isolation; tool output, assistant claims, files, transient requests, secrets, and embedded instructions are not eligible evidence. Validate every quote against the unchanged source and append only missing quotes to the shared entry through receipt-backed, recoverable commits. Do not rewrite existing facts. A full entry stops extraction rather than truncating it.

Admission requires the current topic/session owner, successful persisted response, source message ID and version, and shared-access setting. Recheck these before inference and final replacement. Per-conversation cursors store IDs, versions, and outcomes only. The bounded pending queue is ephemeral; restart, clear, recovery, cancellation, or disabling generation discards old work and establishes a new processing boundary. Relevant entity revocation also discards its work, including off/on toggles. Messages written before that boundary are never backfilled. Failures are reported through the existing recent-result status, without inserting chat messages. Source deletion prevents uncommitted extraction; already saved memories require explicit deletion or recovery.

The model chooses facts, wording, scope, and organization. The main-process memory owner enforces access and commits; runtime adapters bind native tool calls to that owner; Dreaming owns reconciliation and scheduling; the editor calls the same owner over IpcApi. No new memory MCP protocol, memory-content database, or search index is introduced.

### 2. Files and topic granularity

Register shared and backup roots through the central path registry. `{userData}` means the application's actual data directory. Private files use the current Agent's registered data directory.

```text
{userData}/Data/Memory/
  MEMORY.md
  .memories/
    preferences.md
    development.md

{agentData}/
  MEMORY.md
  .memories/
    project-payments.md
    troubleshooting.md
  memory/
    FACT.md
    JOURNAL.jsonl

{userData}/Data/MemoryBackups/
```

Only `MEMORY.md` and topic Markdown files in `.memories/` belong to the active corpus. Old `memory/` files, backups, temporary files, and unknown files are excluded from normal injection, search, Dreaming, and writes. On Windows, set the hidden-directory attribute; on macOS and Linux, retain the dot-directory convention. Application lists, search, export, and backup must still include managed topics. Hidden status grants no access protection.

The entry holds a few complete, frequently needed facts plus useful topic links. It is neither an exhaustive file list nor a summary of every fact. A single preference such as “usually reply in Chinese” can remain in the entry without another file. Low-frequency detail moves into a relevant topic when it needs independent lookup or grows conditions and exceptions. Keep one authoritative body; the entry then retains only a locator.

A topic contains several related facts and headings grouped by use case. Search existing topics before creating one. Split when distinct use cases emerge or capacity requires it, not for each keyword, date, or list item. File size and count are reorganization clues, not deletion criteria; small independent topics remain valid.

Facts use ordinary list items. An optional `[source: reference; added: YYYY-MM-DD]` preserves a real known source without inventing one or granting access to it. `[[path]]` is relative to the current memory root and may omit `.md`. Conditions stay with the fact. Topics absent from the entry remain discoverable through controlled listing and search. Entry facts are original content and cannot be regenerated from the topics.

### 3. Eligibility and request loading

| Caller | Shared memory | Private memory |
|---|---|---|
| Desktop Agent | Enabled by default; may be disabled | Current Agent only |
| Assistant in a normal persistent conversation | Disabled by default; opt-in; tools require controlled integration | None |
| Temporary, auxiliary, or ordinary headless Assistant | None | None |
| Agent attached to an external channel | None | Owning Agent's existing permission scope only |
| Dreaming | Explicitly bound shared maintenance scope | One explicitly bound Agent scope |

Caller identity comes from trusted main-process session or task context. An ID or path supplied by a model is not authorization. Dreaming uses a distinct maintenance identity. Each operation rechecks identity, ownership, switches, and resource existence. Resolve the real target and reject traversal, out-of-scope paths, symbolic links, junctions, and other reparse paths that escape the managed scope. A link does not authorize another scope.

Each new turn, resume, and post-compaction request reloads the eligible shared entry and current Agent's private entry. Existing system prompts, `SOUL.md`, and `USER.md` keep their roles; do not duplicate them into shared memory. Inject clearly labeled reference data and stable usage guidance, replace the previous memory block, and never persist that block as an ordinary chat message. Current explicit user instructions take precedence over memory.

Compaction preserves task progress and useful paths, not a claim that old memory is current. Re-read a topic when its body is no longer available or a new edit needs a fresh baseline. Use links first, then authorized filename/content search. Report truncated, incomplete, or paginated search results. A request without controlled file access uses only the complete facts already injected; it cannot claim to have followed links or saved content.

| Limit | Rule |
|---|---|
| Each entry | 200 lines or 25,000 UTF-8 bytes, whichever is reached first |
| Each topic | 25,000 UTF-8 bytes |
| Entry warning | 160 lines or 20,000 UTF-8 bytes |
| Topic warning | 20,000 UTF-8 bytes |
| One Dreaming batch | At most 10 input files including the entry, 50,000 UTF-8 bytes in total, and one organization model call |

Entry injection stops at complete lines and explicitly reports omitted content. Controlled entry saves enforce both limits; topic saves enforce the byte limit. Never silently truncate a saved file or use a search excerpt as its full body. Preserve externally oversized originals and report the need to reorganize them. An edit requires a complete read through a capable adapter; otherwise reject it. No automatic expansion of all topics or cross-request body cache is added.

### 4. Controlled tools and module contracts

Reuse existing file list, search, read, write, edit, delete, and rename capabilities. The execution layer routes managed targets through the memory owner; normal files keep their current behavior. Stop the old Agent FACT/JOURNAL tool path at migration cutover. Do not remove the independent [graph-memory server](../../../../src/main/ai/mcp/servers/memory.ts) or unrelated MCP tools.

| Boundary | Input and responsibility | Result and rejection |
|---|---|---|
| Runtime or editor to memory read | Trusted caller, scope, target; validate access and fully read the file | Body plus a caller-bound read receipt; reject inaccessible or incomplete reads for editing |
| Runtime or editor to memory mutation | Exact approved operation/content and its read receipt, or an explicit absent-target baseline for creation | Actual result, final hash, and recovery batch reference; reject stale, ambiguous, unauthorized, or oversized requests |
| Dreaming to memory commit | One scope, task generation, all input baselines, proposed target contents, and ordered operations | Per-file completed, incomplete, or conflicting results; no direct model writes |
| Editor to recovery | Selected latest batch, displayed file set and current baselines, user confirmation | Per-file recovery results; preserve later edits and both versions on conflict |
| Memory owner to scheduling | Confirmed changed paths, hashes, and trusted mutation source | Owner-managed reconciliation markers; no model-supplied source classification |

The read receipt binds the hash of the exact bytes seen to the caller, target, and editing basis outside model-editable content. Never read the newest hash just before saving and pretend it was the model's baseline. Never substitute another session's or a newer read's receipt for an older edit. Missing or ambiguous correspondence requires a new full read and a newly generated edit. Approvals bind the scope, targets, operation, proposed content, and expected versions; changes require renewed approval. The existing permission policy decides when approval is granted, but granted operations still pass save protection.

Pi and Claude Code require separate adapters. Pi assembles SDK tools in [PiRuntimeConnection](../../../../src/main/ai/runtime/pi/PiRuntimeConnection.ts) and applies policy in [approvalExtension](../../../../src/main/ai/runtime/pi/approvalExtension.ts). Claude Code evaluates guards in [PreToolUse hooks](../../../../src/main/ai/runtime/claudeCode/hooks.ts), because auto-approved paths may skip `canUseTool`. These are integration points, not an existing transactional save service. A pre-tool permission check alone does not hold the save lock through the eventual write.

For each runtime, declare and test the operations actually routed through the owner, including deletion and rename. An operation that cannot satisfy the contract is not delivered as protected memory editing. Assistant file editing is exposed only after the same capability and approval integration; otherwise it remains entry-only.

Shells, scripts, subprocesses, unrelated tools, and external editors with direct disk access can bypass a file adapter. The first-delivery backup/version guarantee covers controlled operations. A stronger guarantee requires effective filesystem isolation, including child processes and path aliases, verified per platform. Prompt instructions, command-text matching, ordinary approval, and after-the-fact file watching do not establish that guarantee.

### 5. Commit, content checks, and counting

Use the application's existing single-instance data-directory ownership and serialize controlled mutations within each scope. Settings saves, runtime edits, and Dreaming share this flow:

```text
authorize operation and bind read baseline
-> acquire scope write lock
-> recheck permissions, task generation, and actual file hashes
-> persist pre-change backup and recovery manifest
-> write complete temporary file and safely replace target
-> inspect actual result and record completed operations
-> release lock and return result
```

Use SHA-256 over complete file bytes for optimistic concurrency. Check absence for creation and both source and destination conditions for rename. Unexpected disappearance, new destination files, or mismatched hashes are conflicts. A backup failure stops mutation. A scope lock serializes cooperating writers; it cannot exclude external filesystem writers or guarantee crash durability by itself.

SHA-256 is a content fingerprint, not a count or chronological version. `A -> B -> A` can contain two edits while ending at the original hash. The first delivery adds no YAML display version. Program-only metadata changes do not count as content changes; conflict checks still cover all bytes.

Count only successfully observed controlled content changes since the file's last successful organization/check. Failed writes, identical saves, Dreaming's own changes, recovery, and metadata-only changes do not increment it. Trusted execution context supplies the mutation source. External changes and crash gaps become pending reconciliation without invented counts. Restore or clear also invalidates task generations, even if content returns to an earlier hash.

If saving fails or its outcome is uncertain, re-read the target and distinguish unchanged old content, the intended new content, and an unrelated version. Report the actual outcome before retrying; never blindly replay an edit, create a duplicate topic, or restore over another writer.

### 6. Backups and latest-operation recovery

The registered backup root is `{userData}/Data/MemoryBackups/`, outside the active corpus. Separate scopes and operation batches. Ordinary memory tools do not expose it. Back up original bytes before replacement/deletion and record original absence for creation. One multi-file organization has one batch manifest recording before-state, intended after-hashes, and actual completed or incomplete steps. Recovery manifests are not a second Dreaming state store or a memory event log.

Each scope retains at most five batches and 20 MiB of backup payload plus manifests. Before admitting a mutation, account for its required backup and prune the oldest eligible completed batches to meet both limits. Do not prune an in-flight/recovering batch or the latest recoverable batch. If protected data and the required backup cannot fit, reject the write and explain the limit. The backup policy does not erase active memory.

Expose recovery of the latest recoverable mutation or organization batch. Preview affected files, confirm access and current versions, and back up the current state before recovery. Restore a file only if it still matches the recorded operation result. Undo creation only when that created content is unchanged; undo deletion only when the path remains absent. A same-name later file is a conflict. Recovery is itself a new controlled mutation.

Use a same-directory complete temporary file and safe replacement for updates. Temporary files never enter search or injection. Verify replacement/failure behavior on Windows, macOS, and Linux; do not equate safe replacement with a tested power-loss guarantee. Multi-file saving and recovery report partial success, unfinished steps, and conflicts, keeping the remaining recovery material.

### 7. Dreaming organization and triggers

"Generate memory in chats" and "Automatically organize memory" are independent global switches, both enabled by default. Store both in the existing preference configuration. Disabling generation stops only conversation extraction and invalidates its pending output; existing-file organization remains available. Disabling automatic organization leaves generation and explicit manual organization available. Use the application default model without a separate selector. Without a usable model, pause and expose the reason. Run only while the application is running and idle, with at most one maintenance task application-wide, yielding to foreground conversations. All requests obey scope authorization and the same resource limits.

| Trigger | Eligibility |
|---|---|
| Manual request | An explicitly selected authorized scope |
| Controlled edits | A file reaches 10 successful controlled content changes since its last successful check |
| Change plus waiting | Content differs from its processed hash and its earliest pending change is at least 7 days old; later changes do not reset that time |
| Capacity warning | Changed or unprocessed entry/topic reaches the warning limits above |

Scan only the bound scope. Observe external changes during scope reconciliation, start waiting from their first observation, and do not infer how many edits occurred while the application was closed. Reopening evaluates present conditions rather than replaying every missed time slot. An already checked unchanged file does not repeatedly trigger because it remains large or the previous check proposed no edits.

Fully read the entry and relevant topics, including related files missing from entry links. Select changed files first and rotate remaining work across batches; unprocessed files are not marked complete. The batch input and one-call limits above apply to all selected file bodies. Respect the chosen model's context/output limits, reduce the selected batch when needed, and reject incomplete output rather than applying truncated content.

The model proposes deduplication, shorter wording, merging, or splitting while preserving facts, conditions, and real source references. Small independent files remain. Conflicting or unverified claims remain with their uncertainty; age or repetition alone does not decide truth. Dreaming neither clears a scope nor changes `SOUL.md`/`USER.md`, reads old JOURNAL/chat history, accesses other scopes or the network, nor executes commands embedded in memory.

Inference holds no write lock. At commit, validate every relevant source and destination baseline, task generation, and authorization under the scope lock. Reject stale proposals. For merges, deletion sources and destinations must be distinct managed topic paths under `.memories/`; `MEMORY.md` is neither a deletion source nor a transfer destination. The prompt and proposal schema enforce the same path rule. Supply all active files, write a complete destination containing each deleted source verbatim including whitespace, update managed links, then remove fully transferred old content. A failed prerequisite stops dependent operations. If transfer cannot be established, keep the source. The program verifies versions and save results, not semantic equivalence.

After a successful unchanged check, record that input as processed. After mutations, record the actual final hashes so Dreaming does not rediscover its own output. Only completed files advance. Failures use bounded retry behavior and expose a reason; persistent failure cannot cause endless model calls. New input or an explicit manual request provides a new opportunity to check.

### 8. Persistent state, cancellation, and restart

The existing database is `{userData}/Data/cherrystudio.sqlite`, obtained through `application.getPath('app.database.file')`. Reuse existing stores:

| Information | Owner and store | Boundary |
|---|---|---|
| Processed hashes/times, earliest pending changes, controlled counts, reconciliation generations | Dreaming-owned `app_state` keys | Per scope/file; no body; accessed only through the owning module |
| Execution status, timestamps, errors, brief outcome | `job` through `JobManager` | Execution history is not the permanent processed-file list |
| Persistent scheduling and next run | `job_schedule` through existing scheduling APIs | Scheduler callbacks do not independently persist progress |
| Global generation/automatic-organization preferences and existing default model | `PreferenceService` | No per-file progress in preferences |
| Per-Agent/Assistant shared-access choice | Existing entity configuration | Presets carry switches, not memory bodies |

Follow [app_state ownership](../../../../docs/references/data/app-state-overview.md); register new owner keys when implemented. Add no memory table, separate database, or scheduler-state JSON file. The [JobManager](../../../../src/main/core/job/JobManager.ts) garbage-collects terminal jobs, so completed reconciliation markers survive independently. Register the Dreaming handler during its owner's lifecycle initialization and use startup recovery `abandon`. Scheduled wakeups re-evaluate eligibility; they never replay an old model result.

File replacement and SQLite progress are not one transaction. Confirm file outcomes before updating markers. On failure or restart, reconcile actual files with backup manifests and hashes. An apparently successful job row is insufficient evidence to skip unknown files; uncertain state remains pending, without exact reconstructed edit counts.

Cancellation, relevant permission revocation, disabling organization, clear, restore, or scope deletion invalidate affected pending tasks and uncommitted output. Disabling one caller's shared access invalidates that caller's receipts/approvals without granting or revoking another caller's access. Restart discards unfinished organization output. Already committed edits remain until explicit recovery. Show the last run time and actionable failures in settings; quiet checks add neither chat messages nor memory content.

### 9. Editor, clearing, initialization, and migration

Reuse the settings surface and IpcApi. Keep "Use shared memory" in Agent and Assistant forms, defaulting on and off respectively, in their existing configuration JSON. Presets carry switches, never memory bodies. Both forms use the existing basic-field row layout and compact switch; the Agent row follows the complete heartbeat section. Shared settings show independent generation and automatic-organization rows, each with the same hover/focus information icon used by Default Models → Quick Model. Show the recorded last completed/failed/cancelled result and time. Remove the file section, content previews, and Agent private-memory entry. Show "Restore backup" and "Clear global memory" as separate settings rows, using the same layout as chat generation. Place "Restore" and a red "Clear" button on the right of their respective rows. The generation tooltip explains default-model extraction from opted-in chats and the small possible token cost. Clearing and recovery require confirmation. Clear shows no filenames; its backend preview token still binds the exact affected files and versions. Recovery retains its file preview. Recovery shows Saved and clearing shows Cleared successfully, each beside its corresponding action button on the same row. Feedback reports actual commit outcomes, not index state or item counts. Page visibility changes only display; disabling caller runtime access stops subsequent shared injection and controlled tools but cannot retract sent context. Reads remain quiet; writes reuse tool results or approval-card feedback.

Shared clear internally previews and binds the exact managed file set and versions, acquires the scope lock, and rechecks before resetting the entry/removing topics. New or changed files require a refreshed preview; never delete files outside the confirmed token or unknown files. Keep private memory and old history intact. Clear has its own recoverable batch and invalidates old tasks, receipts, and approvals. Partial failures report what remains. Explain that recoverable backups persist; permanent backup erasure requires separate explicit scope and authorization.

Initialize missing roots/entry without overwriting existing files. Complete-data backup and migration include active files, recovery batches, and matching database state while coordinating application writes. Complete restore invalidates old tasks/read receipts and establishes a new baseline from restored files instead of trusting mismatched old markers.

Back up and inspect old FACT before migration. Move complete common facts into the entry and detail, conditions, and sources into private topics; no private facts are automatically promoted to shared memory. Verify preservation before switching prompt loading, native tool targets, initialization, and built-in templates together. An incomplete migration keeps recoverable originals and does not activate a half-migrated scope. Old FACT remains historical and exits normal reads/writes; JOURNAL stays unchanged and stops receiving events. Unknown files are not overwritten or removed. No dual writes or alternating old/new-version compatibility is promised.

### 10. Integration and delivery boundary

| Existing integration | Required change |
|---|---|
| [Agent directory setup](../../../../src/main/ai/agents/agentDataDirectory.ts), [prompt builder](../../../../src/main/ai/agents/prompt.ts), [built-in provisioning](../../../../src/main/ai/agents/builtin/BuiltinAgentProvisioner.ts) | Coordinate new layout, eligible entry loading, templates, and FACT/JOURNAL cutover |
| [Path registry](../../../../src/main/core/paths/pathRegistry.ts) and existing file/IPC facilities | Register roots and provide the shared controlled read/save/recovery owner |
| Pi and Claude Code adapters above | Route supported native operations through that owner and preserve actual read/approval bindings |
| Existing job and state facilities above | Add Dreaming's owner-private markers, handler, scheduling, cancellation, and feedback |
| Existing settings and file-management surfaces | Expose independent switches with information tooltips, actual results, confirmed global clearing, and latest recovery; no file section |

Implement save protection and recovery before enabling model mutations, then runtime loading/access, editor/migration, and Dreaming. This Spec remains one document PR. Any later implementation layers must refer to its ACs and follow the repository's Spec approval workflow. No product behavior or existing reference documentation is changed by this Spec.

## Alternatives considered

- A new dedicated memory MCP: rejected to keep the existing file-tool interaction; program-enforced protection still requires runtime adaptation.
- Prompt-only backup/version instructions or a file watcher: rejected because neither guarantees a pre-change backup or atomic admission of controlled edits.
- A hash or YAML version as the modification counter: rejected because content equality cannot reconstruct edit history and model-edited metadata cannot enforce concurrency.
- One file per fact or an exhaustive entry index: rejected because small complete facts fit the entry and related knowledge belongs together; independent small topics remain allowed.
- A new content database, event log, or permanent job-history index: rejected because Markdown owns content and existing owner-private state plus execution facilities cover this scope.
- Full history UI and bulk conversation backfill: deferred. The extraction layer uses authorized new completion events and bounded verbatim evidence instead.

## Acceptance criteria

- AC1 — Shared and private entries/topics use the specified layout; hidden topics remain listable, searchable, exportable, and backed up on all supported platforms, while history, backups, temporary files, and unknown files stay outside the active corpus. (verification: unit + Electron; owner: memory storage)
- AC2 — Each caller receives only its eligible scope; opted-out, foreign-Agent, temporary/headless, and external-channel shared access is denied without leaking names or snippets, including through traversal or reparse paths. (verification: unit + runtime integration; owner: runtime adapters)
- AC3 — New turns, resume, and compaction reload eligible entries without duplicate identity/context blocks; an entry-only request cannot read or claim to save a topic, and truncation is explicit without overwriting full content. (verification: runtime integration + representative model tasks; owner: prompt integration)
- AC4 — Every supported native mutation uses the actual caller-bound full-read baseline and approved content; stale, missing, cross-session, ambiguous, or revoked baselines are rejected, including create/delete/rename cases and automatic approval modes. (verification: unit + runtime integration; owner: runtime adapters and memory storage)
- AC5 — Backup failure or capacity exhaustion leaves original files intact; uncertain save outcomes are inspected before retry, and successful controlled updates expose their actual final hashes and recovery batch. (verification: filesystem fault injection + Windows/macOS/Linux native checks; owner: memory storage)
- AC6 — Each scope respects both 5-batch and 20-MiB limits without pruning protected recovery data; latest-operation recovery handles creation/deletion and partial batches without overwriting later content or a later same-name file. (verification: unit + filesystem fault injection + Electron; owner: memory storage and memory editor)
- AC7 — Entry/topic saves enforce the stated line/byte limits, preserve oversized external originals, and never use an incomplete read as the basis for replacement. (verification: unit + renderer; owner: memory storage and memory editor)
- AC8 — Generation and automatic organization are independent, default-on switches using the application default model. Disabling generation fences only extraction output; automatic/manual organization continues. Disabling automatic organization still permits extraction and manual requests. Organization triggers obey authorization, idle execution, global single-task concurrency, and batch budgets. (verification: unit with controlled time + runtime integration; owner: Dreaming)
- AC9 — Identical, failed, metadata-only, Dreaming, and recovery saves do not increase the controlled edit count; external/crash gaps are pending without fabricated counts, and unchanged checked files do not repeatedly invoke the model. (verification: unit with controlled time and restart scenarios; owner: Dreaming)
- AC10 — Related topics merge only after receiving content and managed links succeed; unrelated small topics, factual conditions, and real sources survive representative organization tasks, and partial failure keeps untransferred sources recoverable. (verification: fault injection + representative model tasks; owner: Dreaming and memory storage)
- AC11 — Successful and unchanged checks persist only completed file markers independently of job-history cleanup; crash reconciliation never replays stale output or treats mismatched file/database state as completed work. (verification: real SQLite integration + filesystem fault injection; owner: Dreaming)
- AC12 — Cancel, disable, relevant revocation, clear, restore, deletion, and restart prevent affected uncommitted results from applying; already committed changes and other callers' permissions are preserved, with actionable feedback outside ordinary chat. (verification: unit + runtime integration + Electron; owner: Dreaming and memory editor)
- AC13 — Settings show two independent options with hover/focus explanations, no file section, content preview, or Agent private-memory entry. Keep latest recovery and a red clear button with confirmation and a version-bound backend preview token; no file list in the clear dialog. Preserve unknown/private/history files and report actual partial results without index state or item counts. Last-run outcomes stay accurate across state changes. Full backup/restore includes active memory, recovery batches, and coherent state. (verification: renderer + Electron + restore scenarios; owner: memory settings and backup integration)
- AC14 — FACT migration preserves facts, conditions, and sources before coordinated cutover; JOURNAL remains unchanged, old facts are not dual-written, partial migration does not activate, and independent graph-memory/Knowledge Base behavior remains intact. (verification: migration fixtures + affected runtime integration; owner: migration integration)
- AC15 — Existing-file organization never reads chat history, old JOURNAL, other scopes, identity files, or network sources. Conversation extraction is isolated to newly completed, explicitly authorized source messages; ordinary controlled conversation saves remain available independently. (verification: runtime integration + representative model tasks; owner: Dreaming and runtime adapters)
- AC16 — The global generation switch admits only new successful authorized desktop Agent/Assistant turns; no historical scan, channel, headless, synthetic, or assistant/tool-content extraction occurs. The automatic-organization switch does not disable extraction. (verification: real-database runtime integration; owner: memory extraction)
- AC17 — Source edits/deletion, ownership or permission changes, off/on, clear, recovery, cancellation, and restart prevent stale extraction writes. Shared candidate classification excludes project/customer/uncertain categories, without claiming semantic certainty. Exact source quotes, input/output limits, durable cursors, and recoverable append-only commits prevent unsupported proposals, duplicate replay, and existing-fact replacement. (verification: real-database/filesystem integration + representative model tasks; owner: memory extraction)

## Risks

- Native hooks and approval APIs are not filesystem isolation. Direct disk access remains outside the controlled guarantee until per-platform enforcement is demonstrated; unsupported operations must not be advertised as protected writes.
- External edits can race application locks, and file/SQLite commits can diverge after failure. Reconciliation and conflict-aware recovery reduce loss without promising a multi-file transaction or power-loss durability.
- Automatic organization uses model quota and may misclassify facts or lose conditions. Default-model reuse, bounded batches, quiet no-op checks, recoverable originals, and representative task validation limit the impact; backups do not prove semantic correctness.
- Five batches and 20 MiB bound recovery storage but may block writes when protected material fills the scope budget. The editor must explain the failure rather than remove protected history or silently omit a backup.
- FACT migration and the end of JOURNAL writes change the persistent contract. Preserve originals and coordinate every consumer; retained historical files do not make old/new application versions interchangeable.
