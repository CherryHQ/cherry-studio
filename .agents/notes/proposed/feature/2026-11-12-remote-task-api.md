# Agent Note: Remote Task API and result discovery

Status: proposed

English | [中文](2026-11-12-remote-task-api.zh.md)

## Problem

Scheduled task results became undiscoverable through the ordinary-session filter shared by remote `agent.sessions.list`. Tasks and executions already exist in the scheduler database; adding a second remote task model would introduce inconsistent state.

The public API must remain stable while internal entities evolve. This requires one business source of values and an explicit, typed projection to an independently owned wire schema, rather than copying scheduling rules or exporting internal entities wholesale.

Source baseline: `8dfe578c0e6ada83a9b6c0d41489c4c3a6814476`. This is an implementation proposal, not evidence of shipped support. The existing [scheduled tasks page Spec](2026-10-31-scheduled-tasks-page.md) continues to own desktop page behavior; this note owns remote queries and result discovery and does not supersede that Spec.

## Proposal

### Scope

Deliver five read-only Task methods and restore task-result discovery through the existing session list. Reuse the current Agent grant, RPC transport, pagination budgets, message reads and subscriptions. No new hello flags, universal revisions, subscriptions, scheduler, database table, or dependency.

Task creation/editing/deletion, pause/resume/run-now, Session state queries and file preview are separate deliveries. This slice adds no mobile task-management page. API availability is verified over the actual RPC connection; the existing mobile session flow is the regression acceptance path.

### Public methods

Inputs are strict schemas; result objects follow the existing protocol's extensible-object convention. IDs, UTC timestamps, content references and page limits reuse the protocol primitives. Public TypeScript types are inferred from these public schemas only.

| Method | Input | Output |
|---|---|---|
| `agent.tasks.list` | `{ agentId?, statuses?, cursor?, limit? }` | `{ items: TaskSummary[], nextCursor }` |
| `agent.tasks.get` | `{ taskId }` | `{ task: TaskDetail }` |
| `agent.tasks.runs.list` | `{ taskId, cursor?, limit? }` | `{ items: TaskRun[], nextCursor }` |
| `agent.tasks.runs.get` | `{ taskId, runId }` | `{ run: TaskRun }` |
| `agent.tasks.content.read` | `{ taskId, contentId, revision, offset, maxBytes }` | `{ contentId, revision, offset, dataBase64, nextOffset, eof, sha256 }` |

`statuses` is a non-empty set of `active | paused | completed | missed`; omission selects all four. Apply Agent visibility, heartbeat exclusion and status filtering before pagination. An unknown `agentId` filter returns an empty list; a missing or hidden by-ID task/run returns `NOT_FOUND`. Verify run membership in the requested task, not merely that the Job ID exists.

### Stable task data and its business source

The following is an illustrative public shape. The implementation owns it in `remote-protocol`, without a dependency on `@shared` or Electron. A thin main-process mapper accepts the business type and returns the schema-inferred public type. Do not use casts to conceal incompatibility.

```ts
type TaskSummary = {
  taskId: string
  agentId: string
  name: string
  status: 'active' | 'paused' | 'completed' | 'missed'
  trigger: TaskTrigger
  nextRunAt: string | null
  createdAt: string
  updatedAt: string
}

type TaskDetail = TaskSummary & {
  prompt: { text: string } | { ref: ContentRef }
  timeoutMinutes: number
  workspace: AgentWorkspaceSelection
  reuse: { kind: 'fresh' } | { kind: 'reuse'; sessionId: string | null }
}
```

| Public data | Business source | Allowed projection |
|---|---|---|
| Identity, name, creation and update times | `ScheduledTaskEntity` | Rename `id` to `taskId`; encode the existing values |
| Task status | `ScheduledTaskEntity.status` | Exhaustive public-state mapping; never derive it from `enabled` again |
| Next execution | `ScheduledTaskEntity.nextRun` | Normalize absence to `null`; do not calculate schedules in remote |
| Prompt, trigger, timeout | `ScheduledTaskEntity` | Bounded text/content reference and explicit schedule encoding |
| Workspace and reuse | `ScheduledTaskEntity` | Map existing workspace identity and reuse fields; expose no absolute paths |

Internal field renames are absorbed by the mapper; public names do not change. New internal enum members must force an explicit projection decision at compile time. Same-type semantic changes still require review: type checking cannot prove their compatibility.

`TaskTrigger` freezes the existing cron/interval/once meanings without re-exporting the internal schema: cron has `expr`, optional `timezone` and `limit`; interval has `ms` and optional `anchor`; once has `at` in Unix milliseconds. Preserve configured defaults as omission; clients display these settings and use `nextRunAt` rather than independently scheduling. A missing cron timezone means the host scheduler's timezone, not the phone's.

Lists include `trigger` and `updatedAt` so clients can display the schedule and last business update without fetching every detail. `updatedAt` is the existing task timestamp, not a separate API revision or a promise that only user edits change it.

Do not include `latestRun` or `runSummary` in the initial task response. Existing run summaries are UI projections with optimistic cancellation; they are not authoritative execution records. Do not return channels, raw Job input/output/metadata, or provider credentials.

### Execution facts and result location

Add `listTaskRuns(taskId, options)` and `getTaskRun(taskId, runId)` to `AgentTaskService`. Both first resolve the visible task, then query `JobService` with type `agent.task` and the schedule identity. Extract structured output and the saved session relation in this owner. Define the main-only internal `TaskRunRecord` beside `AgentTaskService`; it can derive its persisted fields from `JobSnapshot`, because it is not the public contract.

The public `TaskRun` carries `runId`, `taskId`, `createdAt`, `scheduledAt`, `summary`, and `resultLocation`, plus the state-specific facts below. Reads must not start a task or runtime.

`summary` is a nullable display excerpt from the owner's structured output `result` string, bounded to 200 UTF-16 units to match the existing task output. Truncation preserves complete surrogate pairs; malformed legacy Unicode is replaced. Missing or non-string results yield `null`, never a JSON serialization of the raw payload. This is not the full reply and does not determine `outcome`; full content remains in the linked result session.

| Business fact | Public state and fields |
|---|---|
| `pending` / `delayed` | `queued`; `startedAt: null`; preserve `scheduledAt` and `cancelRequested` |
| `running` | `running`; real `startedAt`; preserve `cancelRequested` |
| `completed` | `completed`; nullable real `startedAt`, real `finishedAt`, `outcome: executed \| skipped \| unknown` |
| `failed` | `failed`; nullable real `startedAt`, real `finishedAt`, bounded safe failure |
| `cancelled` | `cancelled` only after the persisted transition; nullable real `startedAt`, real `finishedAt` |

`outcome` comes from structured output `kind`; old records without it yield `unknown`. Do not infer success from result text. A run ID identifies the persisted Job across its retries, not an execution attempt or Session. Retry timing follows that Job's current persisted fields. Missing start/finish timestamps remain null, including legacy terminal records; never fabricate a time.

Keep `getTaskLogs`' existing desktop display behavior, but share its saved-session extraction with the new run records. Never reconstruct facts from its collapsed status or synthetic start time.

Resolve the session from persisted metadata, falling back to the already-supported output field for older records. Verify the linked session is an addressable conversation under the same Agent. `resultLocation` is `none` when no link has been recorded; `session` with the verified ID when readable; or `unavailable` when a recorded result can no longer be opened. A reused session can be shared by multiple runs. The API opens the associated conversation; it does not promise to jump to the exact reply. Job retention remains unchanged.

### Bounded reads, authorization and failures

Reuse the current Agent grant at every RPC entry. A configuration-only device cannot read tasks. Revocation and expiry continue through `requireAgent`; no new task permission scope is introduced. Device authorization does not replace task/run ownership checks.

Use offset pagination with default 20 and maximum 100. Task and run ordering is `createdAt DESC, id DESC`; add only the missing deterministic tie-breaker in the existing owners. A compact opaque cursor binds the offset to the method and normalized filters. It grants no access and promises no cross-page snapshot. Do not replace the existing task scan with a new indexing system. Do not hydrate unbounded execution histories or issue a log query per task row.

Reuse the response byte budget and the existing page-size reduction approach. Compute the next cursor from the number actually returned; an oversized single item returns `RESOURCE_EXHAUSTED / ITEM_TOO_LARGE`. Invalid cursors return the existing cursor error and cannot silently become page zero. Clients deduplicate by ID and restart pagination on refresh.

Task prompt text reuses the existing 4,096 UTF-16-unit inline threshold and `ContentRef` shape. Longer text uses the task-specific content read, capped at 24,576 bytes per call. Bind `contentId` to the prompt digest and keep the existing decimal revision encoding; validate both against the current task on every read. This catches content changes even when two writes have the same millisecond timestamp, without a new stored revision or snapshot cache. Changed content returns `REVISION_EXPIRED`; clients refetch the detail and restart. Never truncate a prompt silently.

Errors use existing RPC/failure contracts: schema failure, forbidden/revoked authorization, `NOT_FOUND`, `REVISION_EXPIRED`, and `RESOURCE_EXHAUSTED`. Hide raw exception stacks and Job payloads. Old hosts lacking the new methods produce an unsupported-method outcome; consumers must not translate it into an empty task list. Validate supported release combinations without adding per-feature version flags.

### Restore existing session discovery

Require `scope: ordinary | all-conversations` in the internal `AgentSessionService.listByCursor` query and remove its default argument. Keep the public DataApi and remote request schemas unchanged. The desktop DataApi handler explicitly chooses `ordinary`; the remote adapter chooses `all-conversations`. Preserve explicit-ID/trash lookups, pin ordering, visibility and background-session exclusion. Update every direct caller and focused consumer test so omissions fail type checking.

The existing session cursor is a positional continuation, not a snapshot. Preserve its encoding; a cursor obtained before this repair may miss newly visible items until the normal refresh from page one. Do not build a cursor-version migration for this bug fix.

### File-level implementation sequence

Paths in this table are proposed changes, not files already implemented. Keep new modules within existing directories.

| Step | Files | Work and verification |
|---|---|---|
| 1. Business facts | `src/main/data/services/AgentTaskService.ts`; `src/main/data/services/JobService.ts` | Add internal run records and owner queries; make existing task query usable for combined Agent/status filters; preserve log display; verify state, ownership and paging against a real migrated DB |
| 2. Discovery repair | `src/main/data/services/AgentSessionService.ts`; `src/main/data/api/handlers/agentSessions.ts`; `src/main/services/remoteAccess/agentQueries.ts` and direct callers | Require internal scope; restore remote task sessions without exposing background or trashed sessions; verify pinned and later pages |
| 3. Public contract | New `packages/remote-protocol/src/agent/tasks.ts`; existing `agent/methods.ts` and `src/agent.ts` | Own bounded task schemas and the five-method map; compose/export through the existing Agent entry; verify protocol schema and type checks |
| 4. Remote projection | New `src/main/services/remoteAccess/agentTaskQueries.ts`; existing `agentHandlers.ts` | Pure explicit field maps plus owner calls, bounded pages/content and authorization; register the complete Task handler map; verify through RPC |
| 5. Delivery | `packages/remote-protocol/README.md`, a package changeset, affected owner docs and consumer integration | Build and publish through the existing package workflow; verify current mobile task-result discovery and a typed client following task → run → session → messages |

The Task method names, parameter types and result types derive from its schema map. The actual Task handler object uses a complete mapped type and is iterated for registration; adding a method without a handler fails compilation. Limit this change to the Task group; do not rebuild every remote method or introduce an operation framework. Existing Agent methods still receive consumer regression coverage.

Pause/resume/run-now follow later through `AgentJobsService` and existing command receipts. `runTask` currently returns `boolean`; before exposing run-now, it must return the actual enqueued/deduplicated run identity and associate receipt and admission atomically. No guessing from the newest log and no prerequisite config revision. This work is not an acceptance dependency of the query slice.

### Validation plan

These scoped checks define implementation validation; completed evidence is recorded below. Database tests use `setupTestDatabase()` and the unified mocks. Protocol tests assert meaningful failures and public shape; avoid tests that merely mirror a mapper's implementation.

```sh
pnpm --filter @cherrystudio/remote-protocol test tests/contracts.test.ts tests/tasks.test.ts
pnpm --filter @cherrystudio/remote-protocol typecheck
pnpm --filter @cherrystudio/remote-protocol build
pnpm test:main src/main/data/services/__tests__/AgentTaskService.test.ts src/main/data/services/__tests__/AgentTaskService.integration.test.ts src/main/data/services/__tests__/JobService.test.ts
pnpm test:main src/main/data/services/__tests__/AgentSessionService.test.ts src/main/data/services/__tests__/AgentSessionVisibility.test.ts src/main/ai/agents/__tests__/runAgentTask.visibility.test.ts src/main/ai/agents/__tests__/AgentJobsService.test.ts src/main/ai/agents/__tests__/AgentLifecycleService.workspace.test.ts
pnpm test:main src/main/services/remoteAccess/__tests__/agent.test.ts src/main/services/remoteAccess/__tests__/agentPagination.test.ts src/main/services/remoteAccess/__tests__/agentTaskQueries.test.ts
pnpm test:shared src/shared/data/api/schemas/__tests__/agents.test.ts src/shared/data/api/schemas/__tests__/agentSessions.test.ts
pnpm typecheck:node
```

`tests/tasks.test.ts` is a proposed new protocol test file. Add any additional direct consumers revealed by type checking with explicit paths; do not run the full local suite. Run scoped lint/formatting, `pnpm check --plan`, `pnpm change:scope --base <verified-ref>` and `pnpm docs:affected --base <verified-ref>` for each implementation layer. Inspect the scheduler-page, Agent-lifecycle and remote-access documentation candidates semantically.

The RPC scenario uses a paired Agent-granted client: list tasks → get detail → list/get a specific run → open its session → read messages. Repeat after disconnect/reconnect and with more than one page. Revoke the grant and repeat a read; reject it. Separately open the existing mobile session list after a scheduled run and confirm its result remains reachable. Report type/unit/RPC/device/package-publish results separately.

### Local implementation validation

The focused protocol, business-service, existing-consumer, shared-schema and RPC checks passed locally on 2026-11-12, along with package build/type checks, main-process type checking, scoped lint/format checks and documentation governance. The typed RPC scenario uses real local WebSockets and Noise encryption, continues Task/run pagination across reconnect, and opens saved session messages. A virtual-source compile check rejected an omitted session scope (TS2345), a missing Task handler (TS2741), and an unhandled run status (TS1360), without changing working-tree sources. Mobile-device acceptance and package publication remain pending; the local checks do not establish either.

## Alternatives considered

| Alternative | Reason not selected |
|---|---|
| Export internal entities with Pick/Omit | Internal renames, enums and private fields could silently change the public contract |
| Compute task state or save task rows in remote | Duplicates the existing business owner and creates divergent state |
| Return current display logs as execution facts | Queued jobs, cancellation and start times have presentation-specific meanings |
| Add per-feature hello versions, collection revisions or subscriptions first | Not required to deliver these queries and the discovery repair |
| Bundle task controls, CRUD and file preview | Introduces independent side-effect and authorization work before read access is restored |

## Acceptance criteria

- AC1 — Existing remote session discovery includes ordinary and task conversations across pinned and subsequent pages; desktop ordinary discovery remains unchanged and hidden/background/trash sessions stay excluded. (verification: unit + RPC + device; owner: session implementer)
- AC2 — Task listing applies Agent visibility, heartbeat exclusion and all four status filters before deterministic pagination, including more than one page and combined filters. (verification: unit + RPC; owner: task data implementer)
- AC3 — Task list and detail derive their values, including trigger and update time, from the business owner; public fields remain independently defined and no credentials, raw Job payloads or absolute paths are serialized. (verification: unit + protocol; owner: protocol implementer)
- AC4 — Queued, running, completed, failed and cancelled executions preserve true start/finish and cancellation facts, including retries, never-started failures and old output records. Display summaries are bounded, Unicode-safe and independent of outcome. (verification: unit + RPC; owner: task data implementer)
- AC5 — Run lookup verifies the requested task and resolves only its saved readable result conversation; never-run, removed-session, reused-session and retained-history cases do not fall back to an unrelated session. (verification: unit + RPC; owner: task data implementer)
- AC6 — Long prompt reads stay within wire budgets, detect content replacement including same-millisecond writes, and never mix versions or silently truncate data. (verification: unit + RPC; owner: remote implementer)
- AC7 — Configuration-only, expired and revoked authorizations cannot read task data; all five methods pass through the existing authorization boundary. (verification: RPC; owner: remote implementer)
- AC8 — A Task method without a registered typed handler, an omitted internal query scope or an unhandled business-state variant fails type checking. (verification: typecheck; owner: contract implementer)
- AC9 — Task and run pagination respects item/byte limits, does not skip items when reducing a page for size, rejects invalid or mismatched cursors and surfaces indivisible oversized items. (verification: unit + RPC; owner: remote implementer)
- AC10 — A real typed RPC client reaches a scheduled result through task/run/session/message APIs after reconnect; the published package and existing mobile discovery path are separately verified. (verification: RPC + device + package; owner: integration implementer)

## Risks

The existing task query scans candidate schedules before slicing; this proposal bounds responses but does not promise SQL-level task pagination. Offset pages can repeat or omit items during concurrent edits and require refresh. New hosts restore discovery for old clients, but new Task methods require a host that implements them; no all-version interoperability promise is made.

Run history can be cleaned up while conversations survive, and several runs can share one session. These are explicit API outcomes, not reasons to fabricate missing records. Package publication and mobile/device validation are completion evidence, not implied by a desktop build.

The user approved local implementation in this session on 2026-11-12. The note remains proposed pending the repository review and delivery workflow; local validation does not imply package publication or mobile-device acceptance.
