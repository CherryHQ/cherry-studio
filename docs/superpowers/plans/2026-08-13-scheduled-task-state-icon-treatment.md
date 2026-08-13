# Scheduled Task State Icon Treatment Implementation Plan

> **For the AI implementation worker:** Required sub-skill: use `superpowers-zh:subagent-driven-development` (recommended) or `superpowers-zh:executing-plans` to execute this plan task by task. Track progress with the checkboxes below. The user explicitly opted out of TDD: implement the production styling first, then run the existing regression suite and real-UI verification. Do not create a failing test before implementation. Respect the user's earlier review preference by performing at most one final overall review, not repeated per-step reviews.

**Goal:** Make the scheduled-task card's left icon block communicate schedule state through a state-specific Lucide icon and subtle semantic color, while keeping every right-side execution result neutral.

**Architecture:** Keep the persisted schedule state, Job projection, card layout, routes, and translations unchanged. Add one renderer-local presentation helper and leaf component that maps `ScheduledTaskEntity['status']` to an icon and existing semantic token classes, then reuse the existing execution-summary component with neutral foreground classes. This is a presentation-only change: no shared component, data contract, database, IPC, Toast, or lifecycle work is needed.

**Tech stack:** TypeScript, React 19, Tailwind CSS semantic tokens, Lucide React, `@cherrystudio/ui`, Vitest, Testing Library, tracked Electron CDP verification.

---

## File structure

- Modify `src/renderer/pages/settings/TasksSettings.tsx`: own the schedule-state icon/color mapping and neutral execution-result treatment.
- Do not modify `src/renderer/pages/settings/__tests__/TasksSettings.test.tsx`: the existing suite already protects schedule labels, next-run validity, and history navigation; exact icon and color assertions would pin incidental DOM/CSS rather than user behavior.
- Create runtime evidence only under ignored `.context/cherry-electron-dev/evidence/`.
- Do not modify translations, shared schemas, main-process services, database files, migrations, Toast code, routing, or `packages/ui`.

## Task 1: Implement the approved presentation mapping

**Files:**

- Modify: `src/renderer/pages/settings/TasksSettings.tsx:98-118`
- Modify: `src/renderer/pages/settings/TasksSettings.tsx:360-416`
- Modify: `src/renderer/pages/settings/TasksSettings.tsx:1728-1730`

- [ ] **Step 1: Import the existing style combiner and state-specific Lucide icons**

Add the repository-standard `cn` utility and the two approved icons. Keep `CalendarClock` for active schedules:

```tsx
import { cn } from '@renderer/utils/style'

import {
  ArrowLeft,
  ArrowRight,
  Bot,
  CalendarCheck2,
  CalendarClock,
  CalendarFold,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleSlash,
  CircleStop,
  CircleX,
  Folder,
  Loader2,
  MoreHorizontal,
  PencilLine,
  Play,
  Plus,
  Trash2
} from 'lucide-react'
```

- [ ] **Step 2: Add one renderer-local schedule-state icon component**

Place the helper and leaf component immediately after `getTaskStatusLabel`. Use only existing semantic tokens. Apply the foreground class directly to the SVG so global SVG rules cannot turn it gray; keep the icon decorative because the adjacent neutral Badge exposes the same state as text:

```tsx
function getTaskScheduleStatusIconPresentation(status: ScheduledTaskEntity['status']) {
  switch (status) {
    case 'active':
      return {
        Icon: CalendarClock,
        wrapperClassName: 'bg-info-subtle text-info-subtle-foreground',
        iconClassName: 'text-info-subtle-foreground'
      }
    case 'paused':
      return {
        Icon: CalendarFold,
        wrapperClassName: 'bg-warning-subtle text-warning-subtle-foreground',
        iconClassName: 'text-warning-subtle-foreground'
      }
    case 'completed':
      return {
        Icon: CalendarCheck2,
        wrapperClassName: 'bg-success-subtle text-success-subtle-foreground',
        iconClassName: 'text-success-subtle-foreground'
      }
  }
}

const TaskScheduleStatusIcon: FC<{ status: ScheduledTaskEntity['status'] }> = ({ status }) => {
  const { Icon, wrapperClassName, iconClassName } = getTaskScheduleStatusIconPresentation(status)

  return (
    <div
      className={cn(
        'pointer-events-none relative z-1 flex size-10 shrink-0 items-center justify-center rounded-lg',
        wrapperClassName
      )}>
      <Icon size={20} aria-hidden className={iconClassName} />
    </div>
  )
}
```

Do not export this feature-local presentation helper or add a configurable shared component.

- [ ] **Step 3: Make every execution-result icon and label neutral**

Replace the blue, green, red, and muted result classes in `TaskRunSummaryLine` with one stronger neutral foreground. Preserve the icons, spinner animation, copy, time selection, and history link behavior:

```tsx
const TaskRunSummaryLine: FC<{ summary: NonNullable<ScheduledTaskEntity['runSummary']> }> = ({ summary }) => {
  const { t } = useTranslation()

  if (summary.status === 'running') {
    return (
      <span className="flex items-center gap-1.5 text-foreground">
        <Loader2 aria-hidden className="size-3 text-foreground motion-safe:animate-spin" />
        {t('agent.tasks.runSummary.running')}
      </span>
    )
  }

  const time = formatTaskCardTime(summary.finishedAt ?? summary.startedAt)
  if (summary.status === 'completed') {
    return (
      <span className="flex items-center gap-1.5 text-foreground">
        <CircleCheck aria-hidden className="size-3 text-foreground" />
        {t('agent.tasks.runSummary.completed', { time })}
      </span>
    )
  }
  if (summary.status === 'failed') {
    return (
      <span className="flex items-center gap-1.5 text-foreground">
        <CircleX aria-hidden className="size-3 text-foreground" />
        {t('agent.tasks.runSummary.failed', { time })}
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1.5 text-foreground">
      <CircleStop aria-hidden className="size-3 text-foreground" />
      {t('agent.tasks.runSummary.cancelled', { time })}
    </span>
  )
}
```

Keep the next-run line at `text-muted-foreground`; this preserves the stronger-result/weaker-next-run hierarchy without semantic result colors.

- [ ] **Step 4: Render the schedule-specific icon component in each card**

Replace only the current fixed icon block:

```tsx
<TaskScheduleStatusIcon status={task.status} />
```

Do not change the neutral status Badge, card overlay link, right-side history link, next-run rule, chevron, or wrapping layout.

- [ ] **Step 5: Format and run focused static checks after implementation**

Run:

```bash
pnpm exec biome format --write src/renderer/pages/settings/TasksSettings.tsx
pnpm exec oxlint src/renderer/pages/settings/TasksSettings.tsx --deny-warnings
pnpm exec eslint src/renderer/pages/settings/TasksSettings.tsx
pnpm exec biome check src/renderer/pages/settings/TasksSettings.tsx
pnpm typecheck:web
pnpm i18n:check
git diff --check
```

Expected: every command exits `0`; no translation, shared, main-process, or database file changes.

## Task 2: Verify behavior and visuals after implementation

**Files:**

- Verify `src/renderer/pages/settings/__tests__/TasksSettings.test.tsx` without editing it.
- Create evidence only under `.context/cherry-electron-dev/evidence/`.

**Regression protected by the existing component suite:** removing or breaking the schedule-state text, valid next-run rule, or independent history link must still fail. Exact Lucide class names and Tailwind classes intentionally remain outside component tests because they are visual implementation details verified in Electron.

- [ ] **Step 1: Run the existing focused renderer suite**

Run after the production code is complete:

```bash
pnpm vitest run --project renderer src/renderer/pages/settings/__tests__/TasksSettings.test.tsx
```

Expected: the complete `TasksSettings` suite passes with no test-file modification.

- [ ] **Step 2: Verify and reuse the tracked Electron instance**

Use `cherry-electron-dev` and follow `.agents/skills/cherry-electron-dev/references/electron-instance.md` with the persistent policy. Verify the tracked Electron PID, exact repository cwd, CDP and inspector listener ownership, current Git HEAD, and `/windows/main/index.html` target before interacting with the UI. Replace only the exact tracked instance if its launch revision cannot reliably render the checked-out code; leave the healthy instance running afterward.

- [ ] **Step 3: Refresh only drifting demo rows when necessary**

Use the existing development records prefixed `【状态演示】`. If Scheduler activity has changed their runtime state or active `nextRun` values, update only the already identified demo schedule and Job ids in one guarded SQLite transaction. Confirm before and after that no non-demo schedule or Job matches those ids. Do not change tracked database code, schemas, migrations, or user-created records.

- [ ] **Step 4: Verify the visual contract in light and dark themes**

At the tracked window size, verify all of the following:

1. Active schedules use `CalendarClock` with info/blue subtle background and matching icon foreground.
2. Paused schedules use `CalendarFold` with warning/amber subtle background and matching icon foreground.
3. Completed schedules use `CalendarCheck2` with success/green subtle background and matching icon foreground.
4. Running, completed, failed, and cancelled result icons have the same computed neutral foreground as their adjacent result text.
5. An active schedule whose last run failed retains the active blue left block while the failed result remains neutral.
6. The name-adjacent Badge remains neutral for all schedule states; valid next-run text remains muted; paused and completed schedules show no stale next-run line.
7. Cards remain readable with no overlap at the tracked size. Restore the profile's original theme after verification.

Capture screenshots and a small DOM/computed-style evidence file:

```text
.context/cherry-electron-dev/evidence/scheduled-task-state-icons-light.png
.context/cherry-electron-dev/evidence/scheduled-task-state-icons-dark.png
.context/cherry-electron-dev/evidence/scheduled-task-state-icons-computed.json
```

- [ ] **Step 5: Audit scope without repeating full-repository gates**

Run:

```bash
git status --short
git diff --check
git diff HEAD -- src/renderer/pages/settings/TasksSettings.tsx
```

Expected: the production diff is limited to the approved imports, local status presentation, neutral run-summary classes, and card icon call site. Do not rerun `pnpm test`, `pnpm lint`, `pnpm format`, `pnpm build:check`, or `pnpm test:lint` for this renderer-only visual follow-up: the branch already recorded the full-suite result, and the closest relevant formatter, linters, web typecheck, component suite, and real Electron UI provide proportionate verification.

- [ ] **Step 6: Commit and verify the production change**

```bash
git add src/renderer/pages/settings/TasksSettings.tsx
git commit -S --signoff -m "feat(scheduled-tasks): style schedule state icons"
git cat-file commit HEAD | sed -n '1,24p'
git log -1 --show-signature --format='%H%n%B'
```

Expected: the commit contains only `TasksSettings.tsx`, includes a `gpgsig` header and `Signed-off-by` trailer, and reports a good signature. Do not push or open a pull request unless the user requests it.
