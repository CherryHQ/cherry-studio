import {
  Check,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CircleStop,
  CircleX,
  Clock3,
  Loader2,
  OctagonAlert,
  Square
} from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge, Button, Tooltip } from '@cherrystudio/ui'
import { dataApiService } from '@renderer/data/DataApiService'
import { usePersistCache } from '@renderer/data/hooks/useCache'
import { useMutation } from '@renderer/data/hooks/useDataApi'
import { useTaskDashboard } from '@renderer/hooks/agent/useTaskDashboard'
import { useAllTasks } from '@renderer/hooks/agent/useTasks'
import { ipcApi } from '@renderer/ipc'
import { openSettingsTab } from '@renderer/services/mainWindowNavigation'
import { toast } from '@renderer/services/toast'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { cn } from '@renderer/utils/style'
import { isDataApiNotFoundError } from '@shared/data/api/errors'
import type { DashboardEntry } from '@shared/data/api/schemas/agentTaskDashboard'
import { isAgentSessionNotFoundError } from '@shared/ipc/errors/ai'

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

function formatDuration(row: DashboardEntry, now: number, locale: string): string {
  if (row.startedAt === null || (row.reasonCode === 'interrupted' && row.lastActivityAt === null)) return '—'
  const seconds = Math.max(0, Math.floor(((row.endedAt ?? now) - row.startedAt) / 1000))
  const units: Array<[string, number]> = [
    ['hour', Math.floor(seconds / 3600)],
    ['minute', Math.floor(seconds / 60) % 60],
    ['second', seconds % 60]
  ]
  return units
    .filter(([, value], index) => value > 0 || index === 2)
    .map(([unit, value]) => new Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay: 'narrow' }).format(value))
    .join(' ')
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
  const running = useTaskDashboard('running', enabled)
  const awaiting = useTaskDashboard('awaiting', enabled)
  const tasks = useAllTasks(enabled)
  const [collapsed, setCollapsed] = usePersistCache('ui.agent.task_dashboard.collapsed_groups')
  const [stopping, setStopping] = useState<Set<string>>(() => new Set())
  const [unavailable, setUnavailable] = useState<Set<string>>(() => new Set())
  const [reviewing, setReviewing] = useState(false)
  const now = useVisibleTime(enabled && !collapsed.includes('running') && running.items.length > 0)
  const statusLabels = {
    queued: t('agent.task_dashboard.queued'),
    running: t('agent.task_dashboard.running'),
    succeeded: t('agent.task_dashboard.succeeded'),
    failed: t('agent.task_dashboard.failed'),
    cancelled: t('agent.task_dashboard.cancelled')
  }
  const taskStatusLabels = {
    active: t('agent.tasks.status.active'),
    paused: t('agent.tasks.status.paused'),
    completed: t('agent.tasks.status.completed'),
    missed: t('agent.tasks.status.missed')
  }
  const { trigger: dismiss } = useMutation('PATCH', '/agent-task-dashboard/:id', { refresh: ['/agent-task-dashboard'] })
  const { trigger: reviewAll } = useMutation('PATCH', '/agent-task-dashboard', { refresh: ['/agent-task-dashboard'] })
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
        if (row.errorSummary) toast.error({ title: t('agent.task_dashboard.failed'), description: row.errorSummary })
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
        await Promise.all(
          Array.from({ length: Math.ceil(ids.length / 500) }, (_, index) =>
            ipcApi.request('ai.agent.task_dashboard.stop', { runIds: ids.slice(index * 500, (index + 1) * 500) })
          )
        )
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
    const active = row.status === 'running'
    const missing = unavailable.has(row.id) || (!row.sessionId && !row.taskId)
    const isStopping = stopping.has(row.id)
    const Icon = row.blockedOn
      ? OctagonAlert
      : active
        ? Loader2
        : row.status === 'succeeded'
          ? CircleCheck
          : row.status === 'cancelled'
            ? CircleStop
            : CircleX
    const status = isStopping
      ? t('agent.task_dashboard.stopping')
      : row.blockedOn
        ? t('agent.task_dashboard.approval')
        : row.reasonCode === 'interrupted'
          ? t('agent.task_dashboard.interrupted')
          : statusLabels[row.status]
    return (
      <li key={row.id} className="group flex min-w-0 items-center gap-1 px-1">
        <Tooltip
          content={missing ? t('agent.task_dashboard.unavailable') : row.errorSummary || row.nameSnapshot}
          asChild>
          <Button
            variant="ghost"
            disabled={missing}
            className="h-auto min-w-0 flex-1 justify-start gap-2 whitespace-normal px-2 py-1.5 text-left"
            onClick={() => void open(row)}>
            <Icon
              aria-hidden
              className={cn('size-3.5 shrink-0', active && !row.blockedOn && 'motion-safe:animate-spin')}
            />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-xs">{row.nameSnapshot || t('agent.task_dashboard.untitled')}</span>
              <span className="truncate text-xs text-muted-foreground">{row.agentNameSnapshot}</span>
              <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                <span>{missing ? t('agent.task_dashboard.unavailable') : status}</span>
                <span aria-live="off">{formatDuration(row, now, i18n.language)}</span>
                {row.runCount > 1 && <span>{t('agent.task_dashboard.run_count', { count: row.runCount })}</span>}
              </span>
            </span>
          </Button>
        </Tooltip>
        <Tooltip content={active ? t('agent.task_dashboard.stop') : t('agent.task_dashboard.dismiss')} asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={isStopping}
            className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
            aria-label={t(active ? 'agent.task_dashboard.stop_named' : 'agent.task_dashboard.dismiss_named', {
              name: row.nameSnapshot || t('agent.task_dashboard.untitled')
            })}
            onClick={() =>
              active
                ? void stop(row)
                : void dismiss({ params: { id: row.id }, body: { viewed: true } }).catch(errorToast)
            }>
            {active ? <Square aria-hidden /> : <Check aria-hidden />}
          </Button>
        </Tooltip>
      </li>
    )
  }
  const header = (group: string, title: string, total: number, extra?: ReactNode) => (
    <div className="group flex items-center gap-1 px-2 py-1">
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
        <Badge variant="secondary" className="ml-auto">
          {total}
        </Badge>
      </Button>
      {extra}
    </div>
  )
  const failed = running.error || awaiting.error
  const loading = running.isLoading || awaiting.isLoading
  return (
    <section
      aria-label={t('agent.task_dashboard.title')}
      className="max-h-[40%] min-h-0 shrink-0 overflow-y-auto border-b border-border-subtle py-1"
      data-ui="agent-task-dashboard">
      {failed ? (
        <div className="px-3 py-2 text-xs">
          <p>{t('agent.task_dashboard.load_failed')}</p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              void Promise.all([running.refetch(), awaiting.refetch()]).catch(errorToast)
            }}>
            {t('common.retry')}
          </Button>
        </div>
      ) : loading ? (
        <p className="px-3 py-2 text-xs text-muted-foreground">{t('common.loading')}</p>
      ) : running.total === 0 && awaiting.total === 0 ? (
        <p className="px-3 py-1 text-xs text-muted-foreground">{t('agent.task_dashboard.empty')}</p>
      ) : (
        <>
          {header('running', t('agent.task_dashboard.running'), running.total)}
          {!collapsed.includes('running') && (
            <>
              <ul aria-label={t('agent.task_dashboard.running')}>{running.items.map(renderRow)}</ul>
              <PageButtons {...running} />
            </>
          )}
          {header(
            'awaiting',
            t('agent.task_dashboard.awaiting'),
            awaiting.total,
            <Tooltip content={t('agent.task_dashboard.review_all')} asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={!awaiting.total || reviewing}
                aria-label={t('agent.task_dashboard.review_all')}
                className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
                onClick={() => {
                  setReviewing(true)
                  void reviewAll({ body: { viewed: true } })
                    .catch(errorToast)
                    .finally(() => setReviewing(false))
                }}>
                <CheckCheck aria-hidden />
              </Button>
            </Tooltip>
          )}
          {!collapsed.includes('awaiting') && (
            <>
              <ul aria-label={t('agent.task_dashboard.awaiting')}>{awaiting.items.map(renderRow)}</ul>
              <PageButtons {...awaiting} />
            </>
          )}
        </>
      )}
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
                    className="h-auto w-full min-w-0 justify-start gap-2 px-3 py-1 text-left"
                    onClick={() => openSettingsTab(`/settings/scheduled-tasks/${encodeURIComponent(task.id)}`)}>
                    <Clock3 aria-hidden className="size-3" />
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
    </section>
  )
}
