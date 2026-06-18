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
import MarqueeText from '@renderer/components/MarqueeText'
import Scrollbar from '@renderer/components/Scrollbar'
import { useTheme } from '@renderer/context/ThemeProvider'
import { dataApiService } from '@renderer/data/DataApiService'
import { useChannels } from '@renderer/hooks/agents/useChannels'
import { useCreateTask, useDeleteTask, useRunTask, useTaskLogs, useUpdateTask } from '@renderer/hooks/agents/useTasks'
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
type TaskScheduleMode = 'period' | 'interval' | 'once' | 'cron'
type PeriodSchedule = 'daily' | 'weekly' | 'monthly'
type TaskTimeoutMode = 'limited' | 'unlimited'

type TaskScheduleFormState = {
  mode: TaskScheduleMode
  period: PeriodSchedule
  time: string
  weekday: string
  monthDay: string
  cronExpr: string
  intervalMinutes: string
  onceAt: string
}

type TaskTimeoutFormState = {
  mode: TaskTimeoutMode
  minutes: string
}

const DEFAULT_TASK_INTERVAL_MINUTES = '30'

const DEFAULT_TASK_SCHEDULE_FORM: TaskScheduleFormState = {
  mode: 'period',
  period: 'daily',
  time: '09:00',
  weekday: '1',
  monthDay: '1',
  cronExpr: '',
  intervalMinutes: DEFAULT_TASK_INTERVAL_MINUTES,
  onceAt: ''
}

const DEFAULT_TASK_TIMEOUT_FORM: TaskTimeoutFormState = {
  mode: 'unlimited',
  minutes: '2'
}

const parseScheduleDate = (value: string) => {
  if (!value) return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}

const normalizeScheduleDateToMinute = (date: Date) => {
  const normalized = new Date(date)
  normalized.setSeconds(0, 0)
  return normalized
}

const parseOnceDate = (value: string) => {
  const date = parseScheduleDate(value)
  return date ? normalizeScheduleDateToMinute(date) : undefined
}

const getDefaultOnceAt = () => normalizeScheduleDateToMinute(new Date(Date.now() + 5 * 60_000)).toISOString()

const getFutureOnceDraft = (value: string) => {
  const date = parseOnceDate(value)
  if (!date || date.getTime() <= Date.now()) return getDefaultOnceAt()
  return date.toISOString()
}

function taskTriggerToScheduleForm(trigger: Trigger): TaskScheduleFormState {
  if (trigger.kind === 'period') {
    return {
      ...DEFAULT_TASK_SCHEDULE_FORM,
      mode: 'period',
      period: trigger.period,
      time: trigger.time,
      weekday: trigger.period === 'weekly' ? String(trigger.weekday) : DEFAULT_TASK_SCHEDULE_FORM.weekday,
      monthDay: trigger.period === 'monthly' ? String(trigger.monthDay) : DEFAULT_TASK_SCHEDULE_FORM.monthDay
    }
  }

  if (trigger.kind === 'interval') {
    return {
      ...DEFAULT_TASK_SCHEDULE_FORM,
      mode: 'interval',
      intervalMinutes: String(Math.max(1, Math.round(trigger.ms / 60_000)))
    }
  }

  if (trigger.kind === 'once') {
    return {
      ...DEFAULT_TASK_SCHEDULE_FORM,
      mode: 'once',
      onceAt: new Date(trigger.at).toISOString()
    }
  }

  return {
    ...DEFAULT_TASK_SCHEDULE_FORM,
    mode: 'cron',
    cronExpr: trigger.expr
  }
}

const getScheduleColorKey = (trigger: Trigger): string => {
  return trigger.kind
}

function scheduleFormToTrigger(form: TaskScheduleFormState): Trigger | null {
  if (form.mode === 'interval') {
    const minutes = parsePositiveInt(form.intervalMinutes)
    if (minutes === null) return null
    return { kind: 'interval', ms: minutes * 60_000 }
  }

  if (form.mode === 'once') {
    const at = parseOnceDate(form.onceAt)
    if (!at || at.getTime() <= Date.now()) return null
    return { kind: 'once', at: at.getTime() }
  }

  if (form.mode === 'cron') {
    const expr = form.cronExpr.trim()
    return expr ? { kind: 'cron', expr } : null
  }

  const timeParts = parseTime(form.time)
  if (!timeParts) return null

  const { hour, minute } = timeParts
  const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
  if (form.period === 'daily') {
    return { kind: 'period', period: 'daily', time }
  }

  if (form.period === 'weekly') {
    const weekday = parseIntInRange(form.weekday, 0, 6)
    if (weekday === null) return null
    return { kind: 'period', period: 'weekly', time, weekday }
  }

  const monthDay = parseIntInRange(form.monthDay, 1, 31)
  if (monthDay === null) return null
  return { kind: 'period', period: 'monthly', time, monthDay }
}

function timeoutMinutesToForm(timeoutMinutes: number | null | undefined): TaskTimeoutFormState {
  if (timeoutMinutes == null) return { mode: 'unlimited', minutes: '' }
  return { mode: 'limited', minutes: String(timeoutMinutes) }
}

function timeoutFormToValue(form: TaskTimeoutFormState): number | null | undefined {
  if (form.mode === 'unlimited') return null
  return parsePositiveInt(form.minutes) ?? undefined
}

function parseTime(value: string): { hour: number; minute: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match) return null
  const hour = parseIntInRange(match[1], 0, 23)
  const minute = parseIntInRange(match[2], 0, 59)
  if (hour === null || minute === null) return null
  return { hour, minute }
}

function parsePositiveInt(value: string): number | null {
  return parseIntInRange(value, 1, Number.MAX_SAFE_INTEGER)
}

function parseIntInRange(value: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(value.trim())) return null
  const parsed = Number.parseInt(value, 10)
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) return null
  return parsed
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

// --------------- Shared schedule editor ---------------

const TaskScheduleSection: FC<{
  scheduleForm: TaskScheduleFormState
  timeoutForm: TaskTimeoutFormState
  onScheduleFormChange: (value: TaskScheduleFormState) => void
  onTimeoutFormChange: (value: TaskTimeoutFormState) => void
  onScheduleCommit?: (trigger: Trigger) => void
  onTimeoutCommit?: (timeoutMinutes: number | null) => void
  disabled?: boolean
}> = ({
  scheduleForm,
  timeoutForm,
  onScheduleFormChange,
  onTimeoutFormChange,
  onScheduleCommit,
  onTimeoutCommit,
  disabled
}) => {
  const { t } = useTranslation()
  const [oncePickerOpen, setOncePickerOpen] = useState(false)

  const commitSchedule = useCallback(
    (next: TaskScheduleFormState) => {
      if (next.mode === 'once') {
        const at = parseOnceDate(next.onceAt)
        if (!at || at.getTime() <= Date.now()) {
          window.toast.error(t('agent.cherryClaw.tasks.onceMustBeFuture'))
          return
        }
      }
      const trigger = scheduleFormToTrigger(next)
      if (trigger) onScheduleCommit?.(trigger)
    },
    [onScheduleCommit, t]
  )

  const updateSchedule = useCallback(
    (patch: Partial<TaskScheduleFormState>, commit = false) => {
      const next = { ...scheduleForm, ...patch }
      onScheduleFormChange(next)
      if (commit) commitSchedule(next)
    },
    [commitSchedule, onScheduleFormChange, scheduleForm]
  )

  const commitTimeout = useCallback(
    (next: TaskTimeoutFormState) => {
      const value = timeoutFormToValue(next)
      if (value !== undefined) onTimeoutCommit?.(value)
    },
    [onTimeoutCommit]
  )

  const updateTimeout = useCallback(
    (patch: Partial<TaskTimeoutFormState>, commit = false) => {
      const next = { ...timeoutForm, ...patch }
      onTimeoutFormChange(next)
      if (commit) commitTimeout(next)
    },
    [commitTimeout, onTimeoutFormChange, timeoutForm]
  )

  const scheduleModeOptions: Array<{ value: TaskScheduleMode; label: string }> = [
    { value: 'period', label: t('agent.cherryClaw.tasks.frequency.period') },
    { value: 'interval', label: t('agent.cherryClaw.tasks.frequency.interval') },
    { value: 'once', label: t('agent.cherryClaw.tasks.frequency.once') },
    { value: 'cron', label: t('agent.cherryClaw.tasks.scheduleType.cron') }
  ]

  const handleScheduleModeChange = useCallback(
    (mode: string) => {
      const nextMode = mode as TaskScheduleMode
      if (nextMode === 'once') {
        updateSchedule({ mode: nextMode, onceAt: getFutureOnceDraft(scheduleForm.onceAt) })
        return
      }
      updateSchedule({ mode: nextMode }, true)
    },
    [scheduleForm.onceAt, updateSchedule]
  )

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <SettingRowTitle>{t('agent.cherryClaw.tasks.frequency.label')}</SettingRowTitle>
        <SegmentedControl
          size="sm"
          value={scheduleForm.mode}
          disabled={disabled}
          onValueChange={handleScheduleModeChange}
          options={scheduleModeOptions}
          className="max-w-full"
        />

        {scheduleForm.mode === 'period' && (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <Select
                value={scheduleForm.period}
                disabled={disabled}
                onValueChange={(period) => updateSchedule({ period: period as TaskScheduleFormState['period'] }, true)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">{t('agent.cherryClaw.tasks.frequency.daily')}</SelectItem>
                  <SelectItem value="weekly">{t('agent.cherryClaw.tasks.frequency.weekly')}</SelectItem>
                  <SelectItem value="monthly">{t('agent.cherryClaw.tasks.frequency.monthly')}</SelectItem>
                </SelectContent>
              </Select>

              {scheduleForm.period === 'weekly' && (
                <div>
                  <Select
                    value={scheduleForm.weekday}
                    disabled={disabled}
                    onValueChange={(weekday) => updateSchedule({ weekday }, true)}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">{t('agent.cherryClaw.tasks.frequency.weekdays.mon')}</SelectItem>
                      <SelectItem value="2">{t('agent.cherryClaw.tasks.frequency.weekdays.tue')}</SelectItem>
                      <SelectItem value="3">{t('agent.cherryClaw.tasks.frequency.weekdays.wed')}</SelectItem>
                      <SelectItem value="4">{t('agent.cherryClaw.tasks.frequency.weekdays.thu')}</SelectItem>
                      <SelectItem value="5">{t('agent.cherryClaw.tasks.frequency.weekdays.fri')}</SelectItem>
                      <SelectItem value="6">{t('agent.cherryClaw.tasks.frequency.weekdays.sat')}</SelectItem>
                      <SelectItem value="0">{t('agent.cherryClaw.tasks.frequency.weekdays.sun')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              {scheduleForm.period === 'monthly' && (
                <div>
                  <UIInput
                    type="number"
                    min={1}
                    max={31}
                    value={scheduleForm.monthDay}
                    onChange={(e) => updateSchedule({ monthDay: e.target.value })}
                    onBlur={(e) => commitSchedule({ ...scheduleForm, monthDay: e.target.value })}
                    placeholder={t('agent.cherryClaw.tasks.frequency.monthDayPlaceholder')}
                    disabled={disabled}
                  />
                </div>
              )}

              <div>
                <UIInput
                  type="time"
                  value={scheduleForm.time}
                  onChange={(e) => updateSchedule({ time: e.target.value })}
                  onBlur={(e) => commitSchedule({ ...scheduleForm, time: e.target.value })}
                  disabled={disabled}
                  className="font-mono"
                />
              </div>
            </div>
          </div>
        )}

        {scheduleForm.mode === 'interval' && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-foreground text-sm">{t('agent.cherryClaw.tasks.frequency.everyPrefix')}</span>
            <UIInput
              type="number"
              min={1}
              value={scheduleForm.intervalMinutes}
              onChange={(e) => updateSchedule({ intervalMinutes: e.target.value })}
              onBlur={(e) => commitSchedule({ ...scheduleForm, intervalMinutes: e.target.value })}
              placeholder={DEFAULT_TASK_INTERVAL_MINUTES}
              disabled={disabled}
              className="w-24"
            />
            <span className="text-foreground text-sm">{t('agent.cherryClaw.tasks.frequency.everySuffix')}</span>
          </div>
        )}

        {scheduleForm.mode === 'once' && (
          <div>
            <DateTimePicker
              value={parseScheduleDate(scheduleForm.onceAt)}
              open={oncePickerOpen}
              onOpenChange={(open) => {
                setOncePickerOpen(open)
                if (!open) commitSchedule(scheduleForm)
              }}
              granularity="minute"
              format="yyyy-MM-dd HH:mm"
              placeholder={t('agent.cherryClaw.tasks.oncePlaceholder')}
              onChange={(date) => {
                if (!date) return
                updateSchedule({ onceAt: normalizeScheduleDateToMinute(date).toISOString() })
              }}
              disabled={disabled}
            />
          </div>
        )}

        {scheduleForm.mode === 'cron' && (
          <div>
            <UIInput
              value={scheduleForm.cronExpr}
              onChange={(e) => updateSchedule({ cronExpr: e.target.value })}
              onBlur={(e) => commitSchedule({ ...scheduleForm, cronExpr: e.target.value })}
              placeholder={t('agent.cherryClaw.tasks.cronPlaceholder')}
              disabled={disabled}
              className="w-72 max-w-full"
            />
          </div>
        )}
      </div>

      <div className="space-y-3">
        <SettingRowTitle>{t('agent.cherryClaw.tasks.timeout.label')}</SettingRowTitle>
        <div className="flex flex-wrap items-center gap-3">
          <SegmentedControl
            size="sm"
            value={timeoutForm.mode}
            disabled={disabled}
            onValueChange={(mode) => {
              const nextMode = mode as TaskTimeoutMode
              const minutes =
                nextMode === 'limited' ? timeoutForm.minutes || DEFAULT_TASK_TIMEOUT_FORM.minutes : timeoutForm.minutes
              updateTimeout({ mode: nextMode, minutes }, true)
            }}
            options={[
              { value: 'unlimited', label: t('agent.cherryClaw.tasks.timeout.unlimited') },
              { value: 'limited', label: t('agent.cherryClaw.tasks.timeout.limited') }
            ]}
            className="max-w-full"
          />
          {timeoutForm.mode === 'limited' && (
            <div className="flex items-center gap-2">
              <UIInput
                type="number"
                min={1}
                value={timeoutForm.minutes}
                onChange={(e) => updateTimeout({ minutes: e.target.value })}
                onBlur={(e) => commitTimeout({ ...timeoutForm, minutes: e.target.value })}
                placeholder={t('agent.cherryClaw.tasks.timeout.placeholder')}
                disabled={disabled}
                className="h-8 min-h-8 w-24"
              />
              <span className="text-muted-foreground text-xs">{t('agent.cherryClaw.tasks.intervalUnit')}</span>
            </div>
          )}
        </div>
      </div>
    </div>
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
  const testRunLabel = t('agent.cherryClaw.tasks.testRun.label')
  const testRunDescription = t('agent.cherryClaw.tasks.testRun.description')
  const deleteLabel = t('agent.cherryClaw.tasks.delete.label')
  const moreLabel = t('common.more')
  const toggleStatusLabel =
    task.status === 'active' ? t('agent.cherryClaw.tasks.pause') : t('agent.cherryClaw.tasks.resume')
  const completedStatusLabel = t('agent.cherryClaw.tasks.status.completed')
  const scheduleTypeLabels: Record<string, string> = {
    period: t('agent.cherryClaw.tasks.frequency.period'),
    cron: t('agent.cherryClaw.tasks.scheduleType.cron'),
    interval: t('agent.cherryClaw.tasks.scheduleType.interval'),
    once: t('agent.cherryClaw.tasks.scheduleType.once')
  }
  const agentName = agents.find((a) => a.id === task.agentId)?.name ?? task.agentId

  const initialSchedule = taskTriggerToScheduleForm(task.trigger)
  const [name, setName] = useState(task.name)
  const [prompt, setPrompt] = useState(task.prompt)
  const [promptModalOpen, setPromptModalOpen] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false)
  const [scheduleForm, setScheduleForm] = useState<TaskScheduleFormState>(initialSchedule)
  const [timeoutForm, setTimeoutForm] = useState<TaskTimeoutFormState>(timeoutMinutesToForm(task.timeoutMinutes))
  const [channelIds, setChannelIds] = useState<string[]>(task.channelIds ?? [])

  useEffect(() => {
    setName(task.name)
    setPrompt(task.prompt)
    setScheduleForm(taskTriggerToScheduleForm(task.trigger))
    setTimeoutForm(timeoutMinutesToForm(task.timeoutMinutes))
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

  const handleScheduleCommit = useCallback(
    (trigger: Trigger) => {
      if (JSON.stringify(trigger) === JSON.stringify(task.trigger)) return
      saveField({ trigger })
    },
    [saveField, task.trigger]
  )

  const handleTimeoutCommit = useCallback(
    (timeoutMinutes: number | null) => {
      const prev = task.timeoutMinutes ?? null
      if (timeoutMinutes !== prev) saveField({ timeoutMinutes })
    },
    [saveField, task.timeoutMinutes]
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
    if (task.trigger.kind === 'period') {
      const periodLabels = {
        daily: t('agent.cherryClaw.tasks.frequency.daily'),
        weekly: t('agent.cherryClaw.tasks.frequency.weekly')
      }
      if (task.trigger.period === 'weekly') {
        const weekdayLabels: Record<number, string> = {
          0: t('agent.cherryClaw.tasks.frequency.weekdays.sun'),
          1: t('agent.cherryClaw.tasks.frequency.weekdays.mon'),
          2: t('agent.cherryClaw.tasks.frequency.weekdays.tue'),
          3: t('agent.cherryClaw.tasks.frequency.weekdays.wed'),
          4: t('agent.cherryClaw.tasks.frequency.weekdays.thu'),
          5: t('agent.cherryClaw.tasks.frequency.weekdays.fri'),
          6: t('agent.cherryClaw.tasks.frequency.weekdays.sat')
        }
        return `${periodLabels.weekly} ${weekdayLabels[task.trigger.weekday]} ${task.trigger.time}`
      }
      if (task.trigger.period === 'monthly') {
        return `${t('agent.cherryClaw.tasks.frequency.monthlyDay', { day: task.trigger.monthDay })} ${task.trigger.time}`
      }
      return `${periodLabels.daily} ${task.trigger.time}`
    }
    if (task.trigger.kind === 'cron') {
      return task.trigger.expr
    }
    if (task.trigger.kind === 'interval') {
      const minutes = Math.max(1, Math.round(task.trigger.ms / 60_000))
      return `${minutes} ${t('agent.cherryClaw.tasks.intervalUnit')}`
    }
    return formatDateTime(new Date(task.trigger.at).toISOString())
  }

  const getScheduleTypeLabel = (trigger: Trigger) => {
    return scheduleTypeLabels[trigger.kind] ?? trigger.kind
  }

  return (
    <SettingsContentColumn theme={theme} className="min-w-0 overflow-x-hidden">
      {/* Header card */}
      <SettingGroup theme={theme} className="space-y-3">
        <div className="space-y-1">
          <SettingTitle className="min-w-0 gap-3">
            <MarqueeText className="min-w-0 max-w-full font-semibold text-base text-foreground leading-8">
              <span title={task.name}>{task.name}</span>
            </MarqueeText>
            <div className="flex shrink-0 items-center gap-2">
              {isCompleted ? (
                <span className="inline-flex h-7 items-center text-foreground-muted text-sm leading-none">
                  {completedStatusLabel}
                </span>
              ) : (
                <Switch
                  size="sm"
                  checked={task.status === 'active'}
                  onCheckedChange={(checked) => onToggleStatus(task.id, checked ? 'active' : 'paused')}
                  aria-label={toggleStatusLabel}
                  title={toggleStatusLabel}
                />
              )}
              <Popover open={actionsMenuOpen} onOpenChange={setActionsMenuOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={moreLabel}
                    aria-haspopup="menu"
                    aria-expanded={actionsMenuOpen}>
                    <MoreHorizontal size={14} />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  align="end"
                  side="bottom"
                  sideOffset={6}
                  collisionPadding={8}
                  className="w-64 max-w-[calc(100vw-1rem)] rounded-xl p-1.5"
                  onOpenAutoFocus={(event) => event.preventDefault()}
                  onCloseAutoFocus={(event) => event.preventDefault()}>
                  <MenuList role="menu" className="gap-1">
                    {!isCompleted && (
                      <MenuItem
                        role="menuitem"
                        variant="ghost"
                        size="sm"
                        icon={<Play className="size-3.5" />}
                        label={testRunLabel}
                        description={testRunDescription}
                        descriptionClassName="whitespace-normal text-xs leading-4"
                        aria-label={testRunLabel}
                        className="min-h-12 items-start rounded-lg px-2.5 py-2 text-sm"
                        onClick={handleRunNow}
                      />
                    )}
                    <MenuItem
                      role="menuitem"
                      variant="ghost"
                      size="sm"
                      icon={<Trash2 className="size-3.5 text-destructive" />}
                      label={deleteLabel}
                      className="h-8 rounded-lg px-2.5 text-destructive text-sm hover:bg-destructive/10 hover:text-destructive focus-visible:ring-destructive/20"
                      onClick={handleDeleteAction}
                    />
                  </MenuList>
                </PopoverContent>
              </Popover>
            </div>
          </SettingTitle>
          <div className="truncate font-normal text-foreground-muted text-sm leading-5">{agentName}</div>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Badge className={`${headerMetaBadgeClass} ${badgeColorClass(getScheduleColorKey(task.trigger))}`}>
            <Clock size={13} className="lucide-custom text-current" />
            {getScheduleTypeLabel(task.trigger)} · {formatScheduleValue()}
          </Badge>
          {task.lastRun && (
            <Badge className={`${headerMetaBadgeClass} ${badgeNeutralClass}`}>
              <History size={13} />
              {t('agent.cherryClaw.tasks.lastRun')} {formatDateTime(task.lastRun)}
            </Badge>
          )}
          {task.nextRun && (
            <Badge className={`${headerMetaBadgeClass} ${badgeNeutralClass}`}>
              <CalendarClock size={13} />
              {t('agent.cherryClaw.tasks.nextRun')} {formatDateTime(task.nextRun)}
            </Badge>
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
          <TaskScheduleSection
            scheduleForm={scheduleForm}
            timeoutForm={timeoutForm}
            onScheduleFormChange={setScheduleForm}
            onTimeoutFormChange={setTimeoutForm}
            onScheduleCommit={handleScheduleCommit}
            onTimeoutCommit={handleTimeoutCommit}
            disabled={isCompleted}
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

  const navigateToSession = useCallback((sessionId: string) => {
    // Settings runs in its own window with the same routeTree as main, so calling
    // `navigate({ to: '/app/agents' })` here would mount the agent page inside
    // the Settings popup. Cross-window via the main process instead — settings
    // stays open, main is surfaced and switched to the session.
    void window.api.openAgentSessionInMainWindow(sessionId)
  }, [])

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
        meta: { className: 'whitespace-nowrap', headerClassName: 'whitespace-nowrap' },
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
            <div className="flex items-center gap-1">
              <span className={isErrorStatus ? 'text-red-500' : ''}>{text}</span>
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
      <DataTable
        data={filteredLogs}
        columns={columns}
        rowKey="id"
        className="[&_[data-slot=table-container]::-webkit-scrollbar]:hidden [&_[data-slot=table-container]]:[scrollbar-width:none]"
        emptyText={t('agent.cherryClaw.tasks.logs.empty')}
      />
    </div>
  )
}

// --------------- Schedule type config ---------------

const scheduleTypeColors: Record<string, string> = {
  cron: 'purple',
  interval: 'blue',
  once: 'orange',
  period: 'green'
}

const headerMetaBadgeClass = 'h-7 gap-1.5 px-2.5 py-0 text-xs font-medium leading-none'
const badgeNeutralClass = 'border-border bg-background-subtle text-foreground-muted'

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
  const [scheduleForm, setScheduleForm] = useState<TaskScheduleFormState>(DEFAULT_TASK_SCHEDULE_FORM)
  const [timeoutForm, setTimeoutForm] = useState<TaskTimeoutFormState>(DEFAULT_TASK_TIMEOUT_FORM)
  const [channelIds, setChannelIds] = useState<string[]>([])
  // TODO(agent-workspace-picker): wire the workspace picker before re-enabling task creation.
  const [workspaceSource] = useState<CreateTaskRequest['workspace'] | null>(null)
  const [saving, setSaving] = useState(false)

  const trigger = scheduleFormToTrigger(scheduleForm)
  const timeoutMinutes = timeoutFormToValue(timeoutForm)
  const isValid = agentId && name.trim() && prompt.trim() && trigger && timeoutMinutes !== undefined && workspaceSource

  const handleCreate = useCallback(async () => {
    if (!agentId || !name.trim() || !prompt.trim() || !trigger || timeoutMinutes === undefined || !workspaceSource)
      return
    setSaving(true)
    try {
      await onCreate(agentId, {
        name: name.trim(),
        prompt: prompt.trim(),
        trigger,
        workspace: workspaceSource,
        timeoutMinutes,
        channelIds: channelIds.length > 0 ? channelIds : undefined
      })
    } finally {
      setSaving(false)
    }
  }, [agentId, name, prompt, trigger, timeoutMinutes, workspaceSource, channelIds, onCreate])

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

          <TaskScheduleSection
            scheduleForm={scheduleForm}
            timeoutForm={timeoutForm}
            onScheduleFormChange={setScheduleForm}
            onTimeoutFormChange={setTimeoutForm}
          />
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

  const selectedTask = useMemo(
    () => tasks.find((t) => t.id === selectedTaskId) ?? (!creating ? (tasks[0] ?? null) : null),
    [creating, tasks, selectedTaskId]
  )

  const getAgentName = useCallback((agentId: string) => agents.find((a) => a.id === agentId)?.name ?? agentId, [agents])
  const getScheduleTypeLabel = useCallback(
    (trigger: Trigger) => {
      const labels: Record<string, string> = {
        period: t('agent.cherryClaw.tasks.frequency.period'),
        cron: t('agent.cherryClaw.tasks.scheduleType.cron'),
        interval: t('agent.cherryClaw.tasks.scheduleType.interval'),
        once: t('agent.cherryClaw.tasks.scheduleType.once')
      }
      return labels[trigger.kind] ?? trigger.kind
    },
    [t]
  )

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
        className="flex w-full min-w-0 flex-1 flex-row overflow-hidden"
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
                  active={selectedTask?.id === task.id && !creating}
                  title={task.name}
                  subtitle={`${getAgentName(task.agentId)} · ${getScheduleTypeLabel(task.trigger)}`}
                  showTooltip={false}
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
