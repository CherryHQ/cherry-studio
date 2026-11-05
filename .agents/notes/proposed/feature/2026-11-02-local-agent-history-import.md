# Agent Note: Local agent conversation history import

Status: proposed

English | [中文](2026-11-02-local-agent-history-import.zh.md)

## Problem

Users accumulate conversations in Claude Code, Codex, OpenCode, and WorkBuddy outside Cherry Studio. They need to review those conversations and continue work in the recorded working directory.

[Issue #22728](https://github.com/CherryHQ/cherry-studio/issues/22728) describes this source-import capability. Users choose an existing Agent as the destination. Each source conversation becomes a separate Agent Session with its own working-directory binding. It overlaps with the preview and workspace mapping in [#19002](https://github.com/CherryHQ/cherry-studio/issues/19002), without restoring external permissions, pending actions, or file snapshots.

## Proposal

### Destination and entry point

Expose **Settings → Data settings → Import local application data → source application**. Keep Import external application data and Import local application data in separate settings groups. Each source opens a shared import dialog. Show an enabled source only after its implementation is complete; existing web-export import entries retain their purpose. Give local sources their application icons and the spacing used by other settings rows.

Opening a source automatically discovers its default history location. Allow a manual location override when needed. Use the source conversation title, falling back to the first real user message and then a source/date label. Keep titles on one line with the full title available on hover. Use cards at least 80 px tall with a hover shadow. Select all applies to the currently displayed search results, up to 100 candidates; retain selections outside the filter without exceeding the batch limit.

Keep one primary action, Import selected conversations. It runs read-only validation and then commits valid selections; do not add a separate Preview button or require another confirmation screen. Retain the internal preview contract below. Unsupported targets remain disabled and explain that only Pi Agents are supported.

| Source | Target Agent | Destination |
|---|---|---|
| Claude Code | User-selected existing Agent | One Agent Session per selected source conversation |
| Codex | User-selected existing Agent | One Agent Session per selected source conversation |
| OpenCode | User-selected existing Agent | One Agent Session per selected source conversation |
| WorkBuddy | User-selected existing Agent | One Agent Session per selected source conversation |

Require the user to choose one existing Agent for each import batch. All selected source conversations become separate sessions under that Agent. Different sources may share a target Agent. Use its stable ID, not its name or the source name. The importer never creates an Agent or changes its name, instructions, model, permissions, or other configuration.

First-version import targets are active Pi Agents only. List other Agents but disable unsupported runtimes with a reason. Never change an Agent's runtime. If no suitable target exists, guide normal Agent creation or configuration. A trashed target must be restored or replaced. Changing targets requires a fresh preview; deletion stops remaining imports without creating an Agent.

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

The first version preserves original timestamps. WorkBuddy reuses the existing message `provenance.sourceOrder` for a fixed imported prefix; native continuation follows under the existing `createdAt, id` rule. Main-process pagination, anchors, edit/fork boundaries, export and Pi history initialization use this order. Forks preserve message provenance without copying session-level import identity. No new table, column or data migration is required. Other sources retain their current ordering and timestamp rejection.

Future source timestamps are rejected during preview and before any commit writes. Check the maximum timestamp across all messages, not the last record. If it equals the current millisecond, wait outside the transaction and recheck. Display, date filtering and global search use original timestamps. Preview uses the minimum/maximum time; imported session activity uses the maximum.

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

Expose typed IpcApi commands `discover`, `preview`, `commit`, `cancel`, and `retry_initialization`. Scan results carry Main-generated references. Preview binds the active Pi target, selected branches, and directory choices. Commit accepts only the preview ID and selected sessions. Main validates window ownership, expiry, and the bound target; reject substituted Agent IDs and renderer-authored database records. Initialization retries use persisted session IDs.

The internal preview returns the destination Agent, title, parsed message count, recorded models, time range, source paths, original/final working directory, duplicate state, skips, degradations, and blocking findings. The dialog uses these findings to import valid sessions and explain failures. JSONL line counts are not message counts. Report known metadata separately from discarded conversation content.

Show errors in a separate dialog, grouped by session with duplicate reasons combined and enough space between findings. Focus its heading when it opens. Offer branch or directory choices only when they can resolve that session's blocking findings. A definitively unsupported or damaged session shows its terminal reasons, without unrelated conflict choices or retry. Remove it from pending selections. If every failed session is terminal, offer only Close. Mixed batches retain successful results and allow retries only for unresolved, recoverable selections. Failed native-history initialization remains separately retryable for the already saved session.

Keep an immutable Main-memory snapshot of the selected Agent/runtime, messages, diagnostics, adapter version, workspace choices, and every source dependency and fingerprint, including Codex inherited history. Previews expire after 15 minutes. Stream JSONL with limits of 4 MiB per line, 32 MiB per session, and 100 sessions and 128 MiB per batch. Check input and normalized sizes separately. Reject excess before confirmation without truncation. Enable the entry only after first-layer boundary and memory fixtures pass.

Scanning and preview create no Agents, workspace rows, sessions, messages, persistent preview files, or source-store changes. Expiration, cancellation, and window close release memory. Revalidate the target Agent's active state and runtime compatibility, source fingerprints, workspace state, and preview version at confirmation. A target/runtime change or another invalidated input requires a new preview; write only the confirmed snapshot.

Return per-session outcomes: imported, already present, failed, or not processed. Count messages, skipped records, and degraded parts separately.

### Source readers

| Source | Store and parsing rules | Compatibility boundary |
|---|---|---|
| Claude Code | Read session JSONL under `CLAUDE_CONFIG_DIR` or `~/.claude/projects/`; read validated message content, UUIDs, parents, timestamps, and cwd | Evaluate the existing SDK's session readers first; retain a versioned raw reader if timestamps or line diagnostics are unavailable |
| Codex | Resolve titles from `session_index.jsonl`; discover supported histories under `sessions` and `archived_sessions` within `CODEX_HOME` or `~/.codex` | The index is not a complete inventory; distinguish message payloads from events and support only verified history layouts |
| OpenCode | Open the selected `opencode.db` read-only; read sessions, messages, parts, and directory in a consistent read transaction | Detect schema/version; include committed WAL data; never migrate, checkpoint, change journal mode, or create source-side files |
| WorkBuddy | Join the desktop `workbuddy.db` session index with `projects/<project-key>/<session-id>.jsonl`; read the recorded cwd | Windows desktop 5.9.3 and its observed 2.165.0 runtime supply initial evidence; cloud indexes alone are insufficient; ordering remains a prerequisite |

Claude Code documents [session storage](https://code.claude.com/docs/en/agent-sdk/sessions) and [SDK session readers](https://code.claude.com/docs/en/agent-sdk/typescript#getsessionmessages). Classify every raw record as a message, metadata, a known non-message event, or a diagnosed unsupported/broken record.

Codex's [name index](https://github.com/openai/codex/blob/main/codex-rs/rollout/src/session_index.rs) is append-only; the latest valid entry for an ID wins. Missing indexes must not hide supported sessions. Prefer `response_item` for conversation content and `turn_context` for model information; use `event_msg` for diagnostics/status, or an explicitly supported legacy fallback without duplicate content. Use a valid ordinal or source-file order, not timestamp sorting alone. See [persisted record types](https://github.com/openai/codex/blob/main/codex-rs/history/src/rollout_payload.rs).

Use the thread `id` from the index/session metadata, not the root `session_id` that branches may share. Reconstruct compressed, inherited, or multiple-rollout history only through verified version rules; otherwise block that session with a specific gap. Do not concatenate every file with the same ID. See [session identity](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/protocol.rs) and [rollout persistence](https://github.com/openai/codex/blob/main/codex-rs/rollout/src/recorder.rs).

OpenCode's [storage guide](https://dev.opencode.ai/docs/troubleshooting/#storage) allows custom database locations. Its [development schema](https://github.com/anomalyco/opencode/blob/dev/packages/core/src/session/sql.ts) includes `session_v2`, `session_message`, and `session_part`, with message `seq` and part `ordinal`. Do not assume these names cover every release. Reject unknown schemas. If side-effect-free reading is unavailable, require the source application to close or a consistent offline copy; copying only a live database file is insufficient.

Tencent's [directory documentation](https://cloud.tencent.cn/document/product/1831/137016) describes CodeBuddy Code, not the WorkBuddy desktop format. The desktop investigation below replaces the earlier missing-sample assumption. It does not establish implementation readiness or compatibility with every release.

All adapters support automatic default-store discovery and explicit store selection. Register default store paths under `external.*` in [the path registry](../../../../src/main/core/paths/pathRegistry.ts), preserving no-auto-create behavior. Do not scan the entire user home or read account secrets. Store paths and working directories are different inputs.

### WorkBuddy desktop investigation and proposed reader

#### Evidence and supported scope

Read-only inspection on 2026-11-05 covered an installed Windows desktop 5.9.3, its packaged readers, and one local transcript. The matching runtime heartbeat reports 2.165.0. These are separate desktop/runtime versions, not a version field present on every transcript. The official [desktop changelog](https://www.codebuddy.cn/docs/workbuddy/Changelog) lists 5.9.3; it is not a storage specification.

| Evidence | Observation | Limit |
|---|---|---|
| Desktop package | `@genie/workbuddy-desktop` 5.9.3; `main/database-factory.js`, `main/conversations.js`, and `main/server.js` define index and history handling | Read-only installed-code evidence, not a Cherry import test |
| SQLite index | Three `sessions` rows: one local and two cloud rows; `PRAGMA user_version` is 0 | Detect required columns and record shapes; the pragma cannot identify compatibility |
| Local transcript | 261 records: 8 user messages, 43 assistant messages, 49 reasoning records, 70 calls, 70 results, and 21 metadata/snapshot records | One complete parent chain; no attachment, branch, or child-agent coverage |
| Time order | Five decreases of 8–191 ms in tool events; the affected `parentId` links still point to the preceding record | The current shared timestamp rule rejects this real sample |
| Cloud index rows | `transport=cloud`, no corresponding local transcript in the inspected project store | No evidence for cloud import or complete cloud-cache reconstruction |

Keep only structural observations and synthetic examples in repository fixtures. Do not copy private prompts, answers, account IDs, working paths, credentials, or tool output into documentation or tests. Windows inspection does not establish macOS/Linux native compatibility.

#### Discovery, identity, and workspace

Resolve `WORKBUDDY_CONFIG_DIR` or `~/.workbuddy` through a proposed `external.workbuddy.home` path entry. Permit manual selection of that root. Do not use the Electron `app` directory or infer a WorkBuddy root from `CODEBUDDY_CONFIG_DIR`. Do not create a missing source directory.

Read only the necessary `sessions` columns and schema metadata in a read-only SQLite transaction. Required fields include `id`, `cwd`, `title`, `custom_title`, `transport`, `deleted_at`, and source timestamps. Use the index ID as `originalSessionId`; verify the filename and each record's `sessionId` against it. Bounded discovery joins this index to top-level transcripts under project directories. A directory slug is a lookup hint, never a decoded workspace path. Reject conflicting copies, path escapes, and ambiguous identity.

Use `custom_title`, then `title`, then the first real user body, then a source/date label. `session-meta` and `ai-title` are metadata, not messages. A `codebuddy.ai/sessionTitle` value can be an array of title records; do not treat it as a string. The first reader does not reconstruct an index from orphan transcripts. Missing index rows or required schema produce a specific unsupported/incomplete-store diagnostic.

For the observed local layout, `deleted_at IS NULL` means undeleted. Cloud rows use a different sentinel: the desktop maps `deleted_at=-1` to undeleted. Do not use one generic deletion predicate for both. A cloud-only row is an unsupported local-history candidate, not an empty chat or a deleted chat. Explain the missing local history through the existing error flow; do not fetch it using the user's login. A verified deleted local row is omitted from normal discovery.

Use `sessions.cwd` and compare it with nonempty transcript `cwd` values. Conflicts require resolution before import. `is_playground=1` identifies an automatically generated local workspace in the inspected desktop code; it does not mean a test or non-conversation session. Preserve its valid recorded directory. Empty cwd uses No work directory; a broken recorded path still requires mapping. Do not infer absence using a filesystem check on an empty string.

Do not apply Claude setup-only rules or Codex Guardian rules to WorkBuddy. Do not exclude a real task by `source_mode`, `is_playground`, or tool density. Background automation, subagents, and cloud-cache layouts need their own evidence; unsupported cases remain diagnosed rather than silently flattened or classified as ordinary root chats. The `sessions/*.json` files inspected here are runtime heartbeat records, not message history. Ignore account configuration, tokens, security stores, and unrelated databases.

#### Record mapping and display

WorkBuddy uses top-level `type`, `role`, `content`, `id`, `parentId`, `sessionId`, and integer millisecond `timestamp` fields. It is not the Claude nested `message.content` layout. Add a separate `workbuddy.ts` reader; reuse the shared normalized message and persistence contracts.

| Observed record | Proposed conversion |
|---|---|
| `message` with user `input_text` | Preserve user-authored content; unwrap only the verified outer `user_query` envelope for display and title selection |
| Generated user-message envelope | Keep recognized project/environment context separate from the visible user body; retain its historical meaning without installing source instructions as current Agent rules |
| `message` with assistant `output_text` | Preserve text, model metadata, and completed/incomplete state; do not remove an assistant record solely because `providerData.skipRun` is set |
| `reasoning` | Read `rawContent[].reasoning_text`, as the installed reader does; `content` is usually empty and is not a complete reasoning source |
| `function_call` | Preserve tool name, `callId`, and parsed arguments as inert historical tool text |
| `function_call_result` | Preserve object or array output, match `callId`, and retain errors/incomplete state; count omitted structured artifacts as degradation |
| `session-meta`, `ai-title`, `file-history-snapshot` | Classify as known metadata/snapshots; do not create chat bubbles or restore files |

Envelope recognition must validate the complete known wrapper. Keep quotes such as `message_quote`/`original_text` readable. A literal tag in user text or an unknown wrapper must not trigger broad XML stripping. Do not lose an attachment-only user turn. Attachment shapes remain unverified, so report unsupported content instead of declaring attachment compatibility.

Prefer the canonical call/result payload over duplicated `providerData` projections. Prefer the actual response model in `providerData.model`. `requestModelId` and `requestModelName` may describe Fast/Balanced routing rather than the actual model and must not override it; explicitly label the WorkBuddy route when no actual model is available. Do not change the target Agent. Do not import telemetry fields, remote credentials, pending approvals, widgets as executable HTML, or source tool permissions. Tools use the existing inert history and Processed projection. Incomplete historical actions remain visibly interrupted/failed and never become live pending actions. Source file references remain references; do not open or copy arbitrary tool-mentioned files.

Validate IDs, parent links, call/result links, and source order before conversion. The inspected chain has no forks. Reject missing ancestry, unknown branch/compaction semantics, unresolved child history, and conflicting duplicate IDs when they prevent reconstruction. Do not silently join every file or sort records by timestamp. A `.file-rollback.ndjson` sidecar is not a chat transcript or proof of a conversation rollback. Its presence alone must not reject an otherwise valid chat; unsupported changes to the message chain still block import.

#### Consistent snapshot and existing integration

SQLite and JSONL do not share an atomic snapshot. Read the selected index row and schema, read the bounded transcript, then recheck the relevant row, file identity, size, and content fingerprint. Keep the combined immutable snapshot in Main memory. Before commit, rebuild and compare that same logical snapshot. A changed title, directory, transport, deletion state, or transcript requires a new preview. An unrelated session's database update should not invalidate the selected row.

Include committed WAL data through a side-effect-free database read. Do not migrate, checkpoint, invoke WorkBuddy repair, copy only a live database, or run its packaged reader. If the environment cannot read safely, require WorkBuddy to close or a consistent offline copy. Reuse existing line/session/batch limits and cancellation. Fingerprint any extra source dependency introduced by a later supported layout.

The fourth implementation layer adds source registration, the path entry, source-specific parsing, and the WorkBuddy settings entry/locales. It reuses target selection, preview ownership, directory mapping, active-import deduplication, atomic writes, Pi initialization, and error dialogs. No WorkBuddy-specific table, import ledger, login client, or parallel import UI is proposed. Shared changes belong in their existing lower-layer owner before rebasing upstack.

#### Windows, macOS, and Linux delivery requirement

Deliver WorkBuddy import for Windows, macOS, and Linux together. Record the tested OS/distribution, CPU architecture, WorkBuddy desktop/runtime versions, and source schema for each supported combination. A Windows-only result does not complete this source. Linux coverage names the tested distributions; it is not a promise for every distribution or architecture. Official [UOS](https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Installation-UOS-Guide) and [Kylin](https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Installation-Kylin-Guide) installation guides establish availability, not storage compatibility.

Keep one platform-independent record parser. Resolve default locations through the path registry and retain manual root selection. The home-directory rule is a proposed macOS/Linux default until native samples confirm it. Do not depend on Windows drive letters, registry lookup, PowerShell, or the installed WorkBuddy executable. Reuse Cherry's packaged SQLite driver and verify its native loading on each declared architecture.

| Boundary | Required verification |
|---|---|
| Paths and workspace mapping | Non-ASCII names, spaces, Windows drive/UNC paths, POSIX paths, case behavior, and invalid/foreign-platform directories; parse source paths by their syntax before mapping them to the current OS |
| Filesystem and database access | Missing/unreadable roots, read-only stores, symlink/path containment, active WAL, locking, cancellation, and unchanged source files |
| Native application | Automatic/manual discovery, selected-Agent import, title/content/order, pagination/reopen, deduplication, error recovery, and first Pi continuation on Windows, macOS, and Linux |
| Packaging and evidence | Real source samples plus the packaged Electron/SQLite runtime for the declared platform matrix; distinguish synthetic parser tests from native runs |

Use synthetic fixtures derived from each verified platform layout without copying private content. Cross-platform path tests and shared fixtures run before native checks, but do not replace them. Keep WorkBuddy disabled until the declared three-platform matrix passes the source and shared-flow checks. Missing native evidence leaves the WorkBuddy slice incomplete; do not report simultaneous support based on a Windows run alone.

#### Ordering decision: reuse source-order provenance

The real transcript has 240 content/process records. Five tool timestamps decrease while the parent chain remains continuous. User and assistant text timestamps do not decrease. Cherry currently persists and pages messages by `createdAt, id`; its Pi history loader uses the same order. Keeping the current rejection rule would reject this sample. Sorting by time would reorder calls/results, and silently clamping time would violate the current Spec.

| Option | Benefit | Cost or constraint |
|---|---|---|
| Retain timestamp rejection | No shared behavior change | Useful as an interim guard; does not deliver import for the inspected real conversation |
| Reuse existing source-order provenance | Preserves source times and causal order without a schema migration; selected | Shared reads, pagination, forks and continuation must preserve the imported prefix |
| Normalize internal ordering time; preserve every original time in provenance | May reuse the existing schema and cursor mechanism | Changes the time contract; display, export, search, activity, and continuation must agree on which time they use |

The user selected independent source order and explicitly authorized implementation on 2026-11-05. Reuse the existing provenance field instead of adding a general message sequence or changing timestamps. Two-band pagination uses a local opaque cursor; ordinary cursors and global chronological search remain unchanged. Do not sort only in Renderer. Validate the observed backward intervals through persistence, paging, forks and continuation. This decision does not claim an exact-head GitHub review or completed platform verification.

Create synthetic fixtures for the observed schema and each supported record shape. Cover missing/cloud-only history, changed index/transcript pairs, duplicate IDs, envelope lookalikes, tool errors, interrupted history, playground workspaces, and the five backward intervals. Declare unsupported attachments, branches, and child histories separately. Verify through the existing Pi continuation and renderer paths after implementation; none of those product checks was run during this research.

### Filtering non-conversation sessions

Filter confirmed internal review and setup-only sessions before showing import candidates. This is a source-session eligibility rule, separate from hiding the preamble inside an imported conversation. The initial scope is Codex Guardian review and Claude Code histories without a real user task. Keep existing imported sessions and source files intact.

Use three classification results: retain as a conversation candidate, exclude with a reason, or undecided. Undecided sessions remain visible and use the existing validation diagnostics. Missing metadata, unknown versions, malformed records, incomplete parent chains, and read limits do not prove that a session has no user task. Do not filter by title, message count, transcript length, or tool density.

| Source | Required evidence | Result |
|---|---|---|
| Codex Guardian review | A validated `session_meta.payload.source.subagent.other` equals `guardian` | Exclude as `codex_guardian_review`, even after a title change or when synthetic user-role messages exist |
| Claude Code setup-only history | A completely read, recognized transcript has no real user task on any recoverable branch, with all user-role records classified | Exclude as `claude_no_user_task` |
| Uncertain or mixed evidence | A title-only match, unrecognized content, conflicting copies, or an unresolved branch | Keep the candidate for normal validation; do not guess an exclusion |

For Codex, the text “Guardian review” is not sufficient evidence. Keep ordinary chats with that title and ordinary `thread_spawn` subagents. Group physical files by source ID before filtering. If copies disagree about source type, retain the conflict rather than dropping one copy and making the other look valid. Only verified metadata layouts qualify. Local read-only inspection found the Guardian marker in 39 of 86 rollout files, all from `0.164.0-alpha.11.1`; this is evidence for that layout, not all Codex versions.

For Claude Code, a real user task is either nonempty user-authored text or an explicit user attachment, including an image/document without accompanying text. A single question qualifies even without an assistant answer. `tool_result`, generated `isMeta` records, local-command notices/output, and verified configuration or lifecycle commands do not count as a user task. Recognize commands from their structured records, not a leading slash in ordinary text. Keep commands with user-task semantics; an unknown custom command is undecided, not setup-only. Local samples include command-only `/model` and `/exit` in `2.1.207`, and a local `/recap` record in `2.1.211`, each without real user content. These samples establish narrow command cases, not a blanket exclusion of slash commands.

Evaluate the complete Claude transcript for discovery. Settings followed by a real question remain one importable candidate. If any recoverable branch contains a task, keep the session. Preview then evaluates the selected branch. A setup-only selected branch may offer another branch that contains a task; it does not make the entire source session permanently ineligible. A broken or unresolved branch must not be silently removed as an empty session.

Adapters own source-specific classification and reuse it during discovery and preview. The Main coordinator returns only retained or undecided candidates, plus aggregate exclusion counts by reason. Add a distinct filtered outcome for an old selection that becomes confirmed ineligible during revalidation; it creates no session or workspace and is not an import failure. Keep source-fingerprint and preview-expiry checks. Commit must not bypass eligibility or accept a changed snapshot. Parse and classify outside the write transaction. Apply read-size, scan-work and memory bounds to excluded inputs too, and honor cancellation. Excluded items do not consume the 100-session selection quota.

The dialog does not display exclusion counts or a filtered summary. Excluded entries do not occupy selection slots, select-all results, or success/failure counts. If all discovered sessions are excluded, show a clear empty state without reason counts. Do not offer directory/branch repair or a retry for a wholly excluded session. Preserve the existing separate retry for failed initialization of an already saved session. Do not add an override that imports a confirmed internal session.

Implement shared classification/result contracts, counts, and the Claude rule in the first implementation layer; put the Guardian-specific rule in the Codex layer. Use synthetic fixtures derived from these structures. Required boundaries include a renamed Guardian session, a normal chat titled Guardian review, ordinary subagents, configuration followed by a real question, attachment-only input, a one-message question, tool results under the user role, custom commands, multiple branches, conflicting physical copies, malformed/truncated data, and a selection invalidated between discovery and commit. This section is design-only until those implementation checks are completed.

### Message projection and continuation

| Source content | Imported representation |
|---|---|
| User/assistant text | Preserve text, original message boundaries, and timestamps in matching roles |
| Available reasoning text | Use existing reasoning parts and report renderer/runtime compatibility limits |
| Tool calls and results | First version stores labeled historical text with name, arguments, output, and errors |
| System instructions and compaction records | Historical notes or compatibility findings; never replace current Agent instructions |
| File/image references | Historical reference text with missing, unsupported, and not-copied findings; no automatic download |
| Unknown types or invalid JSON | Diagnose the location and continue parsing recoverable content |

Keep historical tools as inert persisted text. Present supported tool-call/result markers as completed, display-only tool items under the existing Processed disclosure, including older imported records. Match tool results by call ID when available, never as user speech. Unmatched results remain labeled historical notes. Do not import pending tools, approvals, or generation state. Explicitly completed, failed, and interrupted messages use `success`, `error`, and `paused`.

Merge adjacent completed historical process-only records into one Processed group for normal viewing. User messages, answer text, and unfinished records break the group. Preserve record order and every original message ID. Pagination must keep a stable group anchor; multi-select and capture retain the original individual records. Grouping changes display only, without rewriting persistence or replaying tools.

Project one selected source branch into the flat Agent Session. Use an explicit active branch when available; otherwise require a preview choice. Report other branches as not imported. Independently recoverable subagent sessions are separate candidates under the selected target Agent. Never concatenate mutually exclusive branches.

Convert valid times to UTC milliseconds while preserving raw source strings. For missing/invalid times, use the preceding valid time on the selected path, or a valid session-start time for the first message. Mark inferred values in preview; if no basis exists, block that session. Preserve source message identity and inference markers in typed message provenance, not in body text. Set session activity from historical activity; preserve the existing Agent's creation time.

Record complete historical model information in `messageSnapshot.model`. Leave `modelId` empty when no local model matches, and display missing information as unrecorded. Do not create fake model/account configuration. Historical references remain inert text and follow existing Markdown rendering rules.

Imported assistant headers use the current destination Agent's name and avatar, including old imports. A source conversation title is not the author name. Retain the source model snapshot; ordinary Cherry messages keep their existing author-snapshot behavior. Renaming the destination Agent updates imported headers without rewriting historical records.

Once the actual beginning of history is loaded and a real user message is found, start the visible imported conversation at that message. Hide preceding imported project instructions such as AGENTS.md, environment information, and other setup records. Do not cut at the first user message of a partially loaded page. Preserve later records and histories without a real user message. This is a display projection: keep the original stored records and continuation context. Pass import provenance through image export so it uses the same author and preamble rules.

Continuation ships in layer one, with Pi targets only; disable other runtimes in the selector. Visible messages alone do not establish native context. Reuse [Pi history conversion](../../../../src/main/ai/runtime/pi/retiredSessionHistory.ts) through a separate import entry, without impersonating retired-runtime migration or using external resume tokens. Preserve trailing imported user messages instead of applying retired migration's pending-delivery filtering.

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

Keep the active directory in `workspaceId`; the original path is provenance, not a parallel workspace state. Index `source + originalSessionId` for active sessions, independent of the chosen Agent. Check this identity inside the synchronous write transaction to serialize repeated imports. The lookup index is non-unique so restoring an archived copy can coexist with a later import. Changing targets does not create a second copy or move an existing import; report the existing session and its current owner. Existing sessions without metadata remain unaffected. Paths and content hashes are not identities. Reject sources without a verified stable ID.

| Case | Result |
|---|---|
| Reimport an existing session, including with another target | Return the existing session and owner; do not copy or move it |
| Source history grows | Report already imported; no automatic append or overwrite |
| Selected Agent is in the recycle bin | Require an active target |
| Imported session is archived | Preserve the archived copy and import a new session under the selected Agent; restoring the old copy remains supported |
| Session was permanently deleted | Allow reimport under the selected valid Agent |
| User renamed an Agent or moved a session | Preserve those changes; reimport does not move it back |
| User duplicates or forks a session | Clear the new session's unique import identity |
| Conflicting copies claim one source ID | Report a conflict without merging silently |

Use one synchronous `DbService.withWriteTx` per source session. Each transaction revalidates the selected Agent's active state and runtime compatibility, then creates necessary workspace records, the session with that `agentId`, messages, provenance, and the initialization marker together. Failure rolls back that session's writes; the existing Agent and its other sessions remain intact. Sessions commit independently. In a mixed batch, skip blocked sessions and commit valid sessions. Keep successes visible and retry only unresolved, recoverable selections with a fresh preview. Cancellation or target invalidation stops subsequent sessions; report what was already committed.

Read files, parse, validate directories, and calculate fingerprints outside the write transaction. No `await`, file writes, or network calls occur inside it. Compose the owning services' Tx methods and publish their events only after commit. Never break a large session into separately committed chunks to evade transaction limits.

Append migrations for session metadata, typed message provenance, and the active identity lookup index, without Agent source markers or an import-ledger table. Cover populated databases, trash, duplication, and existing full/slim backup restoration. Preserve source identity. Missing native files require reliable reconstruction from persisted history before continuation; otherwise block explicitly. Session-level backup merging is outside this change.

### Implementation ownership and stack

Place the source adapters, diagnostics, normalization, and Main preview coordinator in `src/main/services/conversationImport/`. Put cross-process commands in `src/shared/ipc/schemas/conversationImport.ts` with matching handlers/registration. The coordinator uses the existing lifecycle container.

Extend [ImportMenuSettings](../../../../src/renderer/pages/settings/DataSettings/ImportMenuSettings.tsx) with a separate local-application group and a shared dialog for discovery, target Agent selection, session selection, validation, and results. Put recoverable directory/branch choices in the separate error dialog. Use `@cherrystudio/ui`, i18next, and settings-search integration. Main must not import the renderer's web importer.

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
| 4 | WorkBuddy | Verified desktop index/transcript join, record and directory mapping, with the ordering prerequisite resolved | WorkBuddy and the complete four-source contract |

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
| Treat WorkBuddy as Claude Code or use only its SQLite index | Its top-level record layout differs, and its index contains no message bodies |
| Automatically download WorkBuddy cloud history | Requires account/network scope and a verified cloud format outside local-file import |

## Acceptance criteria

- AC1 — External and local imports use separate settings groups; only completed local sources are enabled. Opening a source discovers its default history, uses the source title or first real user message, and offers select all for displayed candidates. Import runs validation automatically without a separate Preview button. (verification: renderer discovery/selection/navigation and settings search)
- AC2 — Import requires an explicit existing Agent selection and binds all newly imported sessions in the batch to it, without creating Agents or changing their configuration. (verification: unit database fixtures and renderer selection/empty-state cases)
- AC3 — Each source conversation becomes a separate Agent Session, without ordinary Topics or mixed histories. (verification: unit multi-session fixtures)
- AC4 — Recorded working directories bind correctly, and equivalent normalized paths reuse a user workspace. (verification: unit workspace and session relations)
- AC5 — Absent working directories display No work directory and use the existing system-workspace semantics. (verification: unit and renderer)
- AC6 — Missing, inaccessible, and foreign-platform directories require mapping or skipping, without silent fallback. Offer mapping only when it can make the session importable; terminal failures show no ineffective directory choices. (verification: unit, renderer and Electron directory fixtures)
- AC7 — Repeated/concurrent imports, including different target selections, create no duplicate active imports while an active matching session exists; archived copies do not block a new import; selection uses Agent IDs despite equal names, and existing imports retain their owner. (verification: unit concurrency, cross-target, rename, and namesake fixtures)
- AC8 — Empty input, cancelled previews, all-duplicate batches, and failed transactions leave no empty session or workspace and do not create or alter Agent configuration. (verification: unit state and source-directory comparisons)
- AC9 — Preserve original times. WorkBuddy history uses existing provenance source order before native continuation; other sources retain their time-order rules. Persistence, paging, anchors, forks, export and reload preserve that order without new tables or columns. Preview and commit reject any future source time using the maximum across all messages. (verification: controlled-time adapter and database fixtures, renderer paging/reload)
- AC10 — Invalid JSON and unknown records have actionable locations/reasons while recoverable messages still import. A separate error dialog groups failures by session. Definitively unimportable sessions show only terminal reasons, without unrelated branch/directory choices or retry; offer only Close when no recoverable selections remain. (verification: unit mixed-record fixtures, renderer error/recovery cases and Electron)
- AC11 — A failed session rolls back atomically while valid sessions in the batch are saved. Retry includes only unresolved, recoverable selections and does not duplicate successes. Cancellation retains committed sessions and starts no subsequent session. (verification: unit fault injection/cancellation and renderer mixed-batch retry)
- AC12 — Changed sources/directories, a changed or deleted target, incompatible runtime changes, or expired previews require renewed selection/preview; foreign-window tokens and substituted target IDs are rejected. (verification: unit and renderer boundary checks)
- AC13 — Codex indexes/events do not duplicate content, and shared root-session IDs do not merge distinct threads. (verification: unit missing-index and fork fixtures)
- AC14 — OpenCode reads supported schemas including committed WAL data and clearly rejects unknown schemas. (verification: unit real SQLite fixtures)
- AC15 — WorkBuddy support is limited to declared desktop schema/record samples, starting with the inspected Windows 5.9.3 and runtime 2.165.0 combination. Unsupported releases and unverified content are diagnosed; installed version strings alone do not prove compatibility. (verification: unit versioned adapter fixtures)
- AC16 — Historical tool calls/results display as completed tool items under Processed, including old imports. Adjacent completed process-only records share one group; user messages, answer text and unfinished records separate groups. Paging, selection and capture preserve original message identities. Opening/importing or expanding them never executes tools, requests approvals, or starts generation. (verification: unit runtime boundaries, renderer grouping/paging/selection/capture and Electron)
- AC17 — First continuation uses the selected Agent's configuration and includes imported history before the new user message in model input, including accepted clock-skew cases; unsupported target runtimes are explained before import, and initialization failures are retryable without duplicated history. (verification: unit captured model input with controlled time, target-runtime compatibility, and recovery faults)
- AC18 — Imported sessions support search, duplication, trash, and restore; reimport preserves archived copies, and restoring one after reimport keeps both histories; duplicates do not inherit unique import identity. (verification: unit existing data-service integration)
- AC19 — Forward migration and existing full/slim backup round trips retain provenance, ownership, and workspaces; missing native history is reliably rebuilt or continuation explicitly blocked. No backup merging is added. (verification: unit populated-database migration and restore fixtures)
- AC20 — All enabled sources satisfy path mapping and read-only access on Windows, macOS, and Linux, with simulated and native evidence distinguished. WorkBuddy delivers all three together for a declared OS/distribution, architecture, and source-version matrix. Each platform verifies discovery, read-only SQLite/WAL access, packaged native loading, import/reopen, and Pi continuation. Synthetic tests do not replace native evidence; an unverified platform keeps the WorkBuddy slice incomplete. (verification: unit platform cases, real source-layout checks, and platform-native packaged Electron)
- AC21 — The Spec is followed by four gh-stack implementation layers ordered Claude Code, Codex, OpenCode, WorkBuddy, each with a scoped diff. (verification: docs gate and gh stack topology/diff inspection)
- AC22 — Imported assistant headers use the current destination Agent's name/avatar, including old imports and Agent renames, while retaining the source model. Source conversation titles do not appear as authors; ordinary Cherry author snapshots remain unchanged. (verification: renderer author/provenance/capture cases and Electron)
- AC23 — After loading the actual beginning and finding the first real user message, hide only earlier imported setup records. Partial pages, later records, stored history and continuation context remain intact. Image export applies the same preamble rule. (verification: renderer paging/projection/capture cases and Electron)
- AC24 — Codex sessions with a verified Guardian source marker are excluded before candidate display and cannot bypass filtering through an old selection. Renaming them does not change classification; title-only matches, ordinary subagents and conflicting copies are not silently excluded. (verification: versioned adapter fixtures and coordinator revalidation)
- AC25 — Claude setup-only sessions are excluded only after a complete recognized history proves there is no real user task on any recoverable branch. Real questions, attachment-only input, mixed setting/task histories and user-task commands remain eligible; uncertain records and unresolved branches remain visible for validation. (verification: versioned adapter content/branch fixtures)
- AC26 — Discovery reports exclusion counts separately from import outcomes, selection limits and errors. Filtering and revalidation create no sessions/workspaces, preserve source files and existing imports, and do not block valid sessions in the same batch. All-excluded results have an explanatory empty state without ineffective retry/repair choices. (verification: coordinator state/source checks, renderer counts/empty-state/mixed-batch cases and Electron)
- AC27 — WorkBuddy joins the desktop index and transcript by verified session identity, preserves title precedence and recorded cwd, and retains real playground tasks. Cloud-only rows, missing history, deleted local rows, and heartbeat files are not mistaken for ordinary complete local chats. (verification: versioned adapter discovery/identity/workspace fixtures)
- AC28 — WorkBuddy preserves user/assistant content, readable quotes, source reasoning, inert tool call/result order, and interrupted/error state. Literal tags, duplicated projections, metadata, and snapshots neither erase user text nor create duplicate messages or executable actions. (verification: adapter normalization, renderer projection, and Pi captured-input fixtures)
- AC29 — A selected WorkBuddy index row and transcript form one fingerprinted preview dependency set. Changes invalidate that preview; unrelated row changes do not. Source stores remain unchanged, WAL commits are included, and cancellation/limits create no partial imported session. (verification: read-only SQLite/file fixtures and coordinator state checks)
- AC30 — WorkBuddy accepts the observed backward tool intervals when the source chain is valid, without changing original times. Shared reads, pagination, forks, export and Pi continuation preserve source order through existing provenance. Missing ancestors and ambiguous chains block writes. Platform evidence remains a separate enablement requirement. (verification: ordering fixtures, renderer, Pi captured history, and Electron)

Use `setupTestDatabase()` for database cases and explicit affected-test paths per layer. Native platform checks are not replaced by platform simulations. These criteria are future product verification, not evidence supplied by this documentation PR.

## Risks

| Risk or open choice | Required resolution |
|---|---|
| Target runtime compatibility | Use the selected Agent's runtime; define and verify its history initializer before enabling selection, without silently changing Agent configuration |
| Timestamp rollback or source clock ahead | Reject conflicting input in preview and before commit; preserve timestamps and test the continuation boundary |
| Missing directories | Resolve before inserting messages because existing sessions with messages cannot change workspace |
| Native-file/database consistency | Use persistent initialization markers, stable native identity, validated output, and retry recovery |
| WorkBuddy and upstream drift | Initial Windows desktop evidence exists; add synthetic boundary fixtures and platform evidence before enabling support |
| WorkBuddy tool timestamps decrease | Resolve the shared ordering prerequisite explicitly; the inspected real sample fails the current rejection rule |
| WorkBuddy index and transcript diverge | Revalidate both dependencies; do not equate cloud indexes, heartbeat records, or partial files with complete local history |
| Missing macOS/Linux evidence or native package differences | Keep the three-platform delivery gate open until the declared platform matrix passes; current Windows format inspection is not native import verification |
| Tool and attachment fidelity | Review the first-version text/reference degradation; disclose every omitted artifact |
| Large inputs | Establish line, session, and batch limits from fixtures before exposing import |
| Backup restoration | Preserve identity through existing full/slim backups; no new merge capability |
| Overlap with #19002 | Reuse shared preview and mapping capabilities where appropriate; retain the four-source implementation sequence |

The first version fixes Pi targets, unchanged source timestamps, inert historical tools and existing backup restoration. WorkBuddy uses existing source-order provenance; other readers retain timestamp-conflict rejection. Reimports skip active matches; archived copies remain intact. Incremental sync is separate work. The user authorized implementation and a fourth stacked PR on 2026-11-05; platform-native scheduling is deferred, not counted as passed. Keep the Spec proposed and the WorkBuddy production entry disabled until the declared platform evidence is complete. Earlier layers may ship independently; #22728 remains incomplete.
