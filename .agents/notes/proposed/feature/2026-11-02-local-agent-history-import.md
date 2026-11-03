# Agent Note: Local agent conversation history import

Status: proposed

English | [中文](2026-11-02-local-agent-history-import.zh.md)

## Problem

Users accumulate conversations in Claude Code, Codex, OpenCode, and WorkBuddy outside Cherry Studio. They need to review those conversations and continue work in the recorded working directory.

[Issue #22728](https://github.com/CherryHQ/cherry-studio/issues/22728) describes this source-import capability. Users choose an existing Agent as the destination. Each source conversation becomes a separate Agent Session with its own working-directory binding. It overlaps with the preview and workspace mapping in [#19002](https://github.com/CherryHQ/cherry-studio/issues/19002), without restoring external permissions, pending actions, or file snapshots.

## Proposal

### Destination and entry point

Expose **Settings → Import external application data → Import local application data → source application**. Add the local-application group inside the existing external-import page. Each source opens a shared import wizard. Show an enabled source only after its implementation is complete; existing web-export import entries retain their purpose.

| Source | Target Agent | Destination |
|---|---|---|
| Claude Code | User-selected existing Agent | One Agent Session per selected source conversation |
| Codex | User-selected existing Agent | One Agent Session per selected source conversation |
| OpenCode | User-selected existing Agent | One Agent Session per selected source conversation |
| WorkBuddy | User-selected existing Agent | One Agent Session per selected source conversation |

Require the user to choose one existing Agent for each import batch. All selected source conversations become separate sessions under that Agent. Different sources may share a target Agent. Use its stable ID, not its name or the source name. The importer never creates an Agent or changes its name, instructions, model, permissions, or other configuration.

List active Agents and show whether their runtimes support imported-history initialization. An unsupported target remains unavailable with an explanation. If no suitable Agent exists, ask the user to create or configure one through the normal Agent workflow, then return to import. A target in the recycle bin must be restored or replaced by another selection. Changing the target requires a new preview; a deleted target blocks the remaining import and never triggers automatic creation.

### Working-directory binding

Choose the workspace per Agent Session, independently of the selected Agent. The Agent's default directory does not override a recorded source directory or the “No work directory” rule.

| Source state | Import behavior |
|---|---|
| A usable local directory is recorded | Preview it, then register or reuse a user workspace and bind the session |
| No directory is recorded | Display “No work directory” and use the existing system-workspace mechanism |
| The directory is missing or inaccessible | Show the original path; require a replacement directory or skip the session |
| The path belongs to another platform | Require a valid local mapping before import |
| Multiple or changing directories are recorded | Resolve the source's primary directory; require a preview choice if ambiguous |

Do not silently treat a broken recorded path as absent. Do not infer the working directory from the transcript's storage directory. Sources use their validated `cwd`, `directory`, or equivalent field. Reuse a user workspace for the same normalized path. Binding neither copies the project nor writes into the source directory.

[The workspace contract](../../../../src/shared/data/api/schemas/agentWorkspaces.ts) represents “No work directory” as `{ type: 'system' }`. A session still has a workspace record, and its runtime may materialize a Cherry-managed internal directory. Do not introduce a null path or a third workspace type.

[The session contract](../../../../src/shared/data/api/schemas/agentSessions.ts) prevents workspace changes after messages exist. Finish mapping before inserting messages, recheck it on confirmation, and retain normal runtime validation before execution. A path that becomes invalid returns the affected session to preview.

### Storage ownership and ordering

Use `agent`, `agent_session`, `agent_session_message`, and `agent_workspace`. An imported conversation is an `AgentSession` with type `conversation`, not an Assistant Topic. Agent messages are a flat sequence; do not create the ordinary-chat virtual root or use `parentId` / `activeNodeId` as persistence fields.

| Existing owner | Reuse or extension |
|---|---|
| [AgentService](../../../../src/main/data/services/AgentService.ts) | Read and validate the selected existing Agent and its runtime; do not call `createAgentTx` or update Agent configuration |
| [AgentSessionService](../../../../src/main/data/services/AgentSessionService.ts) | Use `createTx` for ownership, historical creation time, and workspace binding; add import metadata and activity handling |
| [AgentWorkspaceService](../../../../src/main/data/services/AgentWorkspaceService.ts) | Reuse `findOrCreateByPathTx` and `createSystemWorkspaceForSessionTx` |
| [AgentSessionMessageService](../../../../src/main/data/services/AgentSessionMessageService.ts) | Add an import-specific batch contract for historical timestamps, source identity, and order |

The existing message batch writer uses the current time, and pagination orders by `createdAt, id`. For nondecreasing source times, preserve timestamps and allocate local IDs consistently for ties. Source-order/time conflicts require a shared ordering-contract decision in the first layer. That contract must cover both imported history and subsequent user/assistant turns. Either implement that extension or declare the input unsupported in preview. Never alter valid timestamps or repair order only in the renderer.

Valid, internally ordered source timestamps can still be later than the local clock, for example when the source computer is one day ahead. For an accepted session, new turns must follow all imported messages in persistence, pagination, reload, and native runtime history even when their timestamps are earlier. This case requires ordering independent of timestamps. Until that ordering is supported, reject the affected session in preview with a clock-skew explanation and recheck against the current local time before commit; failure creates no session rows. Preserve historical and new-message timestamps; do not clamp them or advance them for sorting.

Reuse the Agent Session list, search, lifecycle, and data-change notification paths. Domain services own their tables; the importer does not bypass their invariants.

### Read-only preview and command boundary

Use one adapter per source and one Main-owned import coordinator:

```ts
type Source = 'claude-code' | 'codex' | 'opencode' | 'workbuddy'

interface HistorySourceAdapter {
  source: Source
  discover(root: string, signal: AbortSignal): AsyncIterable<SessionRef>
  read(ref: SessionRef, signal: AbortSignal): Promise<NormalizedSession>
}

interface NormalizedSession {
  source: Source
  originalSessionId: string
  sourcePaths: string[]
  sourceVersion?: string
  title: string
  workingDirectory?: string
  messages: NormalizedMessage[]
  selectedBranchId?: string
  sourceFingerprint: string
  diagnostics: ImportDiagnostic[]
}
```

The schema above is a proposed internal contract. A normalized message carries its source ID, source order, available parent relation, role, content, model, and original timestamps. Diagnostics identify the file and line or database record, a reason code, and an explanation.

Expose typed IpcApi commands `discover`, `preview`, `commit`, and `cancel`. Scan results carry Main-generated references. Preview accepts the selected `targetAgentId`; Main validates that the Agent is active and its runtime supports import. Commit accepts only the preview ID, selected sessions, and workspace choices already represented in that preview. Main uses the target bound to the preview, validates window ownership and expiration, and rejects substituted Agent IDs or renderer-authored database rows.

Preview shows the destination Agent, title, parsed message count, recorded models, time range, source paths, original/final working directory, duplicate state, skips, degradations, and blocking findings. JSONL line counts are not message counts. Report known metadata separately from discarded conversation content.

Keep an immutable snapshot in Main memory: the selected target Agent ID and runtime type, messages, diagnostics, adapter version, every source dependency and fingerprint, and workspace choices. Codex inherited-history files belong to that dependency set. Stream JSONL with limits on line, session, and batch size; reject oversized selections before confirmation without silent truncation. Determine limits from first-layer fixtures.

Scanning and preview create no Agents, workspace rows, sessions, messages, persistent preview files, or source-store changes. Expiration, cancellation, and window close release memory. Revalidate the target Agent's active state and runtime compatibility, source fingerprints, workspace state, and preview version at confirmation. A target/runtime change or another invalidated input requires a new preview; write only the confirmed snapshot.

Return per-session outcomes: imported, already present, failed, or not processed. Count messages, skipped records, and degraded parts separately.

### Source readers

| Source | Store and parsing rules | Compatibility boundary |
|---|---|---|
| Claude Code | Read session JSONL under `CLAUDE_CONFIG_DIR` or `~/.claude/projects/`; read validated message content, UUIDs, parents, timestamps, and cwd | Evaluate the existing SDK's session readers first; retain a versioned raw reader if timestamps or line diagnostics are unavailable |
| Codex | Resolve titles from `session_index.jsonl`; discover supported histories under `sessions` and `archived_sessions` within `CODEX_HOME` or `~/.codex` | The index is not a complete inventory; distinguish message payloads from events and support only verified history layouts |
| OpenCode | Open the selected `opencode.db` read-only; read sessions, messages, parts, and directory in a consistent read transaction | Detect schema/version; include committed WAL data; never migrate, checkpoint, change journal mode, or create source-side files |
| WorkBuddy | Determine the desktop store, session fields, and working-directory field from sanitized samples of supported versions | CodeBuddy CLI documentation does not establish WorkBuddy desktop compatibility |

Claude Code documents [session storage](https://code.claude.com/docs/en/agent-sdk/sessions) and [SDK session readers](https://code.claude.com/docs/en/agent-sdk/typescript#getsessionmessages). Classify every raw record as a message, metadata, a known non-message event, or a diagnosed unsupported/broken record.

Codex's [name index](https://github.com/openai/codex/blob/main/codex-rs/rollout/src/session_index.rs) is append-only; the latest valid entry for an ID wins. Missing indexes must not hide supported sessions. Prefer `response_item` for conversation content and `turn_context` for model information; use `event_msg` for diagnostics/status, or an explicitly supported legacy fallback without duplicate content. Use a valid ordinal or source-file order, not timestamp sorting alone. See [persisted record types](https://github.com/openai/codex/blob/main/codex-rs/history/src/rollout_payload.rs).

Use the thread `id` from the index/session metadata, not the root `session_id` that branches may share. Reconstruct compressed, inherited, or multiple-rollout history only through verified version rules; otherwise block that session with a specific gap. Do not concatenate every file with the same ID. See [session identity](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/protocol.rs) and [rollout persistence](https://github.com/openai/codex/blob/main/codex-rs/rollout/src/recorder.rs).

OpenCode's [storage guide](https://dev.opencode.ai/docs/troubleshooting/#storage) allows custom database locations. Its [development schema](https://github.com/anomalyco/opencode/blob/dev/packages/core/src/session/sql.ts) includes `session_v2`, `session_message`, and `session_part`, with message `seq` and part `ordinal`. Do not assume these names cover every release. Reject unknown schemas. If side-effect-free reading is unavailable, require the source application to close or a consistent offline copy; copying only a live database file is insufficient.

Tencent's [directory documentation](https://cloud.tencent.cn/document/product/1831/137016) describes CodeBuddy Code. WorkBuddy requires separate validation of session discovery, messages, times, directory, external tool output, and subagents. Investigate its format before enabling its source entry.

All adapters allow explicit store selection. Register default store paths under `external.*` in [the path registry](../../../../src/main/core/paths/pathRegistry.ts), preserving no-auto-create behavior. Do not scan the entire user home or read account secrets. Store paths and working directories are different inputs.

### Message projection and continuation

| Source content | Imported representation |
|---|---|
| User/assistant text | Preserve text, original message boundaries, and timestamps in matching roles |
| Available reasoning text | Use existing reasoning parts and report renderer/runtime compatibility limits |
| Tool calls and results | First version stores labeled historical text with name, arguments, output, and errors |
| System instructions and compaction records | Historical notes or compatibility findings; never replace current Agent instructions |
| File/image references | Historical reference text with missing, unsupported, and not-copied findings; no automatic download |
| Unknown types or invalid JSON | Diagnose the location and continue parsing recoverable content |

Match tool results by call ID, never as user speech. Unmatched results remain labeled historical notes. Do not import pending tools, approvals, or generation state. Explicitly completed, failed, and interrupted messages use `success`, `error`, and `paused`.

Project one selected source branch into the flat Agent Session. Use an explicit active branch when available; otherwise require a preview choice. Report other branches as not imported. Independently recoverable subagent sessions are separate candidates under the selected target Agent. Never concatenate mutually exclusive branches.

Convert valid times to UTC milliseconds while preserving raw source strings. For missing/invalid times, use the preceding valid time on the selected path, or a valid session-start time for the first message. Mark inferred values in preview; if no basis exists, block that session. Preserve source message identity and inference markers in typed message provenance, not in body text. Set session activity from historical activity; preserve the existing Agent's creation time.

Record complete historical model information in `messageSnapshot.model`. Leave `modelId` empty when no local model matches, and display missing information as unrecorded. Do not create fake model/account configuration. Historical references remain inert text and follow existing Markdown rendering rules.

Continuation is part of the first implementation layer. Saving visible messages alone does not establish runtime context. Use the selected Agent's runtime; never switch it to Pi or infer it from the source application. Each supported target runtime must initialize Cherry-owned history. For Pi targets, reuse the conversion capability in [existing Pi history handling](../../../../src/main/ai/runtime/pi/retiredSessionHistory.ts) through an independent entry point; do not impersonate retired-runtime migration or reuse external resume tokens. Declare the supported target-runtime matrix before implementation and explain unsupported targets in the selector.

Use the selected Agent's current instructions, model-selection rules, and permissions. History can be imported without a usable model, but continuation requires selecting one through the normal workflow. Initialize Cherry-owned native history after confirmation, without a model request or historical tool execution. Reuse `app_state` for an internal, retryable initialization marker committed with the session; business source identity stays on the session.

Native-file publication and SQLite commit are separate. Use a stable target native-session ID, validated temporary output, and a committed association. Retrying must not duplicate history. If initialization fails, keep history readable, expose retry, and block a context-free request. [The runtime host](../../../../src/main/ai/agentSession/AgentSessionRuntimeService.ts) must admit the first real turn only after the imported history is available. Verification inspects actual model input, not just rendered messages. Current Cherry permissions apply.

### Identity and atomic commit

The destination is the existing Agent ID selected by the user and bound to the preview. Do not add an Agent source marker, source-to-Agent mapping, or source-Agent uniqueness constraint. Source identity belongs to imported sessions and does not determine their owner.

Add nullable `importMetadata` to `agent_session`:

```ts
interface AgentSessionImportMetadata {
  version: 1
  source: Source
  originalSessionId: string
  sourcePaths: string[]
  sourceVersion?: string
  originalWorkingDirectory?: string
  sourceFingerprint: string
  importedAt: string
  adapterVersion: number
  report: { skippedRecords: number; downgradedParts: number }
}
```

Keep the active directory in `workspaceId`; the original path is provenance, not a parallel workspace state. Add a unique expression index on `source + originalSessionId`, including sessions in the recycle bin, independent of the chosen Agent. Changing targets does not create a second copy or move an existing import; report the existing session and its current owner. Existing sessions without metadata remain unaffected. Paths and content hashes are not identities. Reject sources without a verified stable ID.

| Case | Result |
|---|---|
| Reimport an existing session, including with another target | Return the existing session and owner; do not copy or move it |
| Source history grows | Report already imported; no automatic append or overwrite |
| Selected Agent or existing imported session is in the recycle bin | Require an active target or restoration as applicable; do not silently recreate imported history |
| Session was permanently deleted | Allow reimport under the selected valid Agent |
| User renamed an Agent or moved a session | Preserve those changes; reimport does not move it back |
| User duplicates or forks a session | Clear the new session's unique import identity |
| Conflicting copies claim one source ID | Report a conflict without merging silently |

Use one synchronous `DbService.withWriteTx` per source session. Each transaction revalidates the selected Agent's active state and runtime compatibility, then creates necessary workspace records, the session with that `agentId`, messages, provenance, and the initialization marker together. Failure rolls back that session's writes; the existing Agent and its other sessions remain intact. Sessions commit independently. Cancellation or target invalidation stops subsequent sessions; report what was already committed.

Read files, parse, validate directories, and calculate fingerprints outside the write transaction. No `await`, file writes, or network calls occur inside it. Compose the owning services' Tx methods and publish their events only after commit. Never break a large session into separately committed chunks to evade transaction limits.

Append migrations for session metadata and uniqueness constraints; do not add an Agent source marker or an import-ledger table. Cover populated databases, recycle-bin behavior, duplication, restore, and backup-merge conflicts. Preserve source identity during backup restore rather than deleting it to evade conflicts.

### Implementation ownership and stack

Place the source adapters, diagnostics, normalization, and Main preview coordinator in `src/main/services/conversationImport/`. Put cross-process commands in `src/shared/ipc/schemas/conversationImport.ts` with matching handlers/registration. The coordinator uses the existing lifecycle container.

Extend [ImportMenuSettings](../../../../src/renderer/pages/settings/DataSettings/ImportMenuSettings.tsx) with a local-application group and a shared dialog for target Agent selection, session selection, directory mapping, preview, and results. Use `@cherrystudio/ui`, i18next, and settings-search integration. Main must not import the renderer's web importer.

Data changes belong to the Agent Session, message, and workspace owners identified above; the Agent owner supplies destination validation. Extend session schemas and typed message provenance. Runtime history initialization belongs to the runtime host and the selected runtime's adapter. Include path registration, migrations, backup compatibility, and post-commit notifications with their owning changes.

This bilingual Spec is the bottom documentation PR. After explicit human Approval on its current head, implement four source layers sequentially with gh-stack:

```text
main
  <- codex/local-history-import/design
  <- codex/local-history-import/claude-code
  <- codex/local-history-import/codex
  <- codex/local-history-import/opencode
  <- codex/local-history-import/workbuddy
```

| Layer | Source | Complete slice | Regression scope |
|---|---|---|---|
| 1 | Claude Code | Shared UI/contracts, target Agent selection, directory rules, migrations, atomic writer, supported target-runtime history initialization, and Claude reader | Complete import and continuation; no pre-confirmation writes; no duplicates |
| 2 | Codex | Index and history versions, event deduplication, thread identity, and cwd | Codex plus affected Claude behavior |
| 3 | OpenCode | Schema detection, consistent read-only database reader, ordering, and directory | OpenCode plus affected earlier sources |
| 4 | WorkBuddy | Verified desktop format, message and directory mapping | WorkBuddy and the complete four-source contract |

Common foundations ship with layer 1, not a fifth implementation layer. Create each branch before writing its source-specific code; validate and commit it before adding the next. WorkBuddy research may happen earlier, but its implementation remains last. If the Spec merges first, rebase the first implementation onto main.

Each implementation PR targets the preceding branch and maps its verified AC IDs to this Spec. Changes to shared lower-layer behavior go back to their owner, followed by upstack rebase and affected verification. Material Spec changes require renewed Approval. Use `gh stack view --json` to verify topology. Keep this note proposed until cumulative evidence covers every AC; then the final layer transitions it to implemented.

## Alternatives considered

| Alternative | Reason not selected |
|---|---|
| Create an Assistant and ordinary Topics | Does not meet Agent ownership and per-session working-directory behavior |
| Automatically create an Agent per source or transcript | The user chooses an existing destination; automatic creation bypasses that choice |
| Merge all source histories into one session | Mixes tasks and directories; preserve separate source sessions |
| Apply the target Agent's default directory to every import | Overrides recorded directories and the explicit No work directory state |
| Select an Agent by source or display name | Names are mutable and non-unique; use the user's explicit selection and stable ID |
| Persist visible messages only | Does not guarantee runtime continuation has historical context |
| Implement each source's preview and writer independently | Duplicates identity, timestamp, and transaction semantics |
| Deliver all readers in one implementation PR | Prevents the required sequential, source-specific review |
| Automatically append or overwrite on reimport | Requires reconciliation with source branches and subsequent Cherry messages; defer incremental sync |

## Acceptance criteria

- AC1 — The settings path exposes only completed source entries under Import external application data → Import local application data. (verification: renderer navigation and settings search)
- AC2 — Import requires an explicit existing Agent selection and binds all newly imported sessions in the batch to it, without creating Agents or changing their configuration. (verification: unit database fixtures and renderer selection/empty-state cases)
- AC3 — Each source conversation becomes a separate Agent Session, without ordinary Topics or mixed histories. (verification: unit multi-session fixtures)
- AC4 — Recorded working directories bind correctly, and equivalent normalized paths reuse a user workspace. (verification: unit workspace and session relations)
- AC5 — Absent working directories display No work directory and use the existing system-workspace semantics. (verification: unit and renderer)
- AC6 — Missing, inaccessible, and foreign-platform directories require preview mapping or skipping, without silent fallback. (verification: unit and Electron directory fixtures)
- AC7 — Repeated/concurrent imports, including different target selections, create no duplicate sessions; selection uses Agent IDs despite equal names, and existing imports retain their owner. (verification: unit concurrency, cross-target, rename, and namesake fixtures)
- AC8 — Empty input, cancelled previews, all-duplicate batches, and failed transactions leave no empty session or workspace and do not create or alter Agent configuration. (verification: unit state and source-directory comparisons)
- AC9 — Imported content, valid timestamps, and supported source order remain consistent through persistence, pagination, and reload. With source timestamps one day ahead of the local clock, either new user/assistant turns remain after all imported history without changing timestamps, or preview rejects the session and commit rechecks before any session writes. (verification: unit clock-skew/ordering fixtures with controlled time and renderer paging/reload)
- AC10 — Invalid JSON and unknown records have actionable locations/reasons while recoverable messages still import. (verification: unit mixed-record fixtures)
- AC11 — A failed session rolls back atomically; cancellation retains committed sessions and starts no subsequent session. (verification: unit fault injection and cancellation)
- AC12 — Changed sources/directories, a changed or deleted target, incompatible runtime changes, or expired previews require renewed selection/preview; foreign-window tokens and substituted target IDs are rejected. (verification: unit and renderer boundary checks)
- AC13 — Codex indexes/events do not duplicate content, and shared root-session IDs do not merge distinct threads. (verification: unit missing-index and fork fixtures)
- AC14 — OpenCode reads supported schemas including committed WAL data and clearly rejects unknown schemas. (verification: unit real SQLite fixtures)
- AC15 — WorkBuddy support is limited to desktop formats and directory fields verified by declared versioned samples. (verification: unit versioned adapter fixtures)
- AC16 — Opening/importing history never executes historical tools, requests approvals, or starts generation. (verification: unit runtime boundaries and Electron)
- AC17 — First continuation uses the selected Agent's configuration and includes imported history before the new user message in model input, including accepted clock-skew cases; unsupported target runtimes are explained before import, and initialization failures are retryable without duplicated history. (verification: unit captured model input with controlled time, target-runtime compatibility, and recovery faults)
- AC18 — Imported sessions support search, duplication, trash, and restore; duplicates do not inherit unique import identity. (verification: unit existing data-service integration)
- AC19 — Forward migration and backup round trips retain provenance, ownership, and workspaces; merge conflicts are explicit. (verification: unit populated-database migration and restore fixtures)
- AC20 — Windows, macOS, and Linux satisfy path mapping and read-only source access, with simulations and native evidence distinguished. (verification: unit platform cases and platform-native Electron)
- AC21 — The Spec is followed by four gh-stack implementation layers ordered Claude Code, Codex, OpenCode, WorkBuddy, each with a scoped diff. (verification: docs gate and gh stack topology/diff inspection)

Use `setupTestDatabase()` for database cases and explicit affected-test paths per layer. Native platform checks are not replaced by platform simulations. These criteria are future product verification, not evidence supplied by this documentation PR.

## Risks

| Risk or open choice | Required resolution |
|---|---|
| Target runtime compatibility | Use the selected Agent's runtime; define and verify its history initializer before enabling selection, without silently changing Agent configuration |
| Timestamp rollback or source clock ahead | Decide the shared ordering extension or explicit input rejection before the first implementation; include the history-to-continuation boundary and commit-time recheck, without falsifying timestamps |
| Missing directories | Resolve before inserting messages because existing sessions with messages cannot change workspace |
| Native-file/database consistency | Use persistent initialization markers, stable native identity, validated output, and retry recovery |
| WorkBuddy and upstream drift | Obtain desktop samples and pin supported versions; development schemas are not release-wide promises |
| Tool and attachment fidelity | Review the first-version text/reference degradation; disclose every omitted artifact |
| Large inputs | Establish line, session, and batch limits from fixtures before exposing import |
| Backup merges | Preserve identity constraints and report conflicts without silently merging or removing provenance |
| Overlap with #19002 | Reuse shared preview and mapping capabilities where appropriate; retain the four-source implementation sequence |

Outstanding implementation choices are the supported target-runtime matrix, handling of source-time rollback and timestamps ahead of the local clock, and first-version tool/attachment fidelity. Reimport defaults to skip regardless of the chosen target; incremental synchronization is separate work. Source-version matrices, WorkBuddy samples, and input limits must be completed before claiming support. Do not close #22728 as delivered until all four sources satisfy the complete acceptance criteria.
