import type { ColumnDef } from '@cherrystudio/ui'
import {
  Badge,
  Button,
  Combobox,
  ConfirmDialog,
  DataTable,
  DateTimePicker,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input as UIInput,
  MenuItem,
  MenuList,
  Popover,
  PopoverContent,
  PopoverTrigger,
  SegmentedControl,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  Switch,
  Textarea,
  Tooltip
} from '@cherrystudio/ui'
import { loggerService } from '@logger'
import ListItem from '@renderer/components/ListItem'
import Scrollbar from '@renderer/components/Scrollbar'
import { dataApiService } from '@renderer/data/DataApiService'
import { useChannels } from '@renderer/hooks/agent/useChannels'
import { useCreateTask, useDeleteTask, useRunTask, useTaskLogs, useUpdateTask } from '@renderer/hooks/agent/useTasks'
import { useConversationNavigation } from '@renderer/hooks/useConversationNavigation'
import { useTheme } from '@renderer/hooks/useTheme'
import type { Trigger } from '@shared/data/api/schemas/jobs'
import type {
  AgentEntity,
  CreateTaskRequest,
  ScheduledTaskEntity,
  TaskRunLogEntity,
  UpdateTaskRequest
} from '@shared/data/types/agent'
import {
  AlertTriangle,
  CalendarClock,
  Clock,
  ExternalLink,
  History,
  Maximize2,
  MoreHorizontal,
  Play,
  Plus,
  Search,
  Trash2,
  X
} from 'lucide-react'
import { type FC, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingsContentColumn, SettingTitle } from '.'

const logger = loggerService.withContext('TasksSettings')

// --------------- Types ---------------

type AgentInfo = { id: string; name: string }
type ChannelInfo = { id: string; name: string; isActive?: boolean; hasActiveChatIds?: boolean }

const parseScheduleDate = (value: string) => {
  if (!value) return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}

/** UI form state ↔ wire Trigger conversions. */
type ScheduleKind = 'cron' | 'interval' | 'once'
type ScheduleFormState = {
  kind: ScheduleKind
  value: string
  timeoutMinutes: string
}
type ScheduleCommitPatch = {
  trigger?: Trigger
  timeoutMinutes?: number | null
}

function triggerToFormState(trigger: Trigger): { kind: ScheduleKind; value: string } {
  switch (trigger.kind) {
    case 'cron':
      return { kind: 'cron', value: trigger.expr }
    case 'interval':
      // Wire stores ms; UI shows minutes — round to keep "every 30m" stable on round-trip.
      return { kind: 'interval', value: String(Math.max(1, Math.round(trigger.ms / 60_000))) }
    case 'once':
      return { kind: 'once', value: new Date(trigger.at).toISOString() }
  }
}

function formStateToTrigger(kind: ScheduleKind, value: string): Trigger | null {
  const trimmed = value.trim()
  if (kind === 'cron') {
    if (!trimmed) return null
    return { kind: 'cron', expr: trimmed }
  }
  if (kind === 'interval') {
    const minutes = parseInt(trimmed, 10)
    if (!Number.isFinite(minutes) || minutes <= 0) return null
    return { kind: 'interval', ms: minutes * 60_000 }
  }
  const at = Date.parse(trimmed)
  if (!Number.isFinite(at)) return null
  return { kind: 'once', at }
}

// --------------- Shared schedule controls ---------------

const TaskScheduleControls: FC<{
  value: ScheduleFormState
  disabled?: boolean
  committedTrigger?: Trigger
  committedTimeoutMinutes?: number | null
  onChange: (value: ScheduleFormState) => void
  onCommit?: (patch: ScheduleCommitPatch) => void
}> = ({ value, disabled, committedTrigger, committedTimeoutMinutes, onChange, onCommit }) => {
  const { t } = useTranslation()

  const scheduleTypeOptions = [
    { value: 'interval' as const, label: t('agent.cherryClaw.tasks.scheduleType.interval') },
    { value: 'once' as const, label: t('agent.cherryClaw.tasks.scheduleType.once') },
    { value: 'cron' as const, label: t('agent.cherryClaw.tasks.scheduleType.cron') }
  ]

  const commitTrigger = (kind = value.kind, scheduleValue = value.value) => {
    if (!onCommit) return
    const trigger = formStateToTrigger(kind, scheduleValue)
    if (!trigger) return
    if (committedTrigger && JSON.stringify(trigger) === JSON.stringify(committedTrigger)) return
    onCommit({ trigger })
  }

  const commitTimeoutMinutes = () => {
    if (!onCommit) return
    const nextTimeout = value.timeoutMinutes.trim() ? parseInt(value.timeoutMinutes, 10) : null
    const previousTimeout = committedTimeoutMinutes ?? null
    if (nextTimeout !== previousTimeout) onCommit({ timeoutMinutes: nextTimeout })
  }

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <SettingRowTitle>{t('agent.cherryClaw.tasks.frequency.label')}</SettingRowTitle>
        <SegmentedControl
          size="sm"
          value={value.kind}
          disabled={disabled}
          onValueChange={(kind) => onChange({ ...value, kind, value: '' })}
          options={scheduleTypeOptions}
          className="max-w-full"
        />

        {value.kind === 'interval' && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-foreground text-sm">{t('agent.cherryClaw.tasks.frequency.everyPrefix')}</span>
            <UIInput
              type="number"
              min={1}
              value={value.value}
              onChange={(e) => onChange({ ...value, value: e.target.value })}
              onBlur={() => commitTrigger()}
              placeholder={t('agent.cherryClaw.tasks.intervalPlaceholder')}
              disabled={disabled}
              className="w-24"
            />
            <span className="text-foreground text-sm">{t('agent.cherryClaw.tasks.frequency.everySuffix')}</span>
          </div>
        )}

        {value.kind === 'once' && (
          <DateTimePicker
            value={parseScheduleDate(value.value)}
            granularity="second"
            format="yyyy-MM-dd HH:mm:ss"
            placeholder={t('agent.cherryClaw.tasks.oncePlaceholder')}
            triggerClassName="w-72 max-w-full"
            onChange={(date) => {
              if (!date) return
              const nextValue = date.toISOString()
              onChange({ ...value, value: nextValue })
              commitTrigger('once', nextValue)
            }}
            disabled={disabled}
          />
        )}

        {value.kind === 'cron' && (
          <UIInput
            value={value.value}
            onChange={(e) => onChange({ ...value, value: e.target.value })}
            onBlur={() => commitTrigger()}
            placeholder={t('agent.cherryClaw.tasks.cronPlaceholder')}
            disabled={disabled}
            className="w-72 max-w-full"
          />
        )}
      </div>

      <div className="space-y-3">
        <SettingRowTitle>{t('agent.cherryClaw.tasks.timeout.label')}</SettingRowTitle>
        <div className="flex items-center gap-2">
          <UIInput
            type="number"
            min={1}
            value={value.timeoutMinutes}
            onChange={(e) => onChange({ ...value, timeoutMinutes: e.target.value })}
            onBlur={commitTimeoutMinutes}
            placeholder={t('agent.cherryClaw.tasks.timeout.placeholder')}
            disabled={disabled}
            className="h-8 min-h-8 w-24"
          />
          <span className="text-muted-foreground text-xs">{t('agent.cherryClaw.tasks.intervalUnit')}</span>
        </div>
      </div>
    </div>
  )
}

// --------------- Shared channel selector with warnings ---------------

const TaskChannelSelector: FC<{
  channels: ChannelInfo[]
  channelIds: string[]
  onChange: (value: string[]) => void
  disabled?: boolean
}> = ({ channels, channelIds, onChange, disabled }) => {
  const { t } = useTranslation()

  if (channels.length === 0) return null

  const hasNoChatIds = channelIds.some((id) => !channels.find((c) => c.id === id)?.hasActiveChatIds)

  return (
    <>
      <SettingRow className="gap-2" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
        <SettingRowTitle>{t('agent.cherryClaw.tasks.channels.label')}</SettingRowTitle>
        <Combobox
          multiple
          size="default"
          className="w-full"
          width="100%"
          value={channelIds}
          disabled={disabled}
          onChange={(value) => {
            if (Array.isArray(value)) {
              onChange(value)
            }
          }}
          placeholder={t('agent.cherryClaw.tasks.channels.placeholder')}
          searchPlaceholder={t('agent.cherryClaw.tasks.channels.placeholder')}
          emptyText={t('common.no_results')}
          options={channels.map((ch) => ({
            value: ch.id,
            label: ch.name,
            isActive: ch.isActive
          }))}
          renderOption={(option) => (
            <span className="flex min-w-0 items-center gap-2">
              <span
                className={`inline-block h-1.5 w-1.5 rounded-full ${option.isActive ? 'bg-green-500' : 'bg-gray-400'}`}
              />
              <span className="truncate">{option.label}</span>
            </span>
          )}
        />
        {hasNoChatIds && (
          <div className="mt-2 inline-flex items-start gap-2 rounded-lg border border-warning/25 bg-warning/8 px-3 py-2 text-warning text-xs">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span>{t('agent.cherryClaw.tasks.channels.noActiveChatIds')}</span>
          </div>
        )}
      </SettingRow>
    </>
  )
}

// --------------- Task Detail (right panel) ---------------

const TaskDetail: FC<{
  task: ScheduledTaskEntity
  agents: AgentInfo[]
  channels: ChannelInfo[]
  onUpdate: (taskId: string, updates: UpdateTaskRequest) => Promise<void>
  onDelete: (taskId: string) => Promise<void>
  onRun: (taskId: string) => Promise<void>
  onToggleStatus: (taskId: string, newStatus: string) => Promise<void>
}> = ({ task, agents, channels, onUpdate, onDelete, onRun, onToggleStatus }) => {
  const { t } = useTranslation()
  const { theme } = useTheme()

  const isCompleted = task.status === 'completed'
  const statusLabels: Record<string, string> = {
    active: t('agent.cherryClaw.tasks.status.active'),
    paused: t('agent.cherryClaw.tasks.status.paused'),
    completed: t('agent.cherryClaw.tasks.status.completed')
  }
  const scheduleTypeLabels: Record<string, string> = {
    cron: t('agent.cherryClaw.tasks.scheduleType.cron'),
    interval: t('agent.cherryClaw.tasks.scheduleType.interval'),
    once: t('agent.cherryClaw.tasks.scheduleType.once')
  }
  const agentName = agents.find((a) => a.id === task.agentId)?.name ?? task.agentId

  const initialSchedule = triggerToFormState(task.trigger)
  const [name, setName] = useState(task.name)
  const [prompt, setPrompt] = useState(task.prompt)
  const [promptModalOpen, setPromptModalOpen] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false)
  const [schedule, setSchedule] = useState<ScheduleFormState>({
    ...initialSchedule,
    timeoutMinutes: task.timeoutMinutes?.toString() ?? ''
  })
  const [channelIds, setChannelIds] = useState<string[]>(task.channelIds ?? [])

  const toggleStatusLabel =
    task.status === 'active' ? t('agent.cherryClaw.tasks.pause') : t('agent.cherryClaw.tasks.resume')
  const moreLabel = t('common.more')
  const runLabel = t('agent.cherryClaw.tasks.run')
  const deleteLabel = t('agent.cherryClaw.tasks.delete.label')

  useEffect(() => {
    setName(task.name)
    setPrompt(task.prompt)
    const next = triggerToFormState(task.trigger)
    setSchedule({ ...next, timeoutMinutes: task.timeoutMinutes?.toString() ?? '' })
    setChannelIds(task.channelIds ?? [])
  }, [task])

  const saveField = useCallback(
    (updates: UpdateTaskRequest) => {
      void onUpdate(task.id, updates)
    },
    [task.id, onUpdate]
  )

  const handlePromptModalOpenChange = useCallback(
    (open: boolean) => {
      if (!open && prompt.trim() && prompt !== task.prompt) {
        saveField({ prompt: prompt.trim() })
      }
      setPromptModalOpen(open)
    },
    [prompt, saveField, task.prompt]
  )

  const handleRunNow = useCallback(() => {
    setActionsMenuOpen(false)
    void onRun(task.id)
  }, [onRun, task.id])

  const handleDeleteAction = useCallback(() => {
    setActionsMenuOpen(false)
    setDeleteConfirmOpen(true)
  }, [])

  const formatDateTime = (iso: string | null | undefined) => {
    if (!iso) return '-'
    const d = new Date(iso)
    const diff = Math.abs(Date.now() - d.getTime())
    if (diff < 86400_000) {
      return d.toLocaleString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
    }
    return d.toLocaleString(undefined, {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    })
  }

  const formatScheduleValue = () => {
    if (task.trigger.kind === 'cron') return task.trigger.expr
    if (task.trigger.kind === 'interval') {
      const minutes = Math.max(1, Math.round(task.trigger.ms / 60_000))
      return `${minutes} ${t('agent.cherryClaw.tasks.intervalUnit')}`
    }
    return formatDateTime(new Date(task.trigger.at).toISOString())
  }

  return (
    <SettingsContentColumn theme={theme}>
      {/* Header card */}
      <SettingGroup theme={theme}>
        <SettingTitle>
          <div className="flex items-center gap-2">
            <Badge className={badgeColorClass(task.status)}>{statusLabels[task.status] ?? task.status}</Badge>
            <span className="text-foreground-muted text-xs">{agentName}</span>
          </div>
          <div className="flex items-center gap-1">
            {!isCompleted && (
              <Switch
                size="sm"
                checked={task.status === 'active'}
                onCheckedChange={(checked) => onToggleStatus(task.id, checked ? 'active' : 'paused')}
                // Name the state the switch controls; aria-checked carries on/off. title keeps the action hint for sighted hover.
                aria-label={t('agent.cherryClaw.tasks.status.active')}
                title={toggleStatusLabel}
              />
            )}
            <Popover open={actionsMenuOpen} onOpenChange={setActionsMenuOpen}>
              <PopoverTrigger asChild>
                <Button type="button" size="icon-sm" variant="ghost" aria-label={moreLabel}>
                  <MoreHorizontal size={14} />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                side="bottom"
                sideOffset={6}
                collisionPadding={8}
                className="w-fit min-w-32 rounded-xl p-1.5"
                onOpenAutoFocus={(event) => event.preventDefault()}
                onCloseAutoFocus={(event) => event.preventDefault()}>
                <MenuList>
                  {!isCompleted && (
                    <MenuItem
                      variant="ghost"
                      icon={<Play className="size-3.5" />}
                      label={runLabel}
                      onClick={handleRunNow}
                    />
                  )}
                  <MenuItem
                    variant="ghost"
                    icon={<Trash2 className="size-3.5 text-destructive" />}
                    label={deleteLabel}
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive focus-visible:ring-destructive/20"
                    onClick={handleDeleteAction}
                  />
                </MenuList>
              </PopoverContent>
            </Popover>
          </div>
        </SettingTitle>
        <SettingDivider />
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <Badge className={badgeColorClass(task.trigger.kind)}>
            {scheduleTypeLabels[task.trigger.kind] ?? task.trigger.kind}
          </Badge>
          <span className="inline-flex items-center gap-1 text-foreground-muted">
            <Clock size={12} />
            {formatScheduleValue()}
          </span>
          {task.lastRun && (
            <span className="inline-flex items-center gap-1 text-foreground-muted">
              <History size={12} />
              {t('agent.cherryClaw.tasks.lastRun')}: {formatDateTime(task.lastRun)}
            </span>
          )}
          {task.nextRun && (
            <span className="inline-flex items-center gap-1 text-foreground-muted">
              <CalendarClock size={12} />
              {t('agent.cherryClaw.tasks.nextRun')}: {formatDateTime(task.nextRun)}
            </span>
          )}
        </div>
      </SettingGroup>

      {/* Editable fields card */}
      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.general.title')}</SettingTitle>
        <SettingDivider />
        <div className="space-y-5">
          <SettingRow className="gap-2" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
            <SettingRowTitle>{t('agent.cherryClaw.tasks.name.label')}</SettingRowTitle>
            <UIInput
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => name.trim() && name !== task.name && saveField({ name: name.trim() })}
              disabled={isCompleted}
            />
          </SettingRow>
          {/* Agent reassignment was never supported by the IPC contract (strict
              schema dropped the field). Owning-agent display lives in the
              header card. */}
          <SettingRow className="gap-2" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
            <div className="flex items-center justify-between">
              <SettingRowTitle>{t('agent.cherryClaw.tasks.prompt.label')}</SettingRowTitle>
              {!isCompleted && (
                <Tooltip title={t('agent.cherryClaw.tasks.prompt.expand')}>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="shadow-none"
                    onClick={() => setPromptModalOpen(true)}>
                    <Maximize2 size={13} />
                  </Button>
                </Tooltip>
              )}
            </div>
            <Textarea.Input
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onBlur={() => prompt.trim() && prompt !== task.prompt && saveField({ prompt: prompt.trim() })}
              disabled={isCompleted}
              rows={4}
              className="min-h-22 resize-y px-3 py-2"
            />
          </SettingRow>
          <TaskScheduleControls
            value={schedule}
            disabled={isCompleted}
            committedTrigger={task.trigger}
            committedTimeoutMinutes={task.timeoutMinutes}
            onChange={setSchedule}
            onCommit={saveField}
          />
          <TaskChannelSelector
            channels={channels}
            channelIds={channelIds}
            onChange={(value) => {
              setChannelIds(value)
              saveField({ channelIds: value })
            }}
            disabled={isCompleted}
          />
        </div>
      </SettingGroup>

      {/* Logs card */}
      <SettingGroup theme={theme}>
        <SettingTitle>{t('agent.cherryClaw.tasks.logs.label')}</SettingTitle>
        <SettingDivider />
        <TaskLogsInline taskId={task.id} agentId={task.agentId} />
      </SettingGroup>

      <Dialog open={promptModalOpen} onOpenChange={handlePromptModalOpenChange}>
        <DialogContent className="sm:max-w-160">
          <DialogHeader>
            <DialogTitle>{t('agent.cherryClaw.tasks.prompt.label')}</DialogTitle>
          </DialogHeader>
          <Textarea.Input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={isCompleted}
            rows={14}
            className="min-h-70 resize-y px-3 py-2"
          />
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        title={t('agent.cherryClaw.tasks.delete.confirm')}
        confirmText={deleteLabel}
        cancelText={t('agent.cherryClaw.tasks.cancel')}
        destructive
        onConfirm={() => onDelete(task.id)}
      />
    </SettingsContentColumn>
  )
}

// --------------- Inline Logs ---------------

const TaskLogsInline: FC<{ taskId: string; agentId: string }> = ({ taskId, agentId }) => {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const { openConversation } = useConversationNavigation('agents')
  const { logs, isLoading, error: logsError } = useTaskLogs(agentId, taskId)
  const [searchText, setSearchText] = useState('')

  const filteredLogs = useMemo(() => {
    if (!searchText.trim()) return logs
    const query = searchText.toLowerCase()
    return logs.filter(
      (log) =>
        log.result?.toLowerCase().includes(query) ||
        log.error?.toLowerCase().includes(query) ||
        log.status.toLowerCase().includes(query) ||
        new Date(log.startedAt).toLocaleString(locale).toLowerCase().includes(query)
    )
  }, [locale, logs, searchText])

  const navigateToSession = useCallback(
    (sessionId: string) => {
      openConversation(sessionId)
    },
    [openConversation]
  )

  const columns = useMemo<ColumnDef<TaskRunLogEntity>[]>(
    () => [
      {
        accessorKey: 'startedAt',
        header: t('agent.cherryClaw.tasks.logs.runAt'),
        meta: { width: 160 },
        cell: ({ getValue }) =>
          new Date(getValue() as string).toLocaleString(undefined, {
            month: 'numeric',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
          })
      },
      {
        accessorKey: 'durationMs',
        header: t('agent.cherryClaw.tasks.logs.duration'),
        meta: { width: 80 },
        cell: ({ getValue, row }) => {
          const val = getValue() as number

          if (row.original.status === 'running') return '-'
          if (val < 1000) return `${val}ms`
          if (val < 60_000) return `${(val / 1000).toFixed(1)}s`
          return `${(val / 60_000).toFixed(1)}m`
        }
      },
      {
        accessorKey: 'status',
        header: t('agent.cherryClaw.tasks.logs.status'),
        meta: { width: 80 },
        cell: ({ getValue }) => {
          const val = getValue() as string
          const logStatusLabels: Record<string, string> = {
            completed: t('agent.cherryClaw.tasks.logs.completed'),
            running: t('agent.cherryClaw.tasks.logs.running'),
            failed: t('agent.cherryClaw.tasks.logs.failed'),
            cancelled: t('agent.cherryClaw.tasks.logs.cancelled')
          }
          return <Badge className={badgeColorClass(val)}>{logStatusLabels[val] ?? val}</Badge>
        }
      },
      {
        id: 'result',
        header: t('agent.cherryClaw.tasks.logs.result'),
        meta: { width: 'calc(100% - 320px)', className: 'min-w-0' },
        cell: ({ row }) => {
          const record = row.original
          const val = record.result
          const isErrorStatus = record.status === 'failed' || record.status === 'cancelled'
          const text =
            record.status === 'running'
              ? t('agent.cherryClaw.tasks.logs.running', 'Running...')
              : isErrorStatus
                ? record.error
                : (val ?? '-')
          const sessionId = record.sessionId

          return (
            <div className="flex items-start gap-1">
              {sessionId && (
                <Tooltip title={t('agent.cherryClaw.tasks.logs.viewSession', 'View session')}>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="shrink-0"
                    onClick={() => navigateToSession(sessionId)}>
                    <ExternalLink size={12} />
                  </Button>
                </Tooltip>
              )}
              {/* Clamp height (full text stays in the DOM and copyable); the table scrolls horizontally for width. */}
              <span className={`line-clamp-4 ${isErrorStatus ? 'text-red-500' : ''}`}>{text}</span>
            </div>
          )
        }
      }
    ],
    [navigateToSession, t]
  )

  if (isLoading) {
    return (
      <div className="flex justify-center py-4">
        <Spinner text={t('common.loading')} />
      </div>
    )
  }

  if (logsError) {
    return <EmptyState compact preset="no-result" description={t('agent.cherryClaw.tasks.logs.loadError')} />
  }

  if (logs.length === 0) {
    return <EmptyState compact preset="no-result" description={t('agent.cherryClaw.tasks.logs.empty')} />
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <Search className="-translate-y-1/2 absolute top-1/2 left-2.5 size-3 text-muted-foreground" />
        <UIInput
          placeholder={t('agent.cherryClaw.tasks.logs.search', 'Search logs...')}
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          className="h-8 pr-8 pl-7 text-xs"
        />
        {searchText && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="-translate-y-1/2 absolute top-1/2 right-1 size-6 text-muted-foreground shadow-none"
            onClick={() => setSearchText('')}>
            <X size={12} />
          </Button>
        )}
      </div>
      <div data-slot="task-logs-table-scroll" className="max-w-full overflow-x-auto">
        <div data-slot="task-logs-table-width" className="min-w-[720px]">
          <DataTable
            data={filteredLogs}
            columns={columns}
            rowKey="id"
            emptyText={t('agent.cherryClaw.tasks.logs.empty')}
          />
        </div>
      </div>
    </div>
  )
}

// --------------- Schedule type config ---------------

const scheduleTypeColors: Record<string, string> = {
  cron: 'purple',
  interval: 'blue',
  once: 'orange'
}

const badgeColorClass = (value: string) => {
  const color = scheduleTypeColors[value] ?? value
  switch (color) {
    case 'active':
    case 'success':
    case 'green':
      return 'border-success/30 bg-success/10 text-success'
    case 'paused':
    case 'running':
    case 'orange':
      return 'border-warning/30 bg-warning/10 text-warning'
    case 'completed':
      // Raw blue-500 to match the left-list status dot (statusDotColors.completed) exactly.
      return 'border-blue-500/30 bg-blue-500/10 text-blue-500'
    case 'blue':
      return 'border-primary/30 bg-primary/10 text-primary'
    case 'purple':
      return 'border-purple-500/30 bg-purple-500/10 text-purple-600 dark:text-purple-400'
    case 'error':
    case 'red':
      return 'border-destructive/30 bg-destructive/10 text-destructive'
    default:
      return 'border-border bg-background-subtle text-foreground'
  }
}

const statusDotColors: Record<string, string> = {
  active: 'bg-green-500',
  paused: 'bg-yellow-500',
  completed: 'bg-blue-500'
}

// --------------- Create Form (right panel) ---------------

const CreateForm: FC<{
  agents: AgentInfo[]
  channels: ChannelInfo[]
  onCancel: () => void
  onCreate: (agentId: string, req: CreateTaskRequest) => Promise<void>
}> = ({ agents, channels, onCancel, onCreate }) => {
  const { t } = useTranslation()
  const { theme } = useTheme()

  const [agentId, setAgentId] = useState<string | null>(agents.length === 1 ? agents[0].id : null)
  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [promptModalOpen, setPromptModalOpen] = useState(false)
  const [schedule, setSchedule] = useState<ScheduleFormState>({ kind: 'interval', value: '', timeoutMinutes: '' })
  const [channelIds, setChannelIds] = useState<string[]>([])
  // TODO(agent-workspace-picker): wire the workspace picker before re-enabling task creation.
  const [workspaceSource] = useState<CreateTaskRequest['workspace'] | null>(null)
  const [saving, setSaving] = useState(false)

  const isValid = agentId && name.trim() && prompt.trim() && schedule.value.trim() && workspaceSource

  const handleCreate = useCallback(async () => {
    if (!agentId || !name.trim() || !prompt.trim() || !schedule.value.trim() || !workspaceSource) return
    const trigger = formStateToTrigger(schedule.kind, schedule.value.trim())
    if (!trigger) return
    setSaving(true)
    try {
      const timeout = schedule.timeoutMinutes.trim() ? parseInt(schedule.timeoutMinutes, 10) : null
      await onCreate(agentId, {
        name: name.trim(),
        prompt: prompt.trim(),
        trigger,
        workspace: workspaceSource,
        timeoutMinutes: timeout && timeout > 0 ? timeout : undefined,
        channelIds: channelIds.length > 0 ? channelIds : undefined
      })
    } finally {
      setSaving(false)
    }
  }, [agentId, name, prompt, schedule, workspaceSource, channelIds, onCreate])

  return (
    <SettingsContentColumn theme={theme}>
      <SettingGroup theme={theme}>
        <SettingTitle>{t('agent.cherryClaw.tasks.add')}</SettingTitle>
        <SettingDivider />
        <div className="space-y-5">
          {agents.length > 1 && (
            <>
              <SettingRow className="gap-2" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                <SettingRowTitle>{t('agent.cherryClaw.channels.bindAgent')}</SettingRowTitle>
                <Select value={agentId ?? undefined} onValueChange={setAgentId}>
                  <SelectTrigger size="sm" className="w-full">
                    <SelectValue placeholder={t('agent.cherryClaw.channels.selectAgent')} />
                  </SelectTrigger>
                  <SelectContent>
                    {agents.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </SettingRow>
            </>
          )}

          <SettingRow className="gap-2" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
            <SettingRowTitle>{t('agent.cherryClaw.tasks.name.label')}</SettingRowTitle>
            <UIInput
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('agent.cherryClaw.tasks.name.placeholder')}
            />
          </SettingRow>

          <SettingRow className="gap-2" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
            <div className="flex items-center justify-between">
              <SettingRowTitle>{t('agent.cherryClaw.tasks.prompt.label')}</SettingRowTitle>
              <Tooltip title={t('agent.cherryClaw.tasks.prompt.expand')}>
                <Button variant="ghost" size="icon-sm" className="shadow-none" onClick={() => setPromptModalOpen(true)}>
                  <Maximize2 size={13} />
                </Button>
              </Tooltip>
            </div>
            <Textarea.Input
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={t('agent.cherryClaw.tasks.prompt.placeholder')}
              rows={4}
              className="min-h-22 resize-y px-3 py-2"
            />
          </SettingRow>

          <Dialog open={promptModalOpen} onOpenChange={setPromptModalOpen}>
            <DialogContent className="sm:max-w-160">
              <DialogHeader>
                <DialogTitle>{t('agent.cherryClaw.tasks.prompt.label')}</DialogTitle>
              </DialogHeader>
              <Textarea.Input
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={t('agent.cherryClaw.tasks.prompt.placeholder')}
                rows={14}
                className="min-h-70 resize-y px-3 py-2"
              />
            </DialogContent>
          </Dialog>

          <TaskScheduleControls value={schedule} onChange={setSchedule} />
          <TaskChannelSelector channels={channels} channelIds={channelIds} onChange={setChannelIds} />

          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onCancel}>
              {t('agent.cherryClaw.tasks.cancel')}
            </Button>
            <Button size="sm" disabled={!isValid} loading={saving} onClick={handleCreate}>
              {t('agent.cherryClaw.tasks.save')}
            </Button>
          </div>
        </div>
      </SettingGroup>
    </SettingsContentColumn>
  )
}

// --------------- Main component ---------------

const TasksSettings: FC = () => {
  const { t } = useTranslation()
  const { channels: rawChannels = [] } = useChannels()
  const { createTask } = useCreateTask()
  const { updateTask } = useUpdateTask()
  const { deleteTask } = useDeleteTask()
  const { runTask } = useRunTask()

  const [agents, setAgents] = useState<AgentInfo[]>([])
  const [tasks, setTasks] = useState<ScheduledTaskEntity[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const channels: ChannelInfo[] = useMemo(
    () =>
      rawChannels.map((ch: any) => ({
        id: ch.id,
        name: ch.name || ch.type,
        isActive: ch.is_active === true || ch.isActive === true,
        hasActiveChatIds:
          ((ch.config?.allowed_chat_ids as string[]) ?? []).length > 0 ||
          ((ch.config?.allowed_channel_ids as string[]) ?? []).length > 0 ||
          ((ch.active_chat_ids ?? ch.activeChatIds ?? []) as string[]).length > 0
      })),
    [rawChannels]
  )

  const loadData = useCallback(async () => {
    try {
      const agentsResult = await dataApiService.get('/agents', { query: { limit: 100 } })
      const agentList = (agentsResult as any).items ?? []
      const tasksPerAgent = await Promise.all(
        agentList.map(async (a: AgentEntity) => {
          const result = await dataApiService.get(`/agents/${a.id}/tasks` as never, {
            query: { limit: 200 }
          })
          return (result as any).items ?? []
        })
      )
      setTasks(tasksPerAgent.flat())
      setAgents(
        agentList
          .filter(
            (a: AgentEntity) =>
              (a.configuration as any)?.soul_enabled === true ||
              (a.configuration as any)?.permission_mode === 'bypassPermissions'
          )
          .map((a: AgentEntity) => ({ id: a.id, name: a.name ?? a.id }))
      )
    } catch (error) {
      logger.error('Failed to load tasks settings', error as Error)
      window.toast.error(t('agent.cherryClaw.tasks.error.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void loadData()
  }, [loadData])

  // Auto-select the first task when data is loaded and nothing is selected
  useEffect(() => {
    if (!loading && !selectedTaskId && !creating && tasks.length > 0) {
      setSelectedTaskId(tasks[0].id)
    }
  }, [loading, selectedTaskId, creating, tasks])

  const selectedTask = useMemo(() => tasks.find((t) => t.id === selectedTaskId) ?? null, [tasks, selectedTaskId])

  const getAgentName = useCallback((agentId: string) => agents.find((a) => a.id === agentId)?.name ?? agentId, [agents])
  const scheduleTypeLabelsMap: Record<string, string> = {
    cron: t('agent.cherryClaw.tasks.scheduleType.cron'),
    interval: t('agent.cherryClaw.tasks.scheduleType.interval'),
    once: t('agent.cherryClaw.tasks.scheduleType.once')
  }

  const handleStartCreate = useCallback(() => {
    setSelectedTaskId(null)
    setCreating(true)
  }, [])

  const handleCreate = useCallback(
    async (agentId: string, req: CreateTaskRequest) => {
      const created = await createTask(agentId, req)
      if (created) {
        setCreating(false)
        await loadData()
        setSelectedTaskId(created.id)
      }
    },
    [createTask, loadData]
  )

  const handleUpdate = useCallback(
    async (taskId: string, updates: UpdateTaskRequest) => {
      const task = tasks.find((t) => t.id === taskId)
      if (!task) return
      await updateTask(task.agentId, taskId, updates)
      void loadData()
    },
    [updateTask, tasks, loadData]
  )

  const handleDelete = useCallback(
    async (taskId: string) => {
      const task = tasks.find((t) => t.id === taskId)
      if (!task) return
      await deleteTask(task.agentId, taskId)
      if (selectedTaskId === taskId) setSelectedTaskId(null)
      void loadData()
    },
    [deleteTask, tasks, selectedTaskId, loadData]
  )

  const handleRun = useCallback(
    async (taskId: string) => {
      await runTask(taskId)
      void loadData()
      // Task runs asynchronously — refresh again after a delay to capture completion
      setTimeout(() => {
        void loadData()
      }, 1000)
    },
    [runTask, loadData]
  )

  const handleToggleStatus = useCallback(
    async (taskId: string, newStatus: string) => {
      const task = tasks.find((t) => t.id === taskId)
      if (!task) return
      // newStatus is the renderer's existing 'active' | 'paused' contract — keep
      // it so consumers don't need to think in terms of `enabled`, then translate
      // at the IPC boundary.
      await updateTask(task.agentId, taskId, { enabled: newStatus === 'active' })
      void loadData()
    },
    [updateTask, tasks, loadData]
  )

  if (loading) {
    return (
      <div className="flex flex-1">
        <div className="flex flex-1 items-center justify-center">
          <Spinner text={t('common.loading')} />
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-w-0 flex-1">
      <div
        className="flex w-full flex-1 flex-row overflow-hidden"
        style={{ height: 'calc(100vh - var(--navbar-height) - 6px)' }}>
        {/* Left panel: task list */}
        <Scrollbar
          className="flex flex-col gap-1.25 border-border border-r-[0.5px] p-3 pb-12"
          style={{ width: 'var(--settings-width)', height: 'calc(100vh - var(--navbar-height))' }}>
          <div className="flex items-center justify-between">
            <SettingTitle>{t('settings.scheduledTasks.title')}</SettingTitle>
            <Button variant="ghost" size="icon-sm" disabled={agents.length === 0} onClick={handleStartCreate}>
              <Plus size={14} />
            </Button>
          </div>
          <div className="flex flex-col gap-1">
            {tasks.length === 0 && !creating ? (
              <EmptyState
                compact
                preset="no-agent"
                description={
                  agents.length === 0 ? t('settings.scheduledTasks.noAgents') : t('settings.scheduledTasks.noTasks')
                }
                className="mt-5 py-8"
              />
            ) : (
              tasks.map((task) => (
                <ListItem
                  key={task.id}
                  active={selectedTaskId === task.id && !creating}
                  title={task.name}
                  subtitle={`${getAgentName(task.agentId)} · ${scheduleTypeLabelsMap[task.trigger.kind] ?? task.trigger.kind}`}
                  icon={
                    <span
                      className={`inline-block h-2 w-2 rounded-full ${statusDotColors[task.status] ?? 'bg-gray-400'}`}
                    />
                  }
                  onClick={() => {
                    setCreating(false)
                    setSelectedTaskId(task.id)
                  }}
                />
              ))
            )}
          </div>
        </Scrollbar>

        {/* Right panel */}
        <div className="relative flex min-w-0 flex-1 overflow-hidden">
          {creating ? (
            <CreateForm
              agents={agents}
              channels={channels}
              onCancel={() => setCreating(false)}
              onCreate={handleCreate}
            />
          ) : selectedTask ? (
            <TaskDetail
              key={selectedTask.id}
              task={selectedTask}
              agents={agents}
              channels={channels}
              onUpdate={handleUpdate}
              onDelete={handleDelete}
              onRun={handleRun}
              onToggleStatus={handleToggleStatus}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center text-foreground-muted text-sm">
              {tasks.length > 0
                ? t('settings.scheduledTasks.selectTask', 'Select a task to view details')
                : t('settings.scheduledTasks.noTasks')}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default TasksSettings
