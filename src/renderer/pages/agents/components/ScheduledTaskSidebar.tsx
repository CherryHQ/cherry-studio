import { ChevronDown, CirclePlay, MoreHorizontal, Pause, PencilLine, Play, Trash2 } from 'lucide-react'
import { lazy, Suspense, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Button,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Tooltip
} from '@cherrystudio/ui'
import { ResourceList } from '@renderer/components/chat/resourceList/base'
import { getTriggerSummary } from '@renderer/components/ScheduledTask/scheduleForm'
import {
  type useAllTasks,
  useDeleteTask,
  useRunTask,
  useSetTaskEnabled,
  useUpdateTask
} from '@renderer/hooks/agent/useTasks'
import { cn } from '@renderer/utils/style'
import type { ScheduledTaskListItem } from '@shared/data/api/schemas/agents'

const TaskFormDialog = lazy(() =>
  import('@renderer/components/ScheduledTask/TaskFormDialog').then((module) => ({ default: module.TaskFormDialog }))
)

export interface ScheduledTaskGroupProps {
  status: 'active' | 'paused'
  source: ReturnType<typeof useAllTasks>
  selectedTaskId?: string
  agents: ReadonlyMap<string, string>
  onSelect: (taskId: string) => void
  onDeleted?: (taskId: string) => void | Promise<void>
}

function TaskRow({
  task,
  selected,
  agentName,
  onSelect,
  onDeleted
}: {
  task: ScheduledTaskListItem
  selected: boolean
  agentName?: string
  onSelect: () => void
  onDeleted?: () => void | Promise<void>
}) {
  const { t } = useTranslation()
  const { setTaskEnabled } = useSetTaskEnabled()
  const { runTask } = useRunTask()
  const { updateTask } = useUpdateTask()
  const { deleteTask } = useDeleteTask()
  const [busy, setBusy] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const paused = task.status === 'paused'
  const perform = async (command: () => Promise<unknown>) => {
    if (busy) return
    setBusy(true)
    try {
      await command()
    } finally {
      setBusy(false)
    }
  }
  return (
    <div
      className={cn(
        'group flex items-center gap-1 rounded-lg pr-1.5 shadow-none transition-colors',
        selected
          ? 'bg-resource-list-row-selected'
          : 'hover:bg-resource-list-row-hover has-[:focus-visible]:bg-resource-list-row-hover'
      )}>
      <Button
        variant="ghost"
        className={cn(
          'h-auto min-w-0 flex-1 justify-start rounded-lg bg-transparent px-2.5 py-1.5 text-left shadow-none hover:bg-transparent focus-visible:bg-transparent focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring',
          selected && 'text-resource-list-row-selected-foreground'
        )}
        aria-pressed={selected}
        onClick={onSelect}>
        <span className="flex w-full min-w-0 flex-col gap-0.5">
          <span className={cn('truncate text-[13px] leading-5', selected ? 'font-medium' : 'font-normal')}>
            {task.name}
          </span>
          <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
            <span className="min-w-0 truncate" title={agentName ?? task.agentId}>
              {agentName ?? task.agentId}
            </span>
            <span aria-hidden="true" className="shrink-0">
              ·
            </span>
            <span className="min-w-0 truncate" title={getTriggerSummary(task.trigger, t)}>
              {getTriggerSummary(task.trigger, t)}
            </span>
          </span>
        </span>
      </Button>
      <DropdownMenu>
        <Tooltip title={t('common.more')}>
          <DropdownMenuTrigger asChild>
            <ResourceList.HeaderActionButton
              className="bg-transparent opacity-0 shadow-none hover:bg-transparent focus-visible:bg-transparent focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring data-[state=open]:bg-transparent data-[state=open]:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 no-hover:opacity-100"
              disabled={busy}
              aria-label={`${t('common.more')} ${task.name}`}>
              <MoreHorizontal className="size-4" />
            </ResourceList.HeaderActionButton>
          </DropdownMenuTrigger>
        </Tooltip>
        <DropdownMenuContent align="end">
          <DropdownMenuGroup>
            <DropdownMenuItem
              disabled={busy}
              onSelect={() => void perform(() => setTaskEnabled(task.agentId, task.id, paused))}>
              {paused ? <CirclePlay /> : <Pause />}
              {t(paused ? 'scheduledTasks.resume' : 'agent.tasks.pause')}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={busy} onSelect={() => void perform(() => runTask(task.agentId, task.id))}>
              <Play />
              {t('scheduledTasks.runNow')}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={busy} onSelect={() => setEditOpen(true)}>
              <PencilLine />
              {t('common.edit')}
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem variant="destructive" disabled={busy} onSelect={() => setDeleteOpen(true)}>
              <Trash2 />
              {t('agent.tasks.delete.label')}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {editOpen && (
        <Suspense fallback={null}>
          <TaskFormDialog
            open
            task={task}
            agents={[{ id: task.agentId, name: agentName ?? task.agentId }]}
            onOpenChange={setEditOpen}
            onUpdate={async (patch) => !!(await updateTask(task.agentId, task.id, patch))}
          />
        </Suspense>
      )}
      {deleteOpen && (
        <ConfirmDialog
          open
          onOpenChange={setDeleteOpen}
          title={t('agent.tasks.delete.confirm')}
          confirmText={t('agent.tasks.delete.label')}
          cancelText={t('agent.tasks.cancel')}
          destructive
          confirmLoading={busy}
          cancelDisabled={busy}
          onConfirm={async () => {
            if (busy) return false
            setBusy(true)
            try {
              return await deleteTask(task.agentId, task.id, { onDeleted })
            } finally {
              setBusy(false)
            }
          }}
        />
      )}
    </div>
  )
}

export function ScheduledTaskGroup({
  status,
  source,
  selectedTaskId,
  agents,
  onSelect,
  onDeleted
}: ScheduledTaskGroupProps) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(true)
  const contentId = useId()
  return (
    <section
      aria-label={t(status === 'active' ? 'agent.tasks.status.active' : 'agent.tasks.status.paused')}
      className="flex flex-col gap-1">
      <h2 className="flex h-9 items-center">
        <Button
          variant="ghost"
          className="h-8 w-full justify-start gap-1.5 rounded-lg px-2.5 text-[13px] font-normal leading-5 text-muted-foreground hover:bg-resource-list-row-hover focus-visible:bg-resource-list-row-hover"
          aria-expanded={expanded}
          aria-controls={contentId}
          onClick={() => setExpanded((value) => !value)}>
          {t(status === 'active' ? 'agent.tasks.status.active' : 'agent.tasks.status.paused')}
          <span className="text-foreground-tertiary tabular-nums">{source.total}</span>
          <ChevronDown
            aria-hidden="true"
            className={cn('ml-auto size-3.5 transition-transform', !expanded && '-rotate-90')}
          />
        </Button>
      </h2>
      <div id={contentId} hidden={!expanded}>
        <div className="flex flex-col gap-1">
          {source.error ? (
            <div role="alert" className="p-2 text-sm">
              <p>{t('agent.tasks.error.loadFailed')}</p>
              <Button variant="ghost" onClick={() => void source.refetch()}>
                {t('common.retry')}
              </Button>
            </div>
          ) : source.isLoading ? (
            <p role="status" className="p-2 text-sm text-muted-foreground">
              {t('common.loading')}
            </p>
          ) : source.tasks.length === 0 ? (
            <p className="px-2.5 pb-3 text-xs text-foreground-tertiary">{t('scheduledTasks.emptyGroup')}</p>
          ) : (
            source.tasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                selected={task.id === selectedTaskId}
                agentName={agents.get(task.agentId)}
                onSelect={() => onSelect(task.id)}
                onDeleted={() => onDeleted?.(task.id)}
              />
            ))
          )}
          {(source.hasPrev || source.hasNext) && (
            <nav
              aria-label={t(status === 'active' ? 'agent.tasks.status.active' : 'agent.tasks.status.paused')}
              className="flex items-center justify-between gap-1 pt-2">
              <Button
                variant="ghost"
                size="sm"
                disabled={!source.hasPrev || source.isLoading}
                onClick={source.prevPage}>
                {t('common.previous')}
              </Button>
              <span className="text-xs text-muted-foreground">
                {source.page} / {source.pageCount}
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={!source.hasNext || source.isLoading}
                onClick={source.nextPage}>
                {t('common.next')}
              </Button>
            </nav>
          )}
        </div>
      </div>
    </section>
  )
}
