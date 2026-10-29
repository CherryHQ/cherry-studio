import { chunk } from 'es-toolkit'
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleStop,
  Clock3,
  EyeOff,
  Loader2,
  OctagonAlert,
  Plus
} from 'lucide-react'
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Badge,
  Button,
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  Tooltip
} from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { dataApiService } from '@renderer/data/DataApiService'
import { usePersistCache } from '@renderer/data/hooks/useCache'
import { useQuery } from '@renderer/data/hooks/useDataApi'
import { useTaskDashboard } from '@renderer/hooks/agent/useTaskDashboard'
import { useAllTasks, useCreateTask } from '@renderer/hooks/agent/useTasks'
import { ipcApi } from '@renderer/ipc'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { openSettingsTab } from '@renderer/services/mainWindowNavigation'
import { toast } from '@renderer/services/toast'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { cn } from '@renderer/utils/style'
import { createDurationFormatter } from '@renderer/utils/time'
import type { DashboardEntry } from '@shared/ai/agentTaskDashboard'
import { isDataApiNotFoundError } from '@shared/data/api/errors'
import { AGENTS_MAX_LIMIT } from '@shared/data/api/schemas/agents'
import { isAgentSessionNotFoundError } from '@shared/ipc/errors/ai'

const TaskFormDialog = lazy(() =>
  import('@renderer/components/ScheduledTask/TaskFormDialog').then((module) => ({ default: module.TaskFormDialog }))
)

function useVisibleTime(enabled: boolean): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined
    const sync = () => {
      clearInterval(timer)
      if (!enabled || document.hidden) return
      setNow(Date.now())
      timer = setInterval(() => setNow(Date.now()), 1000)
    }
    sync()
    document.addEventListener('visibilitychange', sync)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', sync)
    }
  }, [enabled])
  return now
}

function PageButtons({
  hasPrev,
  hasNext,
  prev,
  next
}: {
  hasPrev: boolean
  hasNext: boolean
  prev: () => void
  next: () => void
}) {
  const { t } = useTranslation()
  if (!hasPrev && !hasNext) return null
  return (
    <div className="flex justify-end gap-1 px-2 pb-1">
      <Button variant="ghost" size="icon-sm" aria-label={t('common.previous')} disabled={!hasPrev} onClick={prev}>
        <ChevronLeft aria-hidden />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label={t('common.next')} disabled={!hasNext} onClick={next}>
        <ChevronRight aria-hidden />
      </Button>
    </div>
  )
}

/** Shared by every Agent sidebar layout; the surrounding sidebar owns the height limit. */
export function AgentTaskDashboard({ enabled }: { enabled: boolean }) {
  const { t, i18n } = useTranslation()
  const formatDuration = useMemo(() => createDurationFormatter(i18n.language), [i18n.language])
  const running = useTaskDashboard()
  const tasks = useAllTasks(enabled)
  const { createTask } = useCreateTask()
  const [createOpen, setCreateOpen] = useState(false)
  const { data: agents } = useQuery('/agents', { query: { limit: AGENTS_MAX_LIMIT }, enabled })
  const [, setShowTaskDashboard] = usePreference('agent.task_dashboard.visible')
  const [showRunningCount, setShowRunningCount] = usePreference('agent.task_dashboard.show_running_count')
  const [showScheduledCount, setShowScheduledCount] = usePreference('agent.task_dashboard.show_scheduled_count')
  const [collapsed, setCollapsed] = usePersistCache('ui.agent.task_dashboard.collapsed_groups')
  const [stopping, setStopping] = useState<Set<string>>(() => new Set())
  const [unavailable, setUnavailable] = useState<Set<string>>(() => new Set())
  const now = useVisibleTime(enabled && !collapsed.includes('running') && running.items.length > 0)
  const taskStatusLabels = {
    active: t('agent.tasks.status.active'),
    paused: t('agent.tasks.status.paused'),
    completed: t('agent.tasks.status.completed'),
    missed: t('agent.tasks.status.missed')
  }
  const toggle = (group: string) =>
    setCollapsed((current) =>
      current.includes(group) ? current.filter((item) => item !== group) : [...current, group]
    )
  const errorToast = (error: unknown) =>
    toast.error(formatErrorMessageWithPrefix(error, t('agent.task_dashboard.action_failed')))
  const markUnavailable = (id: string) => setUnavailable((current) => new Set([...current, id]))

  const open = async (row: DashboardEntry) => {
    try {
      if (row.sessionId) {
        await ipcApi.request('navigation.focus_or_open_conversation', {
          target: { conversationType: 'agent', conversationId: row.sessionId },
          title: row.nameSnapshot,
          messageId: row.messageAnchor
        })
      } else if (row.taskId) {
        await dataApiService.get(`/agent-tasks/${row.taskId}`)
        openSettingsTab(`/settings/scheduled-tasks/${encodeURIComponent(row.taskId)}`)
      } else markUnavailable(row.id)
    } catch (error) {
      if (isDataApiNotFoundError(error) || isAgentSessionNotFoundError(error)) markUnavailable(row.id)
      else errorToast(error)
    }
  }

  const stop = async (row: DashboardEntry) => {
    const ids = [...row.runIds]
    setStopping((current) => new Set([...current, row.id]))
    try {
      const results = (
        await Promise.all(chunk(ids, 500).map((runIds) => ipcApi.request('ai.agent.task_dashboard.stop', { runIds })))
      ).flat()
      if (results.some((result) => result.result === 'failed')) toast.error(t('agent.task_dashboard.stop_failed'))
    } catch (error) {
      errorToast(error)
    } finally {
      setStopping((current) => {
        const next = new Set(current)
        next.delete(row.id)
        return next
      })
    }
  }

  const renderRow = (row: DashboardEntry) => {
    const missing = unavailable.has(row.id) || (!row.sessionId && !row.taskId)
    const isStopping = stopping.has(row.id)
    const Icon = row.blockedOn ? OctagonAlert : Loader2
    const status = isStopping
      ? t('agent.task_dashboard.stopping')
      : row.blockedOn
        ? t('agent.task_dashboard.approval')
        : t('agent.task_dashboard.running')
    return (
      <li key={row.id} className="group flex min-w-0 items-center gap-1 px-1">
        <Tooltip content={missing ? t('agent.task_dashboard.unavailable') : row.nameSnapshot} asChild>
          <Button
            variant="ghost"
            disabled={missing}
            className="h-auto min-w-0 flex-1 justify-start gap-2 whitespace-normal px-2 py-1.5 text-left"
            onClick={() => void open(row)}>
            <Icon aria-hidden className={cn('size-3.5 shrink-0', !row.blockedOn && 'motion-safe:animate-spin')} />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-xs">{row.nameSnapshot || t('agent.task_dashboard.untitled')}</span>
              <span className="truncate text-xs text-muted-foreground">{row.agentNameSnapshot}</span>
              <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                <span>{missing ? t('agent.task_dashboard.unavailable') : status}</span>
                <span aria-live="off">{formatDuration(Math.max(0, now - row.startedAt))}</span>
                {row.runCount > 1 && <span>{t('agent.task_dashboard.run_count', { count: row.runCount })}</span>}
              </span>
            </span>
          </Button>
        </Tooltip>
        <Tooltip content={t('agent.task_dashboard.stop')} asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={isStopping}
            className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
            aria-label={t('agent.task_dashboard.stop_named', {
              name: row.nameSnapshot || t('agent.task_dashboard.untitled')
            })}
            onClick={() => void stop(row)}>
            <CircleStop aria-hidden />
          </Button>
        </Tooltip>
      </li>
    )
  }
  const header = (group: 'running' | 'scheduled', title: string, total: number) => {
    const showCount = group === 'running' ? showRunningCount : showScheduledCount
    const setShowCount = group === 'running' ? setShowRunningCount : setShowScheduledCount
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="flex items-center px-2 py-1">
            <Button
              variant="ghost"
              size="sm"
              className="min-w-0 flex-1 justify-start px-1 font-medium"
              aria-expanded={!collapsed.includes(group)}
              onClick={() => toggle(group)}>
              <ChevronDown
                aria-hidden
                className={cn('size-3 transition-transform', collapsed.includes(group) && '-rotate-90')}
              />
              <span className="truncate">{title}</span>
              {showCount && (
                <Badge variant="secondary" className="ml-auto">
                  {total}
                </Badge>
              )}
            </Button>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          {group === 'scheduled' && (
            <>
              <ContextMenuItem onSelect={() => setCreateOpen(true)}>
                <Plus aria-hidden />
                {t('settings.scheduledTasks.createTitle')}
              </ContextMenuItem>
              <ContextMenuSeparator />
            </>
          )}
          <ContextMenuCheckboxItem
            checked={showCount}
            onCheckedChange={(checked) => void setShowCount(checked).catch(errorToast)}>
            {t('agent.task_dashboard.show_count')}
          </ContextMenuCheckboxItem>
        </ContextMenuContent>
      </ContextMenu>
    )
  }
  return (
    <section
      aria-label={t('agent.task_dashboard.title')}
      className="max-h-[40%] min-h-0 shrink-0 overflow-y-auto border-b border-border-subtle py-1"
      data-ui="agent-task-dashboard">
      <div className="flex items-center justify-between px-3">
        <span className="text-xs text-muted-foreground">{t('agent.task_dashboard.title')}</span>
        <Tooltip content={t('agent.task_dashboard.hide')} asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-6 text-muted-foreground"
            aria-label={t('agent.task_dashboard.hide')}
            onClick={() =>
              void setShowTaskDashboard(false)
                .then(() => EventEmitter.emit(EVENT_NAMES.TASK_DASHBOARD_HIDDEN))
                .catch(errorToast)
            }>
            <EyeOff aria-hidden className="size-3" />
          </Button>
        </Tooltip>
      </div>
      {header('running', t('agent.task_dashboard.running'), running.total)}
      {!collapsed.includes('running') &&
        (running.isLoading ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">{t('common.loading')}</p>
        ) : running.total === 0 ? (
          <p className="px-3 py-1 text-xs text-muted-foreground">{t('agent.task_dashboard.empty')}</p>
        ) : (
          <>
            <ul aria-label={t('agent.task_dashboard.running')}>{running.items.map(renderRow)}</ul>
            <PageButtons {...running} />
          </>
        ))}
      {header('scheduled', t('agent.task_dashboard.scheduled'), tasks.total)}
      {!collapsed.includes('scheduled') && (
        <>
          {tasks.error ? (
            <Button variant="ghost" size="sm" onClick={() => void tasks.refetch().catch(errorToast)}>
              {t('common.retry')}
            </Button>
          ) : (
            <ul aria-label={t('agent.task_dashboard.scheduled')}>
              {tasks.tasks.map((task) => (
                <li key={task.id}>
                  <Button
                    variant="ghost"
                    className="h-auto w-full min-w-0 justify-start gap-1.5 px-3 py-1 text-left"
                    onClick={() => openSettingsTab(`/settings/scheduled-tasks/${encodeURIComponent(task.id)}`)}>
                    <Clock3 aria-hidden className="size-3 translate-x-0.5" />
                    <span className="min-w-0 flex-1 truncate text-xs" title={task.name}>
                      {task.name}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {task.runSummary?.status === 'queued'
                        ? t('agent.tasks.runSummary.queued')
                        : task.runSummary?.status === 'running'
                          ? t('agent.tasks.runSummary.running')
                          : taskStatusLabels[task.status]}
                    </span>
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <PageButtons hasPrev={tasks.hasPrev} hasNext={tasks.hasNext} prev={tasks.prevPage} next={tasks.nextPage} />
        </>
      )}
      {createOpen && (
        <Suspense fallback={null}>
          <TaskFormDialog
            open
            agents={agents?.items ?? []}
            onOpenChange={setCreateOpen}
            onCreate={async (agentId, request) => Boolean(await createTask(agentId, request))}
          />
        </Suspense>
      )}
    </section>
  )
}
