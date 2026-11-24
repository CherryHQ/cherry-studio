import { ChevronDown, Clock, Play, Plus, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Badge,
  Button,
  ButtonGroup,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Switch
} from '@cherrystudio/ui'
import { getTriggerSummary } from '@renderer/components/ScheduledTask/scheduleForm'
import { TaskFormDialog } from '@renderer/components/ScheduledTask/TaskFormDialog'
import { formatTaskCardTime } from '@renderer/components/ScheduledTask/TaskRunSummaryLine'
import { useQuery } from '@renderer/data/hooks/useDataApi'
import {
  TASKS_PAGE_LIMIT,
  useAgentTasks,
  useCreateTask,
  useDeleteTask,
  useRunTask,
  useSetTaskEnabled,
  useTask,
  useUpdateTask
} from '@renderer/hooks/agent/useTasks'
import { cn } from '@renderer/utils/style'
import type { ScheduledTaskEntity } from '@shared/data/types/agent'

type Editing = { task?: ScheduledTaskEntity }

const ADD_BUTTON_CLASS =
  'h-7 min-h-0 rounded-md border border-border bg-transparent font-normal text-muted-foreground text-xs shadow-none hover:bg-accent/50 hover:text-foreground'

/**
 * One Agent's scheduled tasks: pause switch, schedule, and last run per row. A new task is asked
 * of the Agent in a conversation by default, or made in the shared task form from the menu; existing
 * tasks open that form with this Agent fixed, where editing adds history, Run now, and Delete.
 */
export function AgentTasksPage({
  agentId,
  agentName,
  onCreateWithAgent
}: {
  agentId: string
  agentName: string
  onCreateWithAgent: () => void
}) {
  const { t } = useTranslation()
  const [page, setPage] = useState(1)
  const { tasks, total, isLoading } = useAgentTasks(agentId, page)
  const pageCount = Math.max(1, Math.ceil((total ?? 0) / TASKS_PAGE_LIMIT))
  useEffect(() => {
    if (total !== undefined && page > pageCount) setPage(pageCount)
  }, [page, pageCount, total])
  const { setTaskEnabled } = useSetTaskEnabled()
  const { createTask } = useCreateTask()
  const { updateTask } = useUpdateTask()
  // Kept mounted after first use so the form can finish its exit animation.
  const [editing, setEditing] = useState<Editing>()
  const [formOpen, setFormOpen] = useState(false)
  const agents = [{ id: agentId, name: agentName }]
  const open = (next: Editing) => {
    setEditing(next)
    setFormOpen(true)
  }

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {tasks.length === 0 ? (
        <div className="flex flex-col items-center gap-1.5 rounded-md border border-border-subtle border-dashed px-4 py-5 text-center">
          <Clock className="size-5 text-foreground-tertiary" strokeWidth={1.4} />
          <span className="text-foreground-tertiary text-xs">
            {isLoading ? t('common.loading') : t('library.config.dialogs.edit.tasks.empty')}
          </span>
        </div>
      ) : (
        tasks.map((task) => {
          const paused = !task.enabled
          return (
            <div
              key={task.id}
              className="flex min-w-0 items-center gap-2.5 rounded-md border border-border-subtle bg-accent/15 px-2.5 py-2 transition-colors hover:bg-accent/40">
              <Clock className={cn('size-4 shrink-0', paused ? 'text-foreground-tertiary' : 'text-foreground')} />
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                aria-label={`${t('common.edit')} ${task.name}`}
                onClick={() => open({ task })}>
                <div className="flex items-center gap-1.5 truncate text-foreground text-sm">
                  {task.name}
                  {paused ? (
                    <Badge
                      variant="secondary"
                      className="border-0 bg-secondary px-1.5 py-0 font-normal text-[10px] text-muted-foreground leading-3.5">
                      {t('agent.tasks.status.paused')}
                    </Badge>
                  ) : null}
                </div>
                <div className="truncate text-muted-foreground text-xs">
                  {getTriggerSummary(task.trigger, t)}
                  {task.lastRun
                    ? ` · ${t('library.config.dialogs.edit.tasks.last_run', { time: formatTaskCardTime(task.lastRun) })}`
                    : ''}
                </div>
              </button>
              {task.status === 'completed' ? null : (
                <Switch
                  size="sm"
                  aria-label={`${t(paused ? 'scheduledTasks.resume' : 'agent.tasks.pause')} ${task.name}`}
                  checked={!paused}
                  onCheckedChange={(enabled) => void setTaskEnabled(agentId, task.id, enabled)}
                />
              )}
            </div>
          )
        })
      )}
      {(page > 1 || pageCount > 1) && (
        <nav aria-label={t('settings.scheduledTasks.title')} className="flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" disabled={page === 1 || isLoading} onClick={() => setPage(page - 1)}>
            {t('common.previous')}
          </Button>
          <span className="text-muted-foreground text-xs">
            {page} / {pageCount}
          </span>
          <Button variant="ghost" size="sm" disabled={page >= pageCount || isLoading} onClick={() => setPage(page + 1)}>
            {t('common.next')}
          </Button>
        </nav>
      )}
      <ButtonGroup className="w-fit">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onCreateWithAgent}
          className={cn(ADD_BUTTON_CLASS, 'gap-1 px-2')}>
          <Plus size={12} />
          {t('library.config.dialogs.edit.tasks.add_with_agent')}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={t('library.config.dialogs.edit.tasks.add')}
              className={cn(ADD_BUTTON_CLASS, 'w-6 px-0')}>
              <ChevronDown size={12} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={() => open({})}>
              {t('library.config.dialogs.edit.tasks.add_manually')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </ButtonGroup>

      {editing?.task ? (
        <TaskFormDialog
          open={formOpen}
          onOpenChange={setFormOpen}
          agents={agents}
          agentLocked
          task={editing.task}
          onUpdate={async (patch) => !!(await updateTask(agentId, editing.task!.id, patch))}
          footerStart={
            <TaskEditActions agentId={agentId} taskId={editing.task.id} onDeleted={() => setFormOpen(false)} />
          }>
          <TaskRunHistory agentId={agentId} taskId={editing.task.id} />
        </TaskFormDialog>
      ) : editing ? (
        <TaskFormDialog
          open={formOpen}
          onOpenChange={setFormOpen}
          agents={agents}
          agentLocked
          onCreate={async (id, form) => !!(await createTask(id, form))}
        />
      ) : null}
    </div>
  )
}

function TaskEditActions({ agentId, taskId, onDeleted }: { agentId: string; taskId: string; onDeleted: () => void }) {
  const { t } = useTranslation()
  const { runTask } = useRunTask()
  const { deleteTask } = useDeleteTask()
  const { task, error } = useTask(taskId)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const running = useRef(false)
  const [submitting, setSubmitting] = useState(false)
  const run = async () => {
    if (!task || task.status === 'completed' || running.current) return
    running.current = true
    setSubmitting(true)
    try {
      await runTask(agentId, taskId)
    } finally {
      running.current = false
      setSubmitting(false)
    }
  }

  return (
    <div className="mr-auto flex items-center gap-1">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="text-muted-foreground hover:text-destructive!"
        onClick={() => setConfirmOpen(true)}>
        <Trash2 className="size-3.5" />
        {t('agent.tasks.delete.label')}
      </Button>
      {task && !error && task.status !== 'completed' ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          disabled={submitting || task.runSummary?.status === 'running' || task.runSummary?.status === 'queued'}
          onClick={() => void run()}>
          <Play className="size-3.5" />
          {t('scheduledTasks.runNow')}
        </Button>
      ) : null}
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t('agent.tasks.delete.confirm')}
        description={t('agent.tasks.delete.description')}
        confirmText={t('agent.tasks.delete.label')}
        cancelText={t('agent.tasks.cancel')}
        destructive
        onConfirm={async () => {
          const deleted = await deleteTask(agentId, taskId)
          if (deleted) onDeleted()
          return deleted
        }}
      />
    </div>
  )
}

const HISTORY_LIMIT = 5
const RUN_STATUS_KEYS = {
  running: 'agent.tasks.logs.running',
  completed: 'agent.tasks.logs.completed',
  failed: 'agent.tasks.logs.failed',
  cancelled: 'agent.tasks.logs.cancelled'
} as const

function TaskRunHistory({ agentId, taskId }: { agentId: string; taskId: string }) {
  const { t } = useTranslation()
  const { data, error } = useQuery('/agents/:agentId/tasks/:taskId/logs', {
    params: { agentId, taskId },
    query: { limit: HISTORY_LIMIT }
  })
  const logs = data?.items ?? []

  return (
    <div className="rounded-md border border-border-subtle p-3 text-xs">
      <p className="font-medium text-foreground">{t('agent.tasks.logs.label')}</p>
      {error ? (
        <p className="mt-1 text-muted-foreground">{t('agent.tasks.logs.loadError')}</p>
      ) : logs.length === 0 ? (
        <p className="mt-1 text-muted-foreground">{t('agent.tasks.logs.empty')}</p>
      ) : (
        <ul className="mt-1 grid gap-0.5 text-muted-foreground">
          {logs.map((log) => (
            <li key={log.id}>
              {formatTaskCardTime(log.startedAt)} · {t(RUN_STATUS_KEYS[log.status])}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
