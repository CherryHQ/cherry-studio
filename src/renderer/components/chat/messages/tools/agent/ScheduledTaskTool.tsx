import { CalendarClock, CalendarX2, ChevronRight, MoreHorizontal, Pause, PencilLine, Play, Trash2 } from 'lucide-react'
import { lazy, Suspense, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Button,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  NormalTooltip
} from '@cherrystudio/ui'
import { getTriggerSummary } from '@renderer/components/ScheduledTask/scheduleForm'
import { TaskRunSummaryLine } from '@renderer/components/ScheduledTask/TaskRunSummaryLine'
import { useAgent } from '@renderer/hooks/agent/useAgent'
import { useChannels } from '@renderer/hooks/agent/useChannels'
import { useDeleteTask, useRunTask, useSetTaskEnabled, useTask, useUpdateTask } from '@renderer/hooks/agent/useTasks'
import { ErrorCode, toDataApiError } from '@shared/data/api/errors'
import type { ScheduledTaskListItem } from '@shared/data/api/schemas/agents'
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

export function ScheduledTaskToolInline({ result }: { result: ScheduledTaskResult }) {
  const { t } = useTranslation()
  const { task, error, isLoading, refetch } = useTask(result.taskId)
  // A deletion must take precedence over SWR's last cached task.
  const isDeleted = !!error && toDataApiError(error).code === ErrorCode.NOT_FOUND

  if (task && !isDeleted) return <ScheduledTaskCard task={task} />
  const Icon = isDeleted ? CalendarX2 : CalendarClock
  return (
    <div className="my-2 flex w-full max-w-lg items-start gap-2.5 rounded-lg border border-border-subtle bg-card p-3">
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" strokeWidth={1.5} />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-foreground text-sm" title={result.name}>
          {result.name}
        </div>
        <div className="mt-1 text-muted-foreground text-xs" role="status">
          {isDeleted ? t('agent.tasks.card.deleted') : error ? t('agent.tasks.card.loadFailed') : t('common.loading')}
        </div>
      </div>
      {error && !isDeleted ? (
        <Button variant="ghost" size="sm" disabled={isLoading} onClick={() => void refetch()}>
          {t('common.retry')}
        </Button>
      ) : null}
    </div>
  )
}

function ScheduledTaskCard({ task }: { task: ScheduledTaskListItem }) {
  const { t } = useTranslation()
  const actions = useOptionalMessageListActions()
  const { agent } = useAgent(task.agentId)
  const { channels } = useChannels()
  const { updateTask } = useUpdateTask()
  const { setTaskEnabled } = useSetTaskEnabled()
  const { runTask } = useRunTask()
  const { deleteTask } = useDeleteTask()
  const lastRun = task.runSummary
  const [editOpen, setEditOpen] = useState(false)
  const [editorRequested, setEditorRequested] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const agents = useMemo(() => [{ id: task.agentId, name: agent?.name ?? task.agentId }], [agent?.name, task])
  const channelNames = (task.channelIds ?? []).map(
    (channelId) => channels.find((channel) => channel.id === channelId)?.name || channelId
  )
  const isCompleted = task.status === 'completed'
  const canToggle = task.status === 'active' || task.status === 'paused'
  const isRunning = lastRun?.status === 'running' || lastRun?.status === 'queued'
  const statusLabel = isCompleted
    ? t('agent.tasks.card.triggered')
    : task.status === 'active'
      ? t('agent.tasks.card.enabled')
      : task.status === 'paused'
        ? t('agent.tasks.status.paused')
        : t('agent.tasks.status.missed')
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
    <div className="my-2 w-full max-w-lg rounded-lg border border-border-subtle bg-card p-3">
      <div className="flex items-center gap-2.5">
        <CalendarClock aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.5} />
        <div className="min-w-0 flex-1 truncate font-medium text-foreground text-sm" title={task.name}>
          {task.name}
        </div>
        <span className="shrink-0 text-muted-foreground text-xs">{statusLabel}</span>
        <DropdownMenu>
          <NormalTooltip content={t('common.more')}>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="icon-sm" disabled={busy} aria-label={t('common.more')}>
                <MoreHorizontal aria-hidden="true" size={16} />
              </Button>
            </DropdownMenuTrigger>
          </NormalTooltip>
          <DropdownMenuContent align="end">
            {!isCompleted ? (
              <DropdownMenuItem
                onSelect={() => {
                  setEditorRequested(true)
                  setEditOpen(true)
                }}>
                <PencilLine aria-hidden="true" />
                {t('common.edit')}
              </DropdownMenuItem>
            ) : null}
            {canToggle ? (
              <DropdownMenuItem
                onSelect={() =>
                  void runExclusive(() => setTaskEnabled(task.agentId, task.id, task.status !== 'active'))
                }>
                {task.status === 'active' ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
                {task.status === 'active' ? t('agent.tasks.pause') : t('agent.tasks.resume')}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem
              disabled={isRunning}
              onSelect={() => void runExclusive(() => runTask(task.agentId, task.id))}>
              <Play aria-hidden="true" />
              {t('agent.tasks.run')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => setDeleteConfirmOpen(true)}>
              <Trash2 aria-hidden="true" />
              {t('agent.tasks.delete.label')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="ms-6.5 mt-0.5 flex flex-wrap items-end gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1 basis-56 space-y-1.5">
          <div className="text-muted-foreground text-xs leading-relaxed">
            {schedule}
            {nextRun ? ` · ${t('agent.tasks.nextRun')} ${nextRun}` : null}
          </div>
          {channelNames.length > 0 ? (
            <div className="truncate text-muted-foreground text-xs" title={channelNames.join(', ')}>
              {t('agent.tasks.channels.label')}: {channelNames.join(', ')}
            </div>
          ) : null}
          {lastRun ? (
            <div className="text-xs" role="status">
              <TaskRunSummaryLine summary={lastRun} />
            </div>
          ) : null}
        </div>
        {actions?.navigateToRoute ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ms-auto text-muted-foreground"
            onClick={() => void actions.navigateToRoute?.({ path: `/settings/scheduled-tasks/${task.id}` })}>
            {t('agent.tasks.card.viewTask')}
            <ChevronRight aria-hidden="true" size={14} />
          </Button>
        ) : null}
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
