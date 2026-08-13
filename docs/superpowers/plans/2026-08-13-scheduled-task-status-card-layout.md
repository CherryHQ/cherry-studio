# Scheduled Task Status Card Layout Implementation Plan

> **For the AI implementation worker:** Required sub-skill: use `superpowers-zh:subagent-driven-development` (recommended) or `superpowers-zh:executing-plans` to execute this plan task by task. Track progress with the checkboxes below. The user explicitly opted out of TDD: implement production behavior first, then add the smallest behavior-focused regression tests.

**Goal:** Move schedule state beside the task name and use the card's right side for a lightweight current/latest run result plus the next valid run time.

**Architecture:** Keep the existing `ScheduledTaskEntity` and `runSummary` projection unchanged. Add one renderer-local status block that derives display-only next-run validity from `task.status === 'active' && task.nextRun !== null`, reuses the existing run-summary link, and composes existing `Badge`, Lucide icons, semantic tokens, and translation keys. Do not add persistence, IPC, shared component, Toast, or lifecycle changes.

**Tech stack:** TypeScript, React 19, TanStack Router, Tailwind CSS, `@cherrystudio/ui`, Lucide React, i18next, Vitest, Testing Library, Playwright over the tracked Electron CDP endpoint.

---

## File structure

- Modify `src/renderer/pages/settings/TasksSettings.tsx`: own the renderer-only display rule, status block, schedule-state placement, and card composition.
- Modify `src/renderer/pages/settings/__tests__/TasksSettings.test.tsx`: protect the approved display matrix and preserve history navigation behavior.
- Do not modify shared schemas, main-process services, database tables, migrations, route contracts, Toast code, or `packages/ui`; the existing data and component contracts already support the design.

## Task 1: Implement the approved card hierarchy

**Files:**

- Modify: `src/renderer/pages/settings/TasksSettings.tsx:371-416`
- Modify: `src/renderer/pages/settings/TasksSettings.tsx:1705-1724`

- [ ] **Step 1: Generalize the existing card timestamp formatter**

Rename `formatRunSummaryTime` to `formatTaskCardTime` because the same compact month/day/time formatting now serves both historical results and future runs. Update the existing terminal-run call site:

```tsx
function formatTaskCardTime(value: string) {
  return new Date(value).toLocaleString(undefined, {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
}

// Inside TaskRunSummaryLine:
const time = formatTaskCardTime(summary.finishedAt ?? summary.startedAt)
```

- [ ] **Step 2: Add the renderer-local two-line status block**

Place this component immediately after `TaskRunSummaryLine`. It must keep the execution-result line as the only independent link and must hide stale next-run values for paused or completed schedules:

```tsx
const TaskCardRunStatus: FC<{ task: ScheduledTaskEntity }> = ({ task }) => {
  const { t } = useTranslation()
  const nextRun = task.status === 'active' ? task.nextRun : null

  if (!task.runSummary && !nextRun) return null

  return (
    <div className="flex flex-col items-end gap-0.5 whitespace-nowrap text-xs">
      {task.runSummary && (
        <Link
          to="/settings/scheduled-tasks/$taskId"
          params={{ taskId: task.id }}
          search={{ tab: 'history', runId: task.runSummary.id }}
          className="pointer-events-auto relative z-2 rounded-sm outline-none hover:underline focus-visible:underline focus-visible:underline-offset-2">
          <TaskRunSummaryLine summary={task.runSummary} />
        </Link>
      )}
      {nextRun && (
        <span className="text-muted-foreground">
          {t('agent.tasks.nextRun')} · {formatTaskCardTime(nextRun)}
        </span>
      )}
    </div>
  )
}
```

This intentionally reuses `agent.tasks.nextRun`, which already exists in every locale, so no i18n catalog change or generated translation churn is needed.

- [ ] **Step 3: Move the schedule-state badge beside the title**

Replace the plain title with a shrink-safe title row. Keep one neutral `secondary` treatment for `active`, `paused`, and `completed`:

```tsx
<ItemTitle className="min-w-0 max-w-full">
  <span className="truncate">{task.name}</span>
  <Badge variant="secondary" className="shrink-0">
    {getTaskStatusLabel(task.status, t)}
  </Badge>
</ItemTitle>
```

Do not add schedule-state semantic colors. Execution color remains the only chromatic status signal on the card.

- [ ] **Step 4: Reserve the right side for run and schedule timing**

Remove the old run-summary link from `ItemContent`. Replace the old right-side schedule badge with `TaskCardRunStatus`, leaving the chevron as the final element:

```tsx
<ItemContent className="pointer-events-none relative z-1 min-w-0">
  <ItemTitle className="min-w-0 max-w-full">
    <span className="truncate">{task.name}</span>
    <Badge variant="secondary" className="shrink-0">
      {getTaskStatusLabel(task.status, t)}
    </Badge>
  </ItemTitle>
  <ItemDescription className="truncate text-xs leading-4">
    {agents.find((agent) => agent.id === task.agentId)?.name ?? task.agentId} ·{' '}
    {getTriggerSummary(task.trigger, t)}
  </ItemDescription>
</ItemContent>
<ItemActions className="pointer-events-none relative z-1 ml-auto shrink-0">
  <TaskCardRunStatus task={task} />
  <ChevronRight size={16} className="text-foreground-tertiary" />
</ItemActions>
```

Rely on the existing `Item` flex-wrap behavior at constrained widths. Do not add a new breakpoint, fixed panel width, colored pill, or bottom status band.

- [ ] **Step 5: Run focused static checks**

Run:

```bash
pnpm exec eslint src/renderer/pages/settings/TasksSettings.tsx
pnpm exec oxlint src/renderer/pages/settings/TasksSettings.tsx --deny-warnings
pnpm exec biome check src/renderer/pages/settings/TasksSettings.tsx
pnpm i18n:check
```

Expected: all four commands exit `0`; no locale files change.

- [ ] **Step 6: Commit the production change**

```bash
git add src/renderer/pages/settings/TasksSettings.tsx
git commit -S --signoff -m "feat(scheduled-tasks): reorganize card status details"
```

Expected: the commit contains the production renderer change only and has both a `gpgsig` header and `Signed-off-by` trailer.

## Task 2: Add behavior-focused regression coverage after implementation

**Files:**

- Modify: `src/renderer/pages/settings/__tests__/TasksSettings.test.tsx:877-905`

**Regressions worth protecting:**

- A running task must retain its independently clickable history link while also showing its next valid run.
- A never-run active task must show only its next run.
- A paused or completed task must not display a stale persisted `nextRun`.
- Schedule state must remain visible after moving beside the title.

**Intentionally not tested:** exact DOM position, Tailwind classes, icon color, flex wrapping, and every terminal-status permutation. Those are visual composition details or already share the same `TaskRunSummaryLine` contract; verify them in Electron instead of pinning implementation markup.

- [ ] **Step 1: Extend the existing history-link test with a valid next run**

Keep the failed-result navigation assertion and add an active `nextRun` plus the next-run label assertion:

```tsx
it('keeps schedule status visible and opens the projected run in history', async () => {
  navigationMocks.taskId = undefined
  taskDataMock.task = {
    ...taskDataMock.defaultTask,
    nextRun: '2026-06-26T09:00:00.000Z',
    runSummary: {
      id: 'log-1',
      status: 'failed',
      startedAt: '2026-06-25T00:00:00.000Z',
      finishedAt: '2026-06-25T00:01:00.000Z'
    }
  }

  render(<TasksSettings />)

  expect((await screen.findAllByText('agent.tasks.status.active')).length).toBeGreaterThan(1)
  expect(screen.getByText(/agent.tasks.nextRun/)).toBeInTheDocument()
  const runLink = screen.getByRole('link', { name: /agent.tasks.runSummary.failed/ })
  expect(runLink).toHaveAttribute('href', '/settings/scheduled-tasks/task-1?tab=history&runId=log-1')
  fireEvent.click(runLink)
  expect(navigationMocks.navigate).toHaveBeenCalledWith({
    to: '/settings/scheduled-tasks/$taskId',
    params: { taskId: 'task-1' },
    search: { tab: 'history', runId: 'log-1' }
  })
})
```

- [ ] **Step 2: Add one matrix test for running, never-run, and paused tasks**

Use three task rows so one test protects the distinct branches without asserting layout internals:

```tsx
it('shows only valid next-run information for each task state', async () => {
  navigationMocks.taskId = undefined
  taskDataMock.tasks = [
    {
      ...taskDataMock.defaultTask,
      id: 'running-task',
      name: 'Running task',
      nextRun: '2026-06-26T09:00:00.000Z',
      runSummary: {
        id: 'running-log',
        status: 'running',
        startedAt: '2026-06-25T00:00:00.000Z',
        finishedAt: null
      }
    },
    {
      ...taskDataMock.defaultTask,
      id: 'never-run-task',
      name: 'Never-run task',
      nextRun: '2026-06-26T10:00:00.000Z'
    },
    {
      ...taskDataMock.defaultTask,
      id: 'paused-task',
      name: 'Paused task',
      status: 'paused',
      nextRun: '2026-06-26T11:00:00.000Z'
    }
  ]

  render(<TasksSettings />)

  expect(await screen.findByRole('link', { name: 'agent.tasks.runSummary.running' })).toHaveAttribute(
    'href',
    '/settings/scheduled-tasks/running-task?tab=history&runId=running-log'
  )
  expect(screen.getAllByText(/agent.tasks.nextRun/)).toHaveLength(2)
  expect((await screen.findAllByText('agent.tasks.status.paused')).length).toBeGreaterThan(1)
})
```

- [ ] **Step 3: Run the focused renderer suite**

Run:

```bash
pnpm vitest run --project renderer src/renderer/pages/settings/__tests__/TasksSettings.test.tsx
```

Expected: the `TasksSettings` suite passes with the two status-card contracts above.

- [ ] **Step 4: Commit the regression tests**

```bash
git add src/renderer/pages/settings/__tests__/TasksSettings.test.tsx
git commit -S --signoff -m "test(scheduled-tasks): cover status card timing"
```

Expected: the commit contains only the focused renderer test update and has both a `gpgsig` header and `Signed-off-by` trailer.

## Task 3: Verify the real UI and repository gates

**Files:**

- Create evidence only under ignored `.context/cherry-electron-dev/evidence/`; modify tracked files only if verification finds a task-scoped defect.

- [ ] **Step 1: Reuse and verify the tracked Electron instance**

Follow `.agents/skills/cherry-electron-dev/references/electron-instance.md` with the persistent policy. Verify the Electron PID, exact workspace cwd, CDP listener ownership, current Git HEAD, and `/windows/main/index.html` target before controlling the UI. Replace only the exact tracked instance if its launch commit no longer matches the implementation commit.

- [ ] **Step 2: Verify the seeded display matrix in the task list**

Using the existing isolated development database records prefixed `【状态演示】`, reload Scheduled Tasks and verify:

1. `active`, `paused`, and `completed` badges appear beside names with the same neutral badge style.
2. Running uses a blue spinner and blue text; success uses green icon/text; failure uses red icon/text; cancelled uses neutral icon/text.
3. The active running, successful, and cancelled schedules show the next valid run on the second right-side line.
4. The never-run active task shows only next run.
5. The paused task and completed one-shot do not show stale or invalid next-run text.
6. The card remains readable at the tracked window size in both light and dark themes; no right-side text overlaps the title or chevron. Restore the profile's original theme after capturing evidence.

Capture before/after evidence as:

```text
.context/cherry-electron-dev/evidence/scheduled-task-status-card-layout-light.png
.context/cherry-electron-dev/evidence/scheduled-task-status-card-layout-dark.png
```

- [ ] **Step 3: Verify navigation boundaries**

Click an execution-result line and verify the task detail opens with `tab=history&runId=<jobId>` and reveals the matching history row. Return to the list, click the task name/card outside the execution line, and verify it opens the default task detail route without history search state. The next-run line must not be a separate link.

- [ ] **Step 4: Run repository-required checks**

Run in this order:

```bash
pnpm lint
pnpm test
pnpm format
pnpm build:check
pnpm test:lint
```

Expected: task-scoped checks and tests pass. If a repository-wide command reproduces a pre-existing unrelated failure, retain its exact output, run the closest targeted equivalent, and report the blocker without changing unrelated user files.

- [ ] **Step 5: Audit final scope and commit integrity**

Run:

```bash
git status --short
git diff main...HEAD -- src/renderer/pages/settings/TasksSettings.tsx src/renderer/pages/settings/__tests__/TasksSettings.test.tsx
git cat-file commit HEAD | sed -n '1,24p'
git log -2 --format='%H%n%B'
```

Expected: no uncommitted task files remain; the incremental diff contains only the approved card-layout behavior and focused tests; both new commits are signed and DCO-signed. Do not push or open a pull request unless the user requests it.
