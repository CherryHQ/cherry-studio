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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  Textarea,
  Tooltip
} from '@cherrystudio/ui'
import ListItem from '@renderer/components/ListItem'
import Scrollbar from '@renderer/components/Scrollbar'
import { useTheme } from '@renderer/context/ThemeProvider'
import { cacheService } from '@renderer/data/CacheService'
import { useAgentClient } from '@renderer/hooks/agents/useAgentClient'
import { useChannels } from '@renderer/hooks/agents/useChannels'
import { useTaskLogs } from '@renderer/hooks/agents/useTasks'
import type { CreateTaskRequest, ScheduledTaskEntity, TaskRunLogEntity, UpdateTaskRequest } from '@renderer/types'
import { useNavigate } from '@tanstack/react-router'
import {
  AlertTriangle,
  CalendarClock,
  Clock,
  ExternalLink,
  History,
  Maximize2,
  Pause,
  Play,
  Plus,
  Search,
  Trash2,
  X
} from 'lucide-react'
import { type FC, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { mutate } from 'swr'

import { SettingContainer, SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '.'

// --------------- Types ---------------

type AgentInfo = { id: string; name: string }
type ChannelInfo = { id: string; name: string; isActive?: boolean; hasActiveChatIds?: boolean }

const parseScheduleDate = (value: string) => {
  if (!value) return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
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
          emptyText={t('common.noData')}
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

  const [name, setName] = useState(task.name)
  const [prompt, setPrompt] = useState(task.prompt)
  const [promptModalOpen, setPromptModalOpen] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [agentId, setAgentId] = useState(task.agentId)
  const [scheduleType, setScheduleType] = useState(task.scheduleType)
  const [scheduleValue, setScheduleValue] = useState(task.scheduleValue)
  const [timeoutMinutes, setTimeoutMinutes] = useState<string>(task.timeoutMinutes?.toString() ?? '')
  const [channelIds, setChannelIds] = useState<string[]>(task.channelIds ?? [])

  useEffect(() => {
    setName(task.name)
    setPrompt(task.prompt)
    setAgentId(task.agentId)
    setScheduleType(task.scheduleType)
    setScheduleValue(task.scheduleValue)
    setTimeoutMinutes(task.timeoutMinutes?.toString() ?? '')
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
    if (task.scheduleType === 'cron') return task.scheduleValue
    if (task.scheduleType === 'interval') return `${task.scheduleValue} ${t('agent.cherryClaw.tasks.intervalUnit')}`
    if (task.scheduleType === 'once' && task.scheduleValue) {
      return formatDateTime(task.scheduleValue)
    }
    return task.scheduleValue
  }

  return (
    <SettingContainer theme={theme}>
      {/* Header card */}
      <SettingGroup theme={theme}>
        <SettingTitle>
          <div className="flex items-center gap-2">
            <Badge className={badgeColorClass(task.status)}>{statusLabels[task.status] ?? task.status}</Badge>
            <span className="text-(--color-foreground-muted) text-xs">{agentName}</span>
          </div>
          <div className="flex items-center gap-1">
            {!isCompleted && (
              <Button size="icon-sm" onClick={() => onRun(task.id)} title={t('agent.cherryClaw.tasks.run')}>
                <Play size={14} />
              </Button>
            )}
            {!isCompleted && (
              <Button
                size="icon-sm"
                onClick={() => onToggleStatus(task.id, task.status === 'active' ? 'paused' : 'active')}
                title={
                  task.status === 'active' ? t('agent.cherryClaw.tasks.pause') : t('agent.cherryClaw.tasks.resume')
                }>
                <Pause size={14} />
              </Button>
            )}
            <Button size="icon-sm" variant="destructive" onClick={() => setDeleteConfirmOpen(true)}>
              <Trash2 size={14} />
            </Button>
          </div>
        </SettingTitle>
        <SettingDivider />
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <Badge className={badgeColorClass(task.scheduleType)}>
            {scheduleTypeLabels[task.scheduleType] ?? task.scheduleType}
          </Badge>
          <span className="inline-flex items-center gap-1 text-(--color-foreground-muted)">
            <Clock size={12} />
            {formatScheduleValue()}
          </span>
          {task.lastRun && (
            <span className="inline-flex items-center gap-1 text-(--color-foreground-muted)">
              <History size={12} />
              {t('agent.cherryClaw.tasks.lastRun')}: {formatDateTime(task.lastRun)}
            </span>
          )}
          {task.nextRun && (
            <span className="inline-flex items-center gap-1 text-(--color-foreground-muted)">
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
          {agents.length > 1 && (
            <>
              <SettingRow className="gap-2" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                <SettingRowTitle>{t('agent.cherryClaw.channels.bindAgent')}</SettingRowTitle>
                <Select
                  value={agentId}
                  disabled={isCompleted}
                  onValueChange={(value) => {
                    setAgentId(value)
                    saveField({ agentId: value })
                  }}>
                  <SelectTrigger size="sm" className="w-full">
                    <SelectValue />
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
              className="min-h-[88px] resize-y px-3 py-2"
            />
          </SettingRow>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <SettingRowTitle>{t('agent.cherryClaw.tasks.scheduleType.label')}</SettingRowTitle>
              <Select
                value={scheduleType}
                disabled={isCompleted}
                onValueChange={(value: 'cron' | 'interval' | 'once') => {
                  setScheduleType(value)
                  setScheduleValue('')
                  saveField({ scheduleType: value, scheduleValue: '' })
                }}>
                <SelectTrigger size="sm" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cron">{t('agent.cherryClaw.tasks.scheduleType.cron')}</SelectItem>
                  <SelectItem value="interval">{t('agent.cherryClaw.tasks.scheduleType.interval')}</SelectItem>
                  <SelectItem value="once">{t('agent.cherryClaw.tasks.scheduleType.once')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <SettingRowTitle>{t('agent.cherryClaw.tasks.scheduleValue')}</SettingRowTitle>
              {scheduleType === 'cron' && (
                <UIInput
                  value={scheduleValue}
                  onChange={(e) => setScheduleValue(e.target.value)}
                  onBlur={() =>
                    scheduleValue.trim() &&
                    scheduleValue !== task.scheduleValue &&
                    saveField({ scheduleValue: scheduleValue.trim() })
                  }
                  placeholder={t('agent.cherryClaw.tasks.cronPlaceholder')}
                  disabled={isCompleted}
                />
              )}
              {scheduleType === 'interval' && (
                <div className="relative">
                  <UIInput
                    type="number"
                    min={1}
                    value={scheduleValue}
                    onChange={(e) => setScheduleValue(e.target.value)}
                    onBlur={() =>
                      scheduleValue.trim() &&
                      scheduleValue !== task.scheduleValue &&
                      saveField({ scheduleValue: scheduleValue.trim() })
                    }
                    placeholder={t('agent.cherryClaw.tasks.intervalPlaceholder')}
                    disabled={isCompleted}
                    className="pr-10"
                  />
                  <span className="-translate-y-1/2 pointer-events-none absolute top-1/2 right-3 text-muted-foreground text-xs">
                    {t('agent.cherryClaw.tasks.intervalUnit')}
                  </span>
                </div>
              )}
              {scheduleType === 'once' && (
                <DateTimePicker
                  value={parseScheduleDate(scheduleValue)}
                  granularity="second"
                  format="yyyy-MM-dd HH:mm:ss"
                  placeholder={t('agent.cherryClaw.tasks.oncePlaceholder')}
                  triggerClassName="w-full"
                  onChange={(date) => {
                    if (!date) return
                    const iso = date.toISOString()
                    setScheduleValue(iso)
                    saveField({ scheduleValue: iso })
                  }}
                  disabled={isCompleted}
                />
              )}
            </div>
            <div className="space-y-2">
              <SettingRowTitle>{t('agent.cherryClaw.tasks.timeout.label')}</SettingRowTitle>
              <div className="relative">
                <UIInput
                  type="number"
                  min={1}
                  value={timeoutMinutes}
                  onChange={(e) => setTimeoutMinutes(e.target.value)}
                  onBlur={() => {
                    const val = timeoutMinutes.trim() ? parseInt(timeoutMinutes, 10) : null
                    const prev = task.timeoutMinutes ?? null
                    if (val !== prev) saveField({ timeoutMinutes: val })
                  }}
                  placeholder={t('agent.cherryClaw.tasks.timeout.placeholder')}
                  disabled={isCompleted}
                  className="pr-10"
                />
                <span className="-translate-y-1/2 pointer-events-none absolute top-1/2 right-3 text-muted-foreground text-xs">
                  {t('agent.cherryClaw.tasks.intervalUnit')}
                </span>
              </div>
            </div>
          </div>
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
        <DialogContent className="sm:max-w-[640px]">
          <DialogHeader>
            <DialogTitle>{t('agent.cherryClaw.tasks.prompt.label')}</DialogTitle>
          </DialogHeader>
          <Textarea.Input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={isCompleted}
            rows={14}
            className="min-h-[280px] resize-y px-3 py-2"
          />
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        title={t('agent.cherryClaw.tasks.delete.confirm')}
        confirmText={t('agent.cherryClaw.tasks.delete.label')}
        cancelText={t('agent.cherryClaw.tasks.cancel')}
        destructive
        onConfirm={() => onDelete(task.id)}
      />
    </SettingContainer>
  )
}

// --------------- Inline Logs ---------------

const TaskLogsInline: FC<{ taskId: string; agentId: string }> = ({ taskId, agentId }) => {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const navigate = useNavigate()
  const { logs, isLoading } = useTaskLogs(taskId)
  const [searchText, setSearchText] = useState('')

  const filteredLogs = useMemo(() => {
    if (!searchText.trim()) return logs
    const query = searchText.toLowerCase()
    return logs.filter(
      (log) =>
        log.result?.toLowerCase().includes(query) ||
        log.error?.toLowerCase().includes(query) ||
        log.status.toLowerCase().includes(query) ||
        new Date(log.runAt).toLocaleString(locale).toLowerCase().includes(query)
    )
  }, [locale, logs, searchText])

  const navigateToSession = useCallback(
    (sessionId: string) => {
      cacheService.set('agent.active_id', agentId)
      const currentMap = cacheService.get('agent.session.active_id_map') ?? {}
      cacheService.set('agent.session.active_id_map', { ...currentMap, [agentId]: sessionId })
      void navigate({ to: '/app/chat' })
    },
    [agentId, navigate]
  )

  const columns = useMemo<ColumnDef<TaskRunLogEntity>[]>(
    () => [
      {
        accessorKey: 'runAt',
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
            success: t('agent.cherryClaw.tasks.logs.success'),
            running: t('agent.cherryClaw.tasks.logs.running'),
            error: t('agent.cherryClaw.tasks.logs.error')
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
          const text =
            record.status === 'running'
              ? t('agent.cherryClaw.tasks.logs.running', 'Running...')
              : record.status === 'error'
                ? record.error
                : (val ?? '-')
          const sessionId = record.sessionId

          return (
            <div className="flex items-center gap-1">
              <span
                className={record.status === 'error' ? 'text-red-500' : ''}
                style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {text}
              </span>
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
      <DataTable
        data={filteredLogs}
        columns={columns}
        rowKey="id"
        maxHeight={300}
        emptyText={t('agent.cherryClaw.tasks.logs.empty')}
      />
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
  const [scheduleType, setScheduleType] = useState<'cron' | 'interval' | 'once'>('interval')
  const [scheduleValue, setScheduleValue] = useState('')
  const [timeoutMinutes, setTimeoutMinutes] = useState('')
  const [channelIds, setChannelIds] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  const isValid = agentId && name.trim() && prompt.trim() && scheduleValue.trim()

  const handleCreate = useCallback(async () => {
    if (!agentId || !name.trim() || !prompt.trim() || !scheduleValue.trim()) return
    setSaving(true)
    try {
      const timeout = timeoutMinutes.trim() ? parseInt(timeoutMinutes, 10) : null
      await onCreate(agentId, {
        name: name.trim(),
        prompt: prompt.trim(),
        scheduleType: scheduleType,
        scheduleValue: scheduleValue.trim(),
        timeoutMinutes: timeout && timeout > 0 ? timeout : undefined,
        channelIds: channelIds.length > 0 ? channelIds : undefined
      })
    } finally {
      setSaving(false)
    }
  }, [agentId, name, prompt, scheduleType, scheduleValue, timeoutMinutes, channelIds, onCreate])

  return (
    <SettingContainer theme={theme}>
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
              className="min-h-[88px] resize-y px-3 py-2"
            />
          </SettingRow>

          <Dialog open={promptModalOpen} onOpenChange={setPromptModalOpen}>
            <DialogContent className="sm:max-w-[640px]">
              <DialogHeader>
                <DialogTitle>{t('agent.cherryClaw.tasks.prompt.label')}</DialogTitle>
              </DialogHeader>
              <Textarea.Input
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={t('agent.cherryClaw.tasks.prompt.placeholder')}
                rows={14}
                className="min-h-[280px] resize-y px-3 py-2"
              />
            </DialogContent>
          </Dialog>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <SettingRowTitle>{t('agent.cherryClaw.tasks.scheduleType.label')}</SettingRowTitle>
              <Select
                value={scheduleType}
                onValueChange={(v: 'cron' | 'interval' | 'once') => {
                  setScheduleType(v)
                  setScheduleValue('')
                }}>
                <SelectTrigger size="sm" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cron">{t('agent.cherryClaw.tasks.scheduleType.cron')}</SelectItem>
                  <SelectItem value="interval">{t('agent.cherryClaw.tasks.scheduleType.interval')}</SelectItem>
                  <SelectItem value="once">{t('agent.cherryClaw.tasks.scheduleType.once')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <SettingRowTitle>{t('agent.cherryClaw.tasks.scheduleValue')}</SettingRowTitle>
              {scheduleType === 'cron' && (
                <UIInput
                  value={scheduleValue}
                  onChange={(e) => setScheduleValue(e.target.value)}
                  placeholder={t('agent.cherryClaw.tasks.cronPlaceholder')}
                />
              )}
              {scheduleType === 'interval' && (
                <div className="relative">
                  <UIInput
                    type="number"
                    min={1}
                    value={scheduleValue}
                    onChange={(e) => setScheduleValue(e.target.value)}
                    placeholder={t('agent.cherryClaw.tasks.intervalPlaceholder')}
                    className="pr-10"
                  />
                  <span className="-translate-y-1/2 pointer-events-none absolute top-1/2 right-3 text-muted-foreground text-xs">
                    {t('agent.cherryClaw.tasks.intervalUnit')}
                  </span>
                </div>
              )}
              {scheduleType === 'once' && (
                <DateTimePicker
                  value={parseScheduleDate(scheduleValue)}
                  granularity="second"
                  format="yyyy-MM-dd HH:mm:ss"
                  placeholder={t('agent.cherryClaw.tasks.oncePlaceholder')}
                  triggerClassName="w-full"
                  onChange={(date) => {
                    if (date) setScheduleValue(date.toISOString())
                  }}
                />
              )}
            </div>
            <div className="space-y-2">
              <SettingRowTitle>{t('agent.cherryClaw.tasks.timeout.label')}</SettingRowTitle>
              <div className="relative">
                <UIInput
                  type="number"
                  min={1}
                  value={timeoutMinutes}
                  onChange={(e) => setTimeoutMinutes(e.target.value)}
                  placeholder={t('agent.cherryClaw.tasks.timeout.placeholder')}
                  className="pr-10"
                />
                <span className="-translate-y-1/2 pointer-events-none absolute top-1/2 right-3 text-muted-foreground text-xs">
                  {t('agent.cherryClaw.tasks.intervalUnit')}
                </span>
              </div>
            </div>
          </div>
          <TaskChannelSelector channels={channels} channelIds={channelIds} onChange={setChannelIds} />

          <div className="flex gap-2">
            <Button size="sm" onClick={onCancel}>
              {t('agent.cherryClaw.tasks.cancel')}
            </Button>
            <Button size="sm" disabled={!isValid} loading={saving} onClick={handleCreate}>
              {t('agent.cherryClaw.tasks.save')}
            </Button>
          </div>
        </div>
      </SettingGroup>
    </SettingContainer>
  )
}

// --------------- Main component ---------------

const TasksSettings: FC = () => {
  const { t } = useTranslation()
  const client = useAgentClient()
  const { channels: rawChannels = [] } = useChannels()

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
    if (!client) {
      return
    }

    try {
      const [tasksRes, agentsRes] = await Promise.all([
        client.listTasks({ limit: 200 }),
        client.listAgents({ limit: 100 })
      ])
      setTasks(tasksRes.data)
      setAgents(
        agentsRes.data
          .filter((a) => {
            return a.configuration?.soul_enabled === true || a.configuration?.permission_mode === 'bypassPermissions'
          })
          .map((a) => ({ id: a.id, name: a.name ?? a.id }))
      )
    } finally {
      setLoading(false)
    }
  }, [client])

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
      if (!client) {
        return
      }
      const created = await client.createTask(agentId, req)
      setCreating(false)
      await loadData()
      setSelectedTaskId(created.id)
    },
    [client, loadData]
  )

  const handleUpdate = useCallback(
    async (taskId: string, updates: UpdateTaskRequest) => {
      if (!client) {
        return
      }
      await client.updateTask(taskId, updates)
      void loadData()
    },
    [client, loadData]
  )

  const handleDelete = useCallback(
    async (taskId: string) => {
      if (!client) {
        return
      }
      await client.deleteTask(taskId)
      if (selectedTaskId === taskId) setSelectedTaskId(null)
      void loadData()
    },
    [client, selectedTaskId, loadData]
  )

  const handleRun = useCallback(
    async (taskId: string) => {
      if (!client) {
        return
      }
      await client.runTask(taskId)
      void loadData()
      // Refresh task logs SWR cache so the logs list updates
      const logsKey = client.taskPaths.logs(taskId)
      void mutate(logsKey)
      // Task runs asynchronously — refresh again after a delay to capture completion
      setTimeout(() => {
        void mutate(logsKey)
        void loadData()
      }, 1000)
    },
    [client, loadData]
  )

  const handleToggleStatus = useCallback(
    async (taskId: string, newStatus: string) => {
      if (!client) {
        return
      }
      await client.updateTask(taskId, { status: newStatus as 'active' | 'paused' })
      void loadData()
    },
    [client, loadData]
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
    <div className="flex flex-1">
      <div
        className="flex w-full flex-1 flex-row overflow-hidden"
        style={{ height: 'calc(100vh - var(--navbar-height) - 6px)' }}>
        {/* Left panel: task list */}
        <Scrollbar
          className="flex flex-col gap-1.25 border-(--color-border) border-r-[0.5px] p-3 pb-12"
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
                  subtitle={`${getAgentName(task.agentId)} · ${scheduleTypeLabelsMap[task.scheduleType] ?? task.scheduleType}`}
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
        <div className="relative flex flex-1">
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
            <div className="flex flex-1 items-center justify-center text-(--color-foreground-muted) text-sm">
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
