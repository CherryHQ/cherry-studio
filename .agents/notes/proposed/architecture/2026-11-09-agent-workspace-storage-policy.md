# Agent Note: Agent workspace storage policy

Status: proposed

English | [中文](2026-11-09-agent-workspace-storage-policy.zh.md)

## Problem

Issue #22415 reports a deleted task-output file exceeding 70 GB after an Agent read 400+ images; the incident values remain unverified.
The inspected worktree equals `origin/main` at `e0b6c72ddbc2cc13b19e0863056cd3c59e15d3c3`; all source anchors below refer to that revision.
Workspace validation establishes containment and accessibility, without measuring size (`src/main/ai/runtime/agentSessionWorkspace.ts:55-76`).
The bundled CLI receives the session workspace as its working directory (`src/main/ai/runtime/claudeCode/settingsBuilder.ts:189-196`,
`src/main/ai/runtime/claudeCode/ClaudeCodeProcessManager.ts:197-209`).
Claimed workspaces survive orphan cleanup, while the automatic volume warning begins below 1 GiB (`src/main/ai/agents/agentOrphanSweep.ts:73-78,104-108`,
`src/main/services/StorageMonitorService.ts:17,78-82`).
Propose four independent releases: measurement, soft warnings, opt-in cancellation, then explicitly enabled retention.
This PR supplies analysis and an executable engineering proposal only; it changes no behavior, preferences, source, tests, or database schema.

### What the report establishes and what it does not

The following are **reported, UNVERIFIED incident details** supplied with #22415: Windows; an unknown application version; one Agent task reading 400+ images; a file named
`bnv4ybfwg.output`; a displayed size of 70+ GB; an app-owned session workspace on the system drive; and deletion before inspection.
The exact byte count, allocated disk space, absolute path, write duration, contents, image encodings, runtime version, and producer cannot be reconstructed from the deleted file.
Do not convert the reported GB into GiB or estimate a per-image expansion ratio.

Code establishes a plausible CLI origin, not attribution of that particular file:

- The installed SDK exposes `SDKTaskNotificationMessage.output_file` (`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:6298-6313`). This dependency anchor is local evidence, not a repository-owned implementation contract.
- Cherry copies the supplied field into `outputFile`, then omits it from the root message projection (`src/main/ai/runtime/claudeCode/ClaudeRuntimeState.ts:139-146`, `src/main/ai/agentSession/RootMessageProjection.ts:234-243`).
- The searches in the root-cause section found no Cherry reader/writer for this task-output path. This is scoped negative evidence; it does not establish the CLI's internal naming or retention rules.
- Cherry can also write legitimate workspace files: `saveAttachment` resolves a workspace output path and publishes an attachment there (`src/main/ai/tools/saveAttachment.ts:89-115`). Directory accounting must include all writers, rather than matching `.output` filenames.

For a recurrence, proposed diagnostics should capture runtime/build identity, workspace identifier, sample timestamps, logical/allocated size distinction, and whether cancellation
settled. Preserve filenames/content only with a separate diagnostic consent decision; no incident payload is available here.

### Where an Agent run writes data

`{userData}` below means Cherry's selected data directory, not necessarily the system volume: the data root is constructed from Electron userData
(`src/main/core/paths/pathRegistry.ts:50-52`). The incident's system-drive placement is not universal.
The inventory covers the Agent storage roots and shared stores evidenced below; arbitrary third-party tools can write elsewhere, and their external destinations are **UNVERIFIED**.

| Location                                                                                                       | Owner                                                                      | Naming / lifecycle                                                                                                                                                                                                                                                       | Current removal trigger and evidence                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `{userData}/Data/Agents/system/{date}/{sessionId}`                                                             | Cherry owns directory; CLI, Cherry tools, and invoked tools write contents | UTC date and session ID; lazily prepared (`src/main/data/services/AgentWorkspaceService.ts:87-95,278-305`, `src/main/ai/runtime/agentSessionWorkspace.ts:36-63`); root registered at `src/main/core/paths/pathRegistry.ts:263`                                           | Trash archives after runtime close; purge removes artifacts; orphan sweep excludes every DB-claimed path (`src/main/ai/agents/AgentLifecycleService.ts:496-515,552-574`, `src/main/ai/agents/agentOrphanSweep.ts:73-78,93-114`). No size trigger in these paths.                      |
| Siblings `<workspace>.tar.gz`, `.tar.gz.tmp`, `.archiving`, `.restoring`, `.storage.json`, `.storage.json.tmp` | Cherry                                                                     | Archive, staging, and recovery journal suffixes (`src/main/ai/agents/agentWorkspaceStorage.ts:13-20`); gzip packing (`src/main/ai/agents/agentWorkspaceStorage.ts:160-170`)                                                                                              | Archive publication removes staging; committed restore removes archive/journals; purge removes the artifact set (`src/main/ai/agents/AgentWorkspaceStorageService.ts:285-315,406-442`). Claimed archives are retained by the sweep (`src/main/ai/agents/agentOrphanSweep.ts:93-108`). |
| `{userData}/Data/Agents/.forks/{operationId}/...` and `{operationId}.json`; copied target system workspace     | Cherry coordinates runtime-native snapshots                                | Operation/group directories and separate resource record (`src/main/core/paths/pathRegistry.ts:262`, `src/main/ai/agentSession/fork/AgentSessionForkOperations.ts:264-299`, `src/main/ai/agentSession/fork/resources.ts:30-32`)                                          | Ownership-checked cleanup/recovery; published/retained resources can survive; no blanket age deletion (`src/main/ai/agentSession/fork/AgentSessionForkOperations.ts:369-375,406-469`).                                                                                                |
| `{userData}/Data/Agents/.claude/`, especially `projects/`                                                      | Bundled Claude Code CLI; Cherry selects root and reconciles claims         | CLI-owned transcripts; exact internal filenames/other growing children **UNVERIFIED** (`src/main/core/paths/pathRegistry.ts:249-253,476-477`)                                                                                                                            | Driver reclamation excludes persisted/live resume tokens (`src/main/ai/agents/agentOrphanSweep.ts:141-168,171-194`); Cherry passes a long CLI cleanup period (`src/main/ai/runtime/claudeCode/settingsBuilder.ts:101-103,335-337`).                                                   |
| `{userData}/Data/Agents/.pi/sessions` and `.durable`                                                           | Third-party runtime storage under Cherry-selected roots                    | Pi sessions / durable stores (`src/main/core/paths/pathRegistry.ts:257-260`)                                                                                                                                                                                             | Runtime-specific orphan/purge driver hooks, preserving persisted and live claims (`src/main/ai/agents/agentOrphanSweep.ts:141-194`); exact internal file retention **UNVERIFIED** from this dispatcher.                                                                               |
| `{userData}/Data/Agents/.outputs`                                                                              | Cherry output-store adapter for Pi                                         | Runtime-supplied `file.name`, UTF-8 content (`src/main/core/paths/pathRegistry.ts:259`, `src/main/ai/runtime/pi/piBehaviorHost.ts:145-150`)                                                                                                                              | No deletion in this adapter. Dedicated expiry is **UNVERIFIED**; `rg -n 'feature.agents.outputs' src/main` finds registration, write, read roots, and tests, not a remover. Do not assume workspace purge covers this sibling root.                                                   |
| `{userData}/Data/Files` oversized tool-result blobs                                                            | Cherry FileManager                                                         | Content-addressed `vfs_<hash>.txt` marker and internal file entry; full text remains stored (`src/main/core/paths/pathRegistry.ts:273`, `src/main/ai/contextBuild/toolOutputStore.ts:24-32,52-68`)                                                                       | Message references and `delete_when_unreferenced` cleanup policy (`src/main/ai/contextBuild/toolOutputStore.ts:4-8,61-66`); context truncation is not disk deletion.                                                                                                                  |
| `{userData}/Data/Agents/{agentId}/memory` and identity files                                                   | Cherry / Agent tools                                                       | Per-agent data path with ensured memory directory (`src/main/core/paths/pathRegistry.ts:261`, `src/main/ai/agents/agentDataDirectory.ts:140-151`)                                                                                                                        | Orphan sweep considers only UUID-named, unclaimed agent directories, with a freshness gate (`src/main/ai/agents/agentOrphanSweep.ts:19-23,66-90`).                                                                                                                                    |
| `app.logs`                                                                                                     | Cherry logging / transports                                                | Platform logs, including macOS `~/Library/Logs/<App>/`; not always inside userData (`src/main/core/paths/pathRegistry.ts:89`, `src/main/core/paths/constants.ts:101-111`)                                                                                                | `app.logs.retention_days`: sweep at startup, every 12 hours, and on preference changes (`src/main/services/LogRetentionService.ts:8-31`).                                                                                                                                             |
| `{userData}/Data/cherrystudio.sqlite`                                                                          | Cherry                                                                     | Session/workspace rows and message persistence (`src/main/core/paths/pathRegistry.ts:98`, `src/main/data/db/schemas/agentSession.ts:9-24`, `src/main/data/db/schemas/agentWorkspace.ts:10-18`, `src/main/ai/agentSession/persistence/AgentSessionMessageBackend.ts:1-7`) | Session purge deletes expired rows (`src/main/ai/agents/AgentLifecycleService.ts:342-381`). Physical DB file shrink after row deletion is **UNVERIFIED** here and must not be promised as reclaimed bytes.                                                                            |

Registered user workspaces are separate: preparation requires an existing directory rather than creating one (`src/main/ai/runtime/agentSessionWorkspace.ts:39-46,73-80`). Proposed
P0–P3 defaults below cover system workspaces only; counting or deleting a user's project needs a separate scope decision.

### Root cause

The defensible conclusion is a missing storage-control boundary that permits the reported failure, rather than a proven image-processing defect:

1. **Path validation is not capacity admission.** Containment, symlink-component rejection, and directory accessibility are checked; bytes are not (`src/main/ai/runtime/agentSessionWorkspace.ts:55-105`, `src/main/ai/agents/agentDataDirectory.ts:48-105`).
2. **Execution delegates writes.** `settingsBuilder` chooses `session.workspace.path` as cwd and passes it with the environment to the CLI spawn (`src/main/ai/runtime/claudeCode/settingsBuilder.ts:189-196,327-332`, `src/main/ai/runtime/claudeCode/ClaudeCodeProcessManager.ts:197-209`). These spawn options impose no filesystem byte ceiling. The CLI's precise `.output` writer remains **UNVERIFIED**.
3. **No aggregate workspace quota was found.** The exact searches below found unrelated row counts, memory character limits, and capability names, but no total-workspace byte enforcement. This supports the absence finding within the searched source, not a proof about all dependency internals.
4. **Cleanup preserves owned data.** DB-claimed paths are excluded regardless of size or age; only unclaimed artifacts reach the five-minute freshness gate (`src/main/ai/agents/agentOrphanSweep.ts:23,73-78,104-112`, `src/main/ai/agents/AgentWorkspaceStorageService.ts:227-243`). A completed, untrashed session can therefore keep all workspace contents. Trash archiving and permanent purge are explicit lifecycle operations (`src/main/ai/agents/AgentLifecycleService.ts:342-381,506-515,547-574`).
5. **The automatic warning is late and unattributed.** The monitor samples the userData volume, warns below 1 GiB, and polls every 5–60 minutes (`src/main/services/StorageMonitorService.ts:17-29,58-61,78-82`). The renderer shows a persistent whole-volume toast (`src/renderer/hooks/useStorageMonitorNotification.ts:10-31`). A fast write can exhaust the disk between samples, even before any warning appears; the mechanism cannot identify the growing session.

Reproducible negative evidence, executed from the repository root:

```sh
rg -n "MAX_TOOL_INPUT_SIZE|MAX_WORKSPACE|WORKSPACE.*(MAX|LIMIT|CAP|QUOTA)|AGENT.*(MAX|LIMIT|CAP|QUOTA)|workspace.*(maxBytes|maxSize|quota|limit|cap)" src/main src/shared --glob '!**/__tests__/**'
rg -n -i "(workspace|agent).{0,100}(max(_| )?(bytes|size)|size(_| )?(limit|cap|quota)|disk(_| )?(limit|quota)|total(_| )?bytes)|(max(_| )?(bytes|size)|size(_| )?(limit|cap|quota)).{0,100}(workspace|agent)" src/main/ai src/main/services src/shared/ai src/shared/data --glob '!**/__tests__/**'
rg -n "MAX_TOOL_INPUT_SIZE" src
ls src/main/ai/runtime/claudeCode/streamAdapter.ts
rg -n 'output_file|outputFile|\.output' src/main/ai/tools src/main/ai/streamManager src/main/ai/runtime/claudeCode --glob '!**/__tests__/**'
rg -n "workspace.*(size|bytes|usage)" src/main src/renderer
rg -n "size|bytes" src/main/ai/agentSession/relocateSystemWorkspaces.ts
```

The usage search found no per-workspace disk-usage surface; the renderer match is a workspace label/icon (`src/renderer/pages/agents/components/AgentRightPane/AgentSessionDetailsSections.tsx:314`).
The relocation search found no size accounting (`src/main/ai/agentSession/relocateSystemWorkspaces.ts:328-382`).

`MAX_TOOL_INPUT_SIZE` has no source matches; `streamAdapter.ts` does not exist. The output-path search finds `outputFile` assignment and unrelated tool-result properties, not a `.output`
file reader/writer (`src/main/ai/runtime/claudeCode/ClaudeRuntimeState.ts:144`). Do not cite a nonexistent per-tool-input constant as protection.
The doctor separately offers a whole-volume 5 GiB warning / 1 GiB failure and a diagnostic-data size check; these are not automatic per-session controls
(`src/main/services/diagnostics/doctor/checks/storage.ts:11-13,45-94`).

### Inventory of today's limits

Scope: ceilings and thresholds in the inspected workspace, read/output, persistence, and detection paths; unrelated model/provider limits are not a disk policy. Binary units follow
`KB=1024`, `MB=1024*KB`, `GB=1024*MB` (`src/shared/utils/constants.ts:1-3`). **None of these enforces total workspace bytes.**

| Constant / setting                                                                | Current value                                             | Evidence                                                                                                                      | What it bounds / relevance                                                                                                                                                                    |
| --------------------------------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WORKSPACE_PROBE_TIMEOUT_MS`                                                      | 5,000 ms                                                  | `src/main/ai/runtime/agentSessionWorkspace.ts:13,84-105`                                                                      | Waiting for a directory probe; no storage ceiling.                                                                                                                                            |
| `MAX_RECURSION_DEPTH`                                                             | 1,000                                                     | `src/main/utils/fileOperations.ts:9,176-179`                                                                                  | Directory-size helper depth; not file count, bytes, or runtime write rate.                                                                                                                    |
| `READ_FILE_MAX_BYTES`                                                             | 128 KiB                                                   | `src/main/ai/agents/doctor/doctorTools.ts:62,399-410`                                                                         | Doctor's single read; **does not help** with writes.                                                                                                                                          |
| `SIZE_CAP_BYTES` / `PAGED_SIZE_CAP_BYTES`                                         | 5 MiB / 50 MiB                                            | `src/main/ai/tools/adapters/aiSdk/builtin/FsReadTool.ts:28-32,196-212`                                                        | Whole-file / absolute readable-file size; **does not help** with writes by the CLI.                                                                                                           |
| `DEFAULT_READ_LIMIT`                                                              | 2,000 lines                                               | `src/main/ai/tools/adapters/aiSdk/builtin/FsReadTool.ts:47-60`                                                                | Default read page, no schema upper bound; output char cap is the gate.                                                                                                                        |
| `CONTEXT_PERSIST_THRESHOLD_CHARS` / fallback `READ_OUTPUT_CHAR_CAP`               | 50,000 characters                                         | `src/shared/ai/builtinTools.ts:190-197`, `src/main/ai/tools/adapters/aiSdk/builtin/FsReadTool.ts:41-46`                       | Context offload and per-call returned text, request override possible; full offloaded text is stored (`src/main/ai/contextBuild/toolOutputStore.ts:52-68`). **Does not cap persisted bytes.** |
| `MAX_REQUESTED_OUTPUT_TOKENS` / `DEFAULT_REQUESTED_OUTPUT_TOKENS`                 | 128,000 / 32,000 tokens                                   | `src/main/ai/runtime/claudeCode/environment.ts:47-51,91-110`, `src/main/ai/runtime/claudeCode/settingsBuilder.ts:297-307`     | Requested model output; environment pinning is conditional. **Does not help** with tool/CLI file growth; no byte conversion established.                                                      |
| `MIN_AUTO_COMPACT_WINDOW` / `MAX_AUTO_COMPACT_WINDOW`; `AUTO_COMPACT_TRIGGER_PCT` | 100,000 / 1,000,000 tokens; 80%                           | `src/main/ai/runtime/claudeCode/environment.ts:40-41,69-85`                                                                   | Context-budget calculation and trigger, not filesystem compaction.                                                                                                                            |
| `AGENT_SESSION_MESSAGES_MAX_LIMIT` / default                                      | 200 / 50 rows                                             | `src/shared/data/api/schemas/agentSessionMessages.ts:28-34`                                                                   | Message-list page count; **does not help** with message bytes or disk writes.                                                                                                                 |
| `AGENT_MEMORY_MAX_WRITE_CHARS`                                                    | 1,000,000 characters                                      | `src/shared/ipc/schemas/agent.ts:39-49`                                                                                       | One memory-editor write input; **does not cap** repeated writes, workspace contents, or CLI input.                                                                                            |
| `MAX_TOOL_INPUT_SIZE`                                                             | Not present                                               | Negative search above; existing memory-input limit is at `src/shared/ipc/schemas/agent.ts:39-49`                              | No evidenced general per-tool-input byte cap; any bounded input would still not bound bytes generated by a tool.                                                                              |
| `FRESHNESS_GATE_MS`                                                               | 5 minutes                                                 | `src/main/ai/agents/agentOrphanSweep.ts:22-23`, `src/main/ai/agents/AgentWorkspaceStorageService.ts:233-239`                  | Minimum staleness for orphan reclamation, not retention of claimed workspaces.                                                                                                                |
| `CLAUDE_SESSION_RETENTION_DAYS` → `cleanupPeriodDays`                             | 365,000 days                                              | `src/main/ai/runtime/claudeCode/settingsBuilder.ts:101-103,335-337`                                                           | CLI transcript cleanup setting supplied by Cherry; not workspace retention or an incident-specific guarantee.                                                                                 |
| `data.trash.retention_days`                                                       | Default 30 days; 0 disables automatic row purge           | `scripts/data-classify/data/target-key-definitions.json:1174-1178`, `src/main/services/trash/trashPurgeJobHandler.ts:121-128` | Already-trashed data only; residue sweeps still run at 0. Daily schedule: `src/main/services/trash/TrashService.ts:44-56`.                                                                    |
| `STORAGE_LOW_THRESHOLD_BYTES`; `intervalForFree`                                  | 1 GiB; 60/30/15/10/5 minutes at ≥20/≥10/≥5/≥1/<1 GiB free | `src/main/services/StorageMonitorService.ts:17-29`                                                                            | Whole-volume warning only.                                                                                                                                                                    |
| `DISK_LOW_BYTES` / `DISK_CRITICAL_BYTES`; `DIAGNOSTIC_DATA_LARGE_BYTES`           | 5 GiB / 1 GiB; 200 MiB                                    | `src/main/services/diagnostics/doctor/checks/storage.ts:11-13,45-94`                                                          | Doctor warnings/failure and diagnostic-data threshold, not live workspace enforcement.                                                                                                        |

This is a new storage-policy decision, additive to [managed-workspace relocation](../../implemented/bug-fix/2026-10-31-agent-workspace-relocation.md); that note continues to own relocation recovery. No existing note is superseded.

## Proposal

Everything in this section is **proposed**, including names, thresholds, and defaults. Each phase needs its own implementation review and can ship without subsequent phases.

### P0 — Measure and surface

1. Add `src/main/ai/agents/AgentWorkspaceUsageService.ts`, a `WhenReady` lifecycle service, registered in `src/main/core/application/serviceRegistry.ts`. Follow `StorageMonitorService`'s `@Injectable`, `@ServicePhase`, startup background check, and `registerInterval` ownership (`src/main/services/StorageMonitorService.ts:41-55,94-102`, `src/main/core/application/serviceRegistry.ts:165-170,191-194`). Resolve roots through `application.getPath` and log through `loggerService`, as that service does (`src/main/services/StorageMonitorService.ts:3-9,59,70`).
2. Measure logical regular-file bytes under each active system workspace. Reuse `getDirectorySize` for bounded small trees or expose a bounded, resumable variant in the same module; its present implementation skips symlinks/special files but walks recursively without a work/time budget (`src/main/utils/fileOperations.ts:162-220`). Keep existing callers' contract unchanged.
3. Proposed sampler: one global tick every **5 seconds**, one walk in flight, round-robin active workspaces; at most **2,000 examined entries or 100 ms of scheduling work per tick**, whichever comes first. Yield between entries, preserve a bounded cursor, and avoid materializing an unlimited `readdir` array. Measure on turn start/end too, within the same queue. No continuous scan of idle sessions; refresh an idle workspace only on inspection/admission or P3 scheduling.
4. Sum `lstat.size`, never file contents. Publish `bytes`, `checkedAt`, `complete`, and `error/stale` state. Partial results are lower bounds, not zero or exact totals. A single filesystem syscall is not abortable by a JS deadline; hold its slot until it settles rather than spawning replacements. The cost bound controls scheduled work, not OS latency. Reject link/reparse-point traversal and revalidate directories against replacement races.
5. Extend `src/shared/ipc/schemas/ai.ts` with proposed request `ai.agent.workspace.get_usage` and event `ai.agent.workspace.usage_changed`; implement the request in `src/main/ipc/handlers/ai.ts`, alongside existing workspace routes (`src/shared/ipc/schemas/ai.ts:458-467`, `src/main/ipc/handlers/ai.ts:273-276`). Send main-owned snapshots through `IpcApiService`, with `useIpcOn` consumption analogous to auto-rename (`src/shared/ipc/schemas/ai.ts:548-551`, `src/main/services/TopicNamingService.ts:467-468`, `src/renderer/hooks/agent/useSession.ts:578-584`). A request supplies initial state after reconnect; events include workspace ID and monotonic sample sequence.
6. Show usage / stale state in the session details surface (`src/renderer/pages/agents/components/AgentRightPane/AgentSessionDetailsSections.tsx:314`); add a renderer hook for subscription. Raise the proposed whole-volume warning to **5 GiB**, retain a distinct **1 GiB critical** diagnostic, and propose a **30-second capacity poll while Agent turns run**. Otherwise keep the existing adaptive cadence. This replaces neither directory accounting nor the current health/toast delivery (`src/main/services/StorageMonitorService.ts:24-29,78-82`, `src/renderer/hooks/useStorageMonitorNotification.ts:10-31`).

P0 stops no turn and deletes nothing. Its release gate is trustworthy, bounded-cost measurement and observable stale/error states, plus earlier volume notification.

### P1 — Soft cap

Add a configurable warning at `bytes >= warn_bytes`; proposed default **1 GiB per system workspace**. Emit one warning per crossing, retain visible over-threshold state, and re-arm
only after a complete below-threshold sample. An incomplete lower bound already above threshold is sufficient to warn; an incomplete small result cannot clear a warning.
Offer inspect/open workspace, stop using the normal Stop action, and storage settings. Continue execution automatically; no acknowledgement is required to keep running. Add i18n
strings in a later implementation and use `@cherrystudio/ui` for new controls. Keep the whole-volume warning separately visible.
Implement warning state in the usage service / proposed `usage_changed` event; the existing whole-volume toast illustrates a persistent warning that clears on recovery
(`src/renderer/hooks/useStorageMonitorNotification.ts:17-29`).

### P2 — Hard cap through existing cancellation

Propose `max_bytes = 0` by default (disabled); offer **10 GiB** as an explicit opt-in preset. When enabled, require `0 < warn_bytes < max_bytes`, or `warn_bytes = 0` to disable
soft warnings. Breach is `bytes >= max_bytes`, including a partial lower bound already above it.
On first breach, latch over-budget state and stop admission before cancelling. Call `application.get('AiStreamManager').abortAndDrain(buildAgentSessionTopicId(sessionId),
'agent-workspace-over-budget')`; this is a proposed new reason string using an existing method. The topic builder exists at `src/main/ai/agentSession/topic.ts:16-18`; retention
already calls this method from main (`src/main/ai/agents/AgentLifecycleService.ts:360-365`).
`abortAndDrain` takes the dispatch lock, aborts, waits for loops, and closes the session (`src/main/ai/streamManager/AiStreamManager.ts:1383-1417`). Its abort fallback reaches
`AgentSessionRuntimeService.abortPendingTurn`, which aborts the live turn controller (`src/main/ai/streamManager/AiStreamManager.ts:1361-1374`,
`src/main/ai/agentSession/AgentSessionRuntimeService.ts:1832-1837`). Stream abort closes the runtime; Claude teardown waits for shutdown
(`src/main/ai/agentSession/AgentSessionRuntimeService.ts:1056-1063`, `src/main/ai/runtime/claudeCode/ClaudeCodeRuntimeDriver.ts:471-485`). Do not invent a CLI `setQuota` API or
treat background-task Stop as turn cancellation (`src/shared/ipc/schemas/ai.ts:478-482`).
Propose a dedicated adjacent `<workspace>.budget.json` latch, atomically recording workspace/session identity and breach state before cancellation. Do not overload the archive
transaction journal. Extend storage artifact enumeration/ownership, purge, restore, and relocation to include the new suffix; current suffix ownership is centralized
(`src/main/ai/agents/agentWorkspaceStorage.ts:13-20`, `src/main/ai/agents/AgentWorkspaceStorageService.ts:227-243,422-442`). A failed latch write still blocks admission in memory;
after restart require fresh accounting before any admission when hard policy is enabled.
Gate every admission path, including queued, scheduled, background, and reused sessions, through the runtime host; do not rely only on renderer controls. A persisted breach remains
blocked until an explicit action: clean and remeasure below budget, raise/disable the ceiling, or select a fresh workspace. No automatic retry or silent reuse. Incomplete preflight
measurement must hold admission and surface a recoverable status, not silently authorize unknown usage.
Cancel once per breached turn; keep measuring through teardown and report pending/failed cancellation. Retain partial files. Do not delete output to force usage below budget.
Sampling has unbounded worst-case overshoot; a true disk guarantee would require a separately reviewed OS isolation/quota design.

### P3 — Retention of finished sessions

Propose optional age and aggregate-size policies for **idle, finished system-workspace sessions**, excluding live/queued turns, fork operations, pending restore, and unverified
ownership. Proposed defaults disable automatic retention. "Finished" must be checked against runtime/queue state and last settled activity, not merely an old directory mtime.
When enabled, build an oldest-idle candidate list: age expiry or a configured total retained-workspace budget makes a session eligible for the existing trash/archive lifecycle.
Recheck under lifecycle locks, process at most **one session per minute**, and stop when policy is satisfied or candidates run out. No parallel cleanup owner. Existing
stable-session checks and archive-after-close behavior are the composition points (`src/main/ai/agents/AgentLifecycleService.ts:547-575,577-614`).
Use archive/recovery machinery for reversible removal; compression is not assured to reclaim enough space and temporarily needs archive headroom
(`src/main/ai/agents/AgentWorkspaceStorageService.ts:285-315`, `src/main/ai/agents/agentWorkspaceStorage.ts:160-170`). Under low free space, defer packing and offer explicit
purge/export decisions. Compression thread placement is **UNVERIFIED** from these call sites.
`agent.workspace.retention_days` would determine when eligible sessions are moved to trash; `data.trash.retention_days` continues to determine final purge after trashing. Its
existing 30-day default and 0=never-auto-purge semantics remain intact, including continued residue sweeps at 0 (`scripts/data-classify/data/target-key-definitions.json:1174-1178`,
`src/main/services/trash/trashPurgeJobHandler.ts:121-128`). A size budget cannot override that grace period; show unreclaimable retained bytes rather than promising a hard
aggregate limit.
Let the existing orphan sweep reclaim genuinely unclaimed residue, preserving pending-restore and freshness gates (`src/main/ai/agents/agentOrphanSweep.ts:53-59,93-114`). Never
redefine a DB-claimed workspace as an orphan just because it is large.

### Proposed preferences and generation

| Proposed key (not existing policy)    | Phase | Proposed default / units    | Semantics                                                                                                     |
| ------------------------------------- | ----- | --------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `agent.workspace.warn_bytes`          | P1    | 1,073,741,824 bytes (1 GiB) | 0 disables soft warning; positive integer otherwise.                                                          |
| `agent.workspace.max_bytes`           | P2    | 0 bytes (disabled)          | Positive integer enables cancellation threshold; suggested opt-in preset 10,737,418,240 bytes (10 GiB).       |
| `agent.workspace.retention_days`      | P3    | 0 days (disabled)           | Positive integer enables age-based eligibility for trashing finished sessions.                                |
| `agent.workspace.retention_max_bytes` | P3    | 0 bytes (disabled)          | Positive integer enables oldest-idle selection by retained system-workspace total; trash grace still applies. |

Add new product keys to `scripts/data-classify/data/target-key-definitions.json`, then run `npm_config_verify_deps_before_run=false pnpm data:generate` and inspect generated
changes. The generator owns `preferenceSchemas.ts` and migration mappings; do not edit outputs by hand (`scripts/data-classify/README.md:7-8,13-26`). No generator or preference
change is part of this document-only PR.

### Impact surface

| Phase | Proposed files / modules                                                                                                                                                                                                           | Preferences / renderer                                                                                                                                                                                                     | Performance cost and regression exposure                                                                                                                                                                                                                                                |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0    | New `AgentWorkspaceUsageService.ts`; `fileOperations.ts`; `serviceRegistry.ts`; `StorageMonitorService.ts`; `src/shared/ipc/schemas/ai.ts`; `src/main/ipc/handlers/ai.ts`; runtime-host start/end wiring                           | No new product preference; proposed 5 GiB warning constant / active cadence. New usage hook; existing `src/renderer/pages/agents/components/AgentRightPane/AgentSessionDetailsSections.tsx`; locale catalogs in a later PR | Metadata cost scales with entries, not file content bytes. IPC fan-out/staleness, startup latency, timer leaks, UI refresh ordering, shared-helper callers can regress. Preserve helper callers (`src/main/utils/markdownParser.ts:379`, `src/main/features/miniApp/management.ts:79`). |
| P1    | Usage service threshold state; renderer details/settings/notification integration                                                                                                                                                  | `warn_bytes`; definitions + regenerated `src/shared/data/preference/preferenceSchemas.ts`; all locale translations                                                                                                         | No second walker. Dismiss/re-arm behavior, duplicate toasts across windows, accessibility and legitimate large jobs need review.                                                                                                                                                        |
| P2    | Usage service; `AgentSessionRuntimeService.ts`; `AiStreamManager.ts` integration; `agentWorkspaceStorage.ts`; `AgentWorkspaceStorageService.ts`; `relocateSystemWorkspaces.ts`; fork artifact handling; IPC acknowledgement action | `max_bytes`; generated preference schema; blocked-run explanation, cleanup/recheck / raise-limit / new-workspace controls                                                                                                  | Admission/queue races, restart persistence of breach, shutdown deadlocks, blocked restore, duplicate cancellation, partial artifacts, unbounded preflight latency. Proposed sidecar must travel through every workspace lifecycle operation.                                            |
| P3    | `AgentLifecycleService.ts`; usage service candidate accounting; `AgentWorkspaceStorageService.ts`; trash job coordination; existing orphan sweep integration                                                                       | `retention_days`, `retention_max_bytes`; generated preference schema; retention preview and retained-byte totals                                                                                                           | Archive reads/writes entire contents; peak free-space consumption, restoration fidelity, active-session protection and trash grace are primary risks. Do not rewrite runtime-specific retention blindly.                                                                                |

For an unbounded full scan, let `B` be logical bytes represented by files, `E` entries per workspace, `N` active workspaces, and `I` interval seconds. The accounting coverage
requested is **B × N / I bytes represented per second**, but actual I/O is approximately **E × N / I metadata operations**, not reading B bytes of contents. The current helper uses
`readdir` / `lstat` / `size` (`src/main/utils/fileOperations.ts:191-209`). The proposed global 2,000-entry budget per 5-second tick caps scheduling at roughly 400 entries/second;
it lengthens revisit latency as N or E rises. Publish that age and benchmark hot/cold metadata caches before release.

Cross-platform implementation requirements (proposals, not tested platform guarantees):

- **Windows:** preserve long paths and UNC handling through central path APIs; test junction/reparse-point exclusion, locked files, access-denied subtrees, and antivirus-delayed metadata. A walk cannot be reported complete after skipping inaccessible entries.
- **macOS:** distinguish logical length from APFS sparse/compressed/clone allocation; logs may be on a different root (`src/main/core/paths/constants.ts:101-111`). Test case-insensitive containment and renamed directories.
- **Linux:** test symlinks, mount changes and permission errors. Do not assume filesystem `bavail` equals all reclaimable capacity; current volume accounting multiplies `bsize*bavail` and `bsize*blocks` (`src/main/services/StorageMonitorService.ts:58-60`).
- **All three:** skip links/special files, handle disappearing entries as a stale sample, and bound queued work. Walk replacement races and hard links need tests; hard-linked files may be conservatively double-counted. A directory policy does not cover writes into other roots from the inventory, external paths, or detached tools.

### Verification plan

**This document-only proposal:** acceptance is scoped pairing generation/check plus `npm_config_verify_deps_before_run=false pnpm docs:check` green and maintainer review of evidence, scope, and policy choices. No product tests, dependency rebuild, or runtime changes are authorized.
Under the [Agent Note rules](../../README.md), this triplet belongs in `proposed/architecture/` until implementation is complete; implementation requires Approval on the current Spec head.
Reference frontmatter, structure, and index discovery apply to `docs/dev/references/`, not this proposal (`scripts/docsGovernance/verify-doc-frontmatter.ts:55-58`, `scripts/docsGovernance/verify-doc-structure.ts:62-63`, `scripts/docsGovernance/gen-doc-index.ts:59-60,82-92`).
Link checking recursively scans `docs/` and `.agents/` (`scripts/docsGovernance/check-doc-links.ts:86-92`). Do not run `docs:index` or edit generated `docs/dev/README.md` / `docs/dev/sources-index.json` for this note.

Later implementations should use explicit-file commands. The Vitest main project is named `main`, with `src/main` test inclusion (`vitest.config.ts:37-57`). Existing entry points
include the storage-monitor, workspace-storage, lifecycle, runtime-host, and orphan-sweep tests named below (each exists; anchors are their first lines).

```sh
# P0: extend existing capacity tests; add a usage-service test in its implementation PR.
npm_config_verify_deps_before_run=false pnpm exec vitest run --project main src/main/services/__tests__/StorageMonitorService.test.ts
# P2: existing runtime-host contract and storage recovery coverage.
npm_config_verify_deps_before_run=false pnpm exec vitest run --project main src/main/ai/agentSession/__tests__/AgentSessionRuntimeService.test.ts src/main/ai/agents/__tests__/AgentWorkspaceStorageService.test.ts
# P3: existing lifecycle and reclamation consumers.
npm_config_verify_deps_before_run=false pnpm exec vitest run --project main src/main/ai/agents/__tests__/AgentLifecycleService.workspace.test.ts src/main/services/trash/__tests__/agentOrphanSweep.test.ts src/main/services/trash/__tests__/trashPurgeJobHandler.test.ts
```

Test-entry evidence: `src/main/services/__tests__/StorageMonitorService.test.ts:1`, `src/main/ai/agentSession/__tests__/AgentSessionRuntimeService.test.ts:1`,
`src/main/ai/agents/__tests__/AgentWorkspaceStorageService.test.ts:1`, `src/main/ai/agents/__tests__/AgentLifecycleService.workspace.test.ts:1`,
`src/main/services/trash/__tests__/agentOrphanSweep.test.ts:1`, `src/main/services/trash/__tests__/trashPurgeJobHandler.test.ts:1`. These are future validation commands, **not
tests run for this PR**. Add explicit paths for new tests when they exist; do not run entire projects by omitting filters.

| Phase | Required contract cases (each catches a specific regression)                                                                                                                                                                                                                                                                                                                                                 | Release evidence                                                                                                                                                                               |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0    | Fake nested tree totals known regular-file sizes; empty tree=0; outside symlink/junction and special file are not followed; replacement race does not escape root; permission failure yields partial/error; tick never overlaps; budget yields fairly; slow syscall does not spawn new walks; reconnect receives latest sample and rejects old sequence                                                      | Known sizes agree; per-tick entry/deadline instrumentation stays within scheduling budget; UI distinguishes fresh/partial/stale; free-space threshold boundaries and active polling exercised. |
| P1    | Below/equal/above threshold; one warning per crossing; repeated/partial samples do not spam or clear incorrectly; setting changes and disabled warning; task continues across crossing                                                                                                                                                                                                                       | User sees attributed workspace warning and running turn continues; no automatic cancellation.                                                                                                  |
| P2    | Cancel invoked once per breached turn; run reaches a stopped state through real abort handling; queued/scheduled runs cannot restart it; over-budget workspace is not silently reused; latch survives restart/relocation; failed latch write/unknown scan does not authorize a run; cleanup plus explicit recheck unblocks; raising/disabling limit requires explicit action; cancel failure remains visible | Assert terminal/admission outcomes, not only a mock call. User retains partial files and sees exact reason; no implicit retry after restart.                                                   |
| P3    | Age/size selects oldest eligible idle sessions only; active/queued/fork/restore work excluded; locks recheck eligibility; trash retention 0 and positive grace preserved; archive/restore round trip preserves bytes; interrupted archive/purge recovers; orphan freshness holds; Windows locked-file retry retains ownership                                                                                | Measured reclaimed bytes distinguish trash/archive from final purge; no deletion of user workspaces or claimed live state; recovery and restore remain lossless.                               |

For later DB-backed cases use the repository `setupTestDatabase()` harness, already used in workspace-storage tests
(`src/main/ai/agents/__tests__/AgentWorkspaceStorageService.test.ts:6,27-28`). Use unified application/service mocks, not handwritten schema or Drizzle-chain stubs; the same test
imports the shared mock factory (`src/main/ai/agents/__tests__/AgentWorkspaceStorageService.test.ts:17-24`).

Manual end-to-end scenario for a later implementation, on Windows/macOS/Linux: use a disposable system workspace and safe test thresholds (e.g. warning 16 MiB, hard ceiling 32
MiB). Generate a large synthetic file incrementally through an Agent task, without approaching actual disk exhaustion. Observe accounting and soft warning while it continues, then
observe hard cancellation, settled Stop state, retained partial artifact and blocked next run. Restart and verify the block persists. Explicitly clean/recheck or raise the limit to
resume. Finish the session, opt into retention, advance a test clock, observe trash/archive and lossless restore, then explicit purge and byte reclamation. Record overshoot,
detection/teardown latency, CPU, metadata operations, and free space; verify a user-workspace control directory is untouched.

## Alternatives considered

Because the CLI owns individual writes, a portable Cherry policy can enforce only **at the directory level**, by observing usage and stopping admission/execution. A tool wrapper
cannot intercept every write (`src/main/ai/runtime/claudeCode/ClaudeCodeProcessManager.ts:197-209`).
The proposed "hard cap" is a cancellation threshold, not a filesystem quota: growth can race measurement, continue during teardown, or occur outside cwd. No finite overshoot
guarantee exists without controlling every writer or an OS quota.

| Option                                     | Protects                                                        | What it breaks / leaves exposed                                                           | Enforcement point                                                                                                                                                          | Windows / macOS / Linux portability                                                       | Cost                                                                    |
| ------------------------------------------ | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| A. Warn earlier only                       | More time to react to whole-volume pressure                     | No attributable session control; unattended/fast writers can fill disk                    | `StorageMonitorService` threshold / cadence (`src/main/services/StorageMonitorService.ts:17-29,58-61`)                                                                     | Existing `statfs` route on all supported platforms; verify target-volume semantics        | Low: capacity query, no recursive walk                                  |
| B. Cancel at directory threshold           | Limits continued growth after detection; blocks automatic reuse | Legitimate large jobs interrupted; partial artifacts remain; cancellation may lag         | Workspace sampler → existing `abortAndDrain` (`src/main/ai/streamManager/AiStreamManager.ts:1383-1417`)                                                                    | Same app-level policy on all three; no portable filesystem quota assumed                  | Medium/high: metadata traversal, admission checks, teardown races       |
| C. Warn and continue at soft threshold     | Visibility and user choice for large legitimate work            | Does not prevent disk exhaustion; warning fatigue                                         | Sampler → proposed workspace IPC event                                                                                                                                     | Same three-platform traversal caveats as B; no cancellation dependency                    | Medium: traversal and deduplicated warning UI                           |
| D. Finished-session retention / compaction | Accumulated inactive workspace storage                          | Can remove valued outputs if enabled without clear consent; cannot stop a live write      | Existing archive/purge owner (`src/main/ai/agents/AgentLifecycleService.ts:496-515`)                                                                                       | All three; Windows open-file locks require retry, archive free-space headroom required    | High: walk, compression reads/writes, restore/recovery validation       |
| E. Move off the system volume              | Isolates pressure from OS volume when another volume exists     | Destination can fill/disconnect; relocation duplicates data temporarily; not a byte bound | Central path registry plus relocation workflow (`src/main/core/paths/pathRegistry.ts:263`, `src/main/ai/agentSession/relocateSystemWorkspaces.ts:176-208,235-266,328-382`) | Drive-letter/UNC paths on Windows; mounts on macOS/Linux; test cross-volume copy/recovery | High: location UI, migration, runtime-history/checkpoint reconciliation |

Recommend A+C first, optional B after measurement evidence, and D only with an approved retention policy. Keep E a separate location-control project; changing one root without
history/storage relocation is insufficient (`src/main/ai/agentSession/relocateSystemWorkspaces.ts:277-320,328-382`).

## Acceptance criteria

- AC1 — Known regular-file trees yield correct logical-byte totals; skipped, inaccessible, changing, or unfinished traversal is visibly partial/stale/error rather than zero or an exact complete total. (verification: unit)
- AC2 — Sampling has one walk in flight, fairly shares a global 2,000-entry or 100-ms scheduling budget per 5-second tick, bounds cursor/queued work, and retains a slow syscall slot without starting replacement walks. (verification: unit)
- AC3 — Session details show attributed per-workspace bytes, sample age, and complete/partial/stale/error state; reconnect obtains the latest snapshot and late sequences cannot overwrite it. (verification: renderer)
- AC4 — Each soft-threshold crossing shows one workspace warning while the turn continues; repeated or incomplete-small samples neither duplicate nor clear it, and only a complete below-threshold sample re-arms it. (verification: renderer)
- AC5 — An enabled hard-ceiling breach initiates cancellation exactly once per breached turn through the existing abortAndDrain path, reaches a settled stopped state or visible pending/failure state, and retains partial artifacts. (verification: Electron)
- AC6 — A persisted breach survives restart and relocation, blocks queued/scheduled/background/reused-session admission and silent retry, and clears only after explicit clean/recheck, ceiling change, or fresh-workspace selection; unknown preflight usage cannot authorize admission. (verification: Electron)
- AC7 — Retention selects only eligible idle finished system workspaces under lifecycle locks, excludes active/queued/fork/restore/unknown-ownership work, processes at most one session per minute, preserves lossless restore, and leaves final purge governed by data.trash.retention_days including 0. (verification: unit)
- AC8 — While an Agent turn runs, whole-volume health warns below 5 GiB with 30-second capacity polling, retains a distinct 1 GiB critical diagnostic, and remains visible independently of workspace warnings. (verification: Electron)

## Risks

Sampling huge trees can cost more than inspecting a single huge file; the global budget trades speed for staleness. Sparse/compressed/cloned files and hard links can create false
positives when logical bytes exceed allocated space. Label the metric honestly; do not promise physical-byte accuracy without filesystem-specific verification.
Cancellation can interrupt valid work and leave partial artifacts; a detached writer or slow teardown may continue growing. Retention compression itself needs disk headroom. Users
with legitimate large workspaces need a visible opt-out/raised ceiling and an inspect/export path before deletion is considered.

Rollback proposals: disable hard/retention policies with neutral defaults (`max_bytes=0`, `retention_days=0`, `retention_max_bytes=0`); soft warnings can be disabled with
`warn_bytes=0`. Revert P0 sampler wiring / volume-threshold change independently if it regresses performance. Preserve breach records and recovery journals for forward
compatibility; never delete artifacts merely to roll back a policy. Completed retention purges cannot be undone by changing a preference, so preview/consent and restore checks are
release requirements.

Non-goals: modifying CLI internals or attributing the deleted incident file with certainty; converting token/input/read limits into disk quotas; changing DB schema in this
proposal; automatic deletion of user workspaces; enabling finished-session deletion before a retention decision; claiming to bound all Agent-associated roots with one workspace
threshold; implementing separate-volume migration in these phases.

### Open decisions for maintainers

1. Ship warnings only by default, or enable a hard threshold by default after P0 data? Confirm the proposed 1 GiB warning and opt-in 10 GiB ceiling.
2. Keep enforcement restricted to system workspaces, or include explicitly enrolled user workspaces with a separate ownership/cleanup contract?
3. On breach, cancel and close the turn as proposed, or require a separately designed resumable pause contract?
4. What default retention age / aggregate budget, if any, may automatically move finished sessions to trash while honoring the existing final-purge grace period?
5. Accept logical-byte accounting and sampling overshoot, or require allocated-byte measurement / OS-backed isolation before claiming disk-exhaustion prevention?
6. Is a separate workspace-volume setting worth a later migration project, including runtime history, archive/restore, and disconnected-volume recovery?
