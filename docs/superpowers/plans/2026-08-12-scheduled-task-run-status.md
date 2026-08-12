# Scheduled Task Run Status Implementation Plan

> **Execution note:** The user explicitly opted out of TDD for this change. Implement production behavior first, then add the smallest behavior-focused regression tests.

**Goal:** Add a read-only Job run projection to scheduled tasks, show it as a distinct overview-card status link, and deep-link to the matching history row without adding persistence or Toast behavior.

**Architecture:** `AgentTaskService` composes one `runSummary` per requested schedule from existing `jobTable` rows in one page-bounded read. The `agent.task` handler publishes task and log projection changes at execution start and settlement. The renderer treats route search as controlled detail-tab state and uses the existing `DataTable` row styling API plus a local marker ref for reveal/highlight.

**Tech stack:** TypeScript, Drizzle ORM + SQLite, Zod, React 19, TanStack Router, `@cherrystudio/ui`, Vitest + Testing Library, i18next.

---

## Task 1: Add the read-only run projection

**Files:**

- Modify: `src/shared/data/api/schemas/agents.ts`
- Modify: `src/main/data/services/AgentTaskService.ts`
- Modify: `src/main/data/services/__tests__/AgentTaskService.test.ts`

### Implementation

1. Add `TaskRunSummarySchema` and `TaskRunSummary`, reusing the four-value status contract from `TaskRunLogEntitySchema`.
2. Add required nullable `runSummary` to `ScheduledTaskEntitySchema`; do not add a table column, migration, or new lifecycle enum.
3. In `AgentTaskService`, query `jobTable` directly as an allowed read-only cross-service composition. Use one SQL window query for the current schedule-id batch:
   - active (`pending`, `delayed`, `running`) ranks ahead of terminal;
   - newest active wins among overlapping executions;
   - otherwise newest terminal wins;
   - pending/delayed collapse to display status `running`;
   - missing rows map to `null`.
4. Reuse the same batch helper for single-task reads and list reads; pass summaries into the mapper so there is no renderer N+1 request.
5. Add a Job-lifecycle notification that extends the task projection endpoints with `/agents/:agentId/tasks/:taskId/logs`; keep ordinary task/session mutation notifications unchanged so they do not refresh unrelated run history.

### Regression tests added after implementation

- A real-DB service test catches loss of active-over-terminal precedence and newest-active selection.
- A real-DB service test catches incorrect newest-terminal selection and status preservation.
- A no-run assertion catches accidental placeholder summaries.
- The notification contract assertion catches history refresh being omitted.

### Verify

Run:

```bash
pnpm vitest run --project main src/main/data/services/__tests__/AgentTaskService.test.ts
```

Expected: all `AgentTaskService` tests pass.

## Task 2: Publish background start and settlement changes

**Files:**

- Modify: `src/main/ai/agents/agentTaskJobHandler.ts`
- Modify: `src/main/ai/agents/__tests__/agentTaskJobHandler.test.ts`
- Modify: `src/renderer/hooks/agent/useTasks.ts`
- Modify: `src/renderer/hooks/agent/__tests__/useTasks.test.ts`

### Implementation

1. At `agent.task` handler execution start, read the current Job snapshot by `ctx.jobId`; when it has a schedule id, publish the task read-model change before running the Agent.
2. At every scheduled settlement (`completed`, `failed`, or `cancelled`), publish in a `finally` path after preserving the existing three-failure circuit breaker and pause behavior.
3. Subscribe `useTaskLogs` to the existing log endpoint data-change signal, filtering by task id before refetching.
4. Leave manual-run invalidation and the existing “task triggered” Toast untouched.

### Regression tests added after implementation

- Handler tests catch missing start and settlement publication, including non-failed settlements.
- Hook test catches a matching background log change that no longer refetches history.
- Existing Toast tests ensure no new success/failure notification behavior is introduced.

### Verify

Run:

```bash
pnpm vitest run --project main src/main/ai/agents/__tests__/agentTaskJobHandler.test.ts
pnpm vitest run --project renderer src/renderer/hooks/agent/__tests__/useTasks.test.ts
```

Expected: both targeted suites pass.

## Task 3: Add overview status links and history deep links

**Files:**

- Modify: `src/renderer/pages/settings/TasksSettings.tsx`
- Modify: `src/renderer/routes/settings/scheduled-tasks.$taskId.tsx`
- Modify: `src/renderer/pages/settings/__tests__/TasksSettings.test.tsx`
- Modify: `src/renderer/i18n/locales/en-us.json`
- Modify: `src/renderer/i18n/locales/zh-cn.json`
- Update through generator if required: other files under `src/renderer/i18n/locales/`

### Implementation

1. Validate optional detail search values `tab=prompt|general|history` and non-empty `runId` on the task detail route.
2. Read route search in `TasksSettings` and control the existing Tabs component. Changing away from history clears `runId`; the default detail route remains the prompt tab.
3. Render a third card line only when `runSummary` exists, with semantic icon/text for running, succeeded, failed, or cancelled.
4. Keep the right badge as schedule status. Keep the card’s default detail link separate from the run-summary link so the DOM contains no nested interactive elements.
5. Link the run summary to `{ tab: 'history', runId: summary.id }`.
6. Pass `runId` into `TaskLogsInline`; apply `DataTable.rowClassName` to the matching record and attach a local marker ref so `scrollIntoView({ block: 'nearest' })` reveals it after render. If the row is absent from the loaded page, show normal history.
7. Preserve the existing Session button in each history row as the secondary navigation target.
8. Add bilingual labels through i18next; run sync/check rather than hardcoding visible text.

### Regression tests added after implementation

- List test catches loss of the execution label, loss of schedule badge, or accidental navigation of the status link to the default detail view.
- Detail test catches `tab=history&runId=...` failing to open history and identify the matching run.
- Existing default-route test continues to protect prompt-tab behavior.

### Verify

Run:

```bash
pnpm vitest run --project renderer src/renderer/pages/settings/__tests__/TasksSettings.test.tsx
pnpm i18n:check
```

Expected: component suite and i18n validation pass.

## Task 4: Review, repository checks, and tracked Electron verification

**Files:**

- Modify only if verification exposes a task-scoped defect.

### Static review

1. Confirm every changed production line traces to the approved design.
2. Confirm no Toast call, persistence schema, migration, JobManager contract, or shared UI component was added.
3. Confirm direct `jobTable` access is read-only and remains inside the task read model.

### Repository verification

Run targeted tests first, then:

```bash
pnpm lint
pnpm test
pnpm format
NODE_OPTIONS=--max-old-space-size=8192 pnpm build:check
pnpm test:lint
```

The repository currently contains an unrelated nested `.claude/worktrees/distracted-joliot-cede0e` checkout that baseline ESLint traverses. If it still causes the known unrelated failures, retain the exact output, run the closest task-scoped checks, and report the repository-level blocker without modifying that user-owned worktree.

### Electron verification

Using the tracked Electron instance:

1. Open Scheduled Tasks and confirm no-run cards have no execution line.
2. Trigger a task and confirm the card shows running while the schedule badge remains unchanged.
3. Let it settle and confirm the final status replaces running without a new Toast.
4. Click the status line and confirm history opens and the correct row is revealed/highlighted.
5. Click the rest of the card and confirm the default prompt tab opens.

### Completion

Only after the available checks pass, stage the task-scoped files and create a signed, DCO-signed Conventional Commit. Do not push or open a PR unless the user requests it.
