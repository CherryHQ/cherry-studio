import { CalendarClock, CalendarX2, MoreHorizontal, PencilLine, Play } from 'lucide-react'
import { lazy, Suspense, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Badge,
  Button,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Switch
} from '@cherrystudio/ui'
import { getTriggerSummary } from '@renderer/components/ScheduledTask/scheduleForm'
import { TaskRunSummaryLine } from '@renderer/components/ScheduledTask/TaskRunSummaryLine'
import { useAgent } from '@renderer/hooks/agent/useAgent'
import { useChannels } from '@renderer/hooks/agent/useChannels'
import {
  useDeleteTask,
  useRunTask,
  useSetTaskEnabled,
  useTask,
  useTaskLogs,
  useUpdateTask
} from '@renderer/hooks/agent/useTasks'
import { ErrorCode, toDataApiError } from '@shared/data/api/errors'
import type { TaskRunSummary } from '@shared/data/api/schemas/agents'
import type { ScheduledTaskEntity, TaskRunLogEntity } from '@shared/data/types/agent'
import type { AgentTaskPatch } from '@shared/ipc/schemas/ai'

import { useOptionalMessageListActions } from '../../MessageListProvider'
import type { ScheduledTaskResult } from './scheduledTaskResult'

// Loaded on first edit: the editor pulls in selectors and lists that most cards never open.
const TaskFormDialog = lazy(async () => {
  const module = await import('@renderer/components/ScheduledTask/TaskFormDialog')
  return { default: module.TaskFormDialog }
})

function formatNextRun(value: string) {
  const date = new Date(value)
  const time = date.toLocaleString(undefined, {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
  // Some locales place an inline zone name mid-date ("10/16 GMT+8 21:00"); append it instead.
  const zone = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' })
    .formatToParts(date)
    .find((part) => part.type === 'timeZoneName')?.value
  return zone ? `${time} (${zone})` : time
}

function toRunSummary(log: TaskRunLogEntity | undefined): TaskRunSummary | null {
  if (!log) return null
  if (log.status === 'running') return { status: 'running' }
  return { status: log.status, finishedAt: new Date(Date.parse(log.startedAt) + (log.durationMs ?? 0)).toISOString() }
}

export function ScheduledTaskToolInline({ result }: { result: ScheduledTaskResult }) {
  const { task, error } = useTask(result.taskId)
  // SWR keeps the last task alongside the refetch error, so a deletion must win over cached data.
  const isDeleted = !!error && toDataApiError(error).code === ErrorCode.NOT_FOUND

  if (task && !isDeleted) return <ScheduledTaskCard task={task} />
  return (
    <div className="my-1 flex min-h-12 max-w-full items-center gap-3 rounded-lg border border-border bg-background px-3 py-2">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <CalendarX2 aria-hidden="true" size={16} strokeWidth={1.8} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-foreground text-sm" title={result.name}>
          {result.name}
        </div>
        {isDeleted ? <ScheduledTaskDeletedLabel /> : null}
      </div>
    </div>
  )
}

function ScheduledTaskDeletedLabel() {
  const { t } = useTranslation()
  return <div className="text-muted-foreground text-xs">{t('agent.tasks.card.deleted')}</div>
}

function ScheduledTaskCard({ task }: { task: ScheduledTaskEntity }) {
  const { t } = useTranslation()
  const actions = useOptionalMessageListActions()
  const { agent } = useAgent(task.agentId)
  const { channels } = useChannels()
  const { updateTask } = useUpdateTask()
  const { setTaskEnabled } = useSetTaskEnabled()
  const { runTask } = useRunTask()
  const { deleteTask } = useDeleteTask()
  // Logs come newest first, so the head is the last run.
  const { logs } = useTaskLogs(task.agentId, task.id)
  const lastRun = toRunSummary(logs[0])
  const [editOpen, setEditOpen] = useState(false)
  const [editorRequested, setEditorRequested] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const agents = useMemo(() => [{ id: task.agentId, name: agent?.name ?? task.agentId }], [agent?.name, task])
  const channelNames = (task.channelIds ?? []).map(
    (channelId) => channels.find((channel) => channel.id === channelId)?.name || channelId
  )
  const isCompleted = task.status === 'completed'
  const { trigger } = task
  const isOnce = trigger.kind === 'once'
  // A one-time run's date is its schedule, so it is shown once instead of repeating as "next run".
  const schedule =
    trigger.kind === 'once'
      ? `${t('agent.tasks.schedule.once')} · ${formatNextRun(new Date(trigger.at).toISOString())}`
      : getTriggerSummary(trigger, t)
  const nextRun = !isOnce && task.status === 'active' && task.nextRun ? formatNextRun(task.nextRun) : undefined

  const runExclusive = async (operation: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await operation()
    } finally {
      setBusy(false)
    }
  }

  const handleUpdate = async (patch: AgentTaskPatch) => !!(await updateTask(task.agentId, task.id, patch))

  return (
    <div className="my-1 flex max-w-full items-start gap-3 rounded-lg border border-border bg-background px-3 py-2">
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-info-subtle text-info-subtle-foreground">
        <CalendarClock aria-hidden="true" size={16} strokeWidth={1.8} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1 truncate font-medium text-foreground text-sm" title={task.name}>
            {task.name}
          </div>
          {isCompleted || task.status === 'missed' ? (
            <Badge variant="secondary">
              {isCompleted ? t('agent.tasks.status.completed') : t('agent.tasks.status.missed')}
            </Badge>
          ) : (
            <Switch
              size="sm"
              className="shrink-0"
              checked={task.status === 'active'}
              disabled={busy}
              aria-label={t('agent.tasks.status.active')}
              title={task.status === 'active' ? t('agent.tasks.pause') : t('agent.tasks.resume')}
              onCheckedChange={(checked) => void runExclusive(() => setTaskEnabled(task.agentId, task.id, checked))}
            />
          )}
        </div>
        <div className="text-muted-foreground text-xs">
          {schedule}
          {nextRun ? ` · ${t('agent.tasks.nextRun')} ${nextRun}` : null}
        </div>
        <div className="truncate text-muted-foreground text-xs">
          {channelNames.length > 0
            ? `${t('agent.tasks.channels.label')}: ${channelNames.join(', ')}`
            : t('agent.tasks.card.inApp')}
        </div>
        {lastRun ? (
          <div className="text-xs">
            <TaskRunSummaryLine summary={lastRun} />
          </div>
        ) : null}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {!isCompleted ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => {
                setEditorRequested(true)
                setEditOpen(true)
              }}>
              <PencilLine size={14} />
              {t('common.edit')}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void runExclusive(() => runTask(task.agentId, task.id))}>
            <Play size={14} />
            {t('agent.tasks.run')}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="icon-sm" disabled={busy} aria-label={t('common.more')}>
                <MoreHorizontal size={14} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {actions?.navigateToRoute ? (
                <DropdownMenuItem
                  onSelect={() => void actions.navigateToRoute?.({ path: `/settings/scheduled-tasks/${task.id}` })}>
                  {t('agent.tasks.card.openInSettings')}
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem variant="destructive" onSelect={() => setDeleteConfirmOpen(true)}>
                {t('agent.tasks.delete.label')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {editorRequested ? (
        <Suspense fallback={null}>
          <TaskFormDialog
            open={editOpen}
            task={task}
            agents={agents}
            onOpenChange={setEditOpen}
            onUpdate={handleUpdate}
          />
        </Suspense>
      ) : null}
      <ConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        title={t('agent.tasks.delete.confirm')}
        confirmText={t('agent.tasks.delete.label')}
        cancelText={t('agent.tasks.cancel')}
        destructive
        onConfirm={() => runExclusive(() => deleteTask(task.agentId, task.id))}
      />
    </div>
  )
}
