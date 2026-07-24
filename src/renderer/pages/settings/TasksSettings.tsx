import type { ColumnDef } from '@cherrystudio/ui'
import {
  Alert,
  Badge,
  Button,
  Center,
  Combobox,
  ConfirmDialog,
  DataTable,
  DateTimePicker,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemSeparator,
  ItemTitle,
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
  RowFlex,
  Scrollbar,
  SearchInput,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tooltip
} from '@cherrystudio/ui'
import { loggerService } from '@logger'
import PromptEditorField from '@renderer/components/PromptEditorField'
import { PromptPolishActions } from '@renderer/components/resourceCatalog/dialogs/components/PromptPolishActions'
import { AgentSelector, WorkspaceSelector } from '@renderer/components/resourceCatalog/selectors'
import {
  SettingDescription,
  SettingDivider,
  SettingGroup,
  SettingsContentColumn,
  SettingTitle
} from '@renderer/components/SettingsPrimitives'
import { useQuery } from '@renderer/data/hooks/useDataApi'
import { useChannels } from '@renderer/hooks/agent/useChannels'
import {
  useAllTasks,
  useCreateTask,
  useDeleteTask,
  useRunTask,
  useTask,
  useTaskLogs,
  useUpdateTask
} from '@renderer/hooks/agent/useTasks'
import { useConversationNavigation } from '@renderer/hooks/useConversationNavigation'
import { useTheme } from '@renderer/hooks/useTheme'
import { openRoute } from '@renderer/services/mainWindowNavigation'
import { toast } from '@renderer/services/toast'
import type { AgentChannelEntity } from '@shared/data/api/schemas/agentChannels'
import { AGENTS_MAX_LIMIT } from '@shared/data/api/schemas/agents'
import { AGENT_WORKSPACE_TYPE } from '@shared/data/api/schemas/agentWorkspaces'
import type { Trigger } from '@shared/data/api/schemas/jobs'
import type {
  CreateTaskRequest,
  ScheduledTaskEntity,
  TaskRunLogEntity,
  UpdateTaskRequest
} from '@shared/data/types/agent'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import type { TFunction } from 'i18next'
import {
  ArrowLeft,
  Bot,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  CircleSlash,
  ExternalLink,
  Folder,
  MoreHorizontal,
  PencilLine,
  Play,
  Plus,
  Trash2
} from 'lucide-react'
import { type FC, Fragment, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('TasksSettings')
const ALL_TASKS_FILTER = 'all'
const SCHEDULE_HOURS = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, '0'))
const SCHEDULE_MINUTES = Array.from({ length: 60 }, (_, minute) => String(minute).padStart(2, '0'))

const TASK_PROMPT_GENERATION_SYSTEM_PROMPT = [
  'Write a concise execution prompt for a scheduled Agent task based on the supplied task name.',
  'Describe the concrete work the Agent should perform each time the schedule runs.',
  'Include the expected result or delivery outcome when it can be inferred.',
  'Do not create a persona, role profile, background, greeting, or initialization script.',
  'Keep the output in the same language as the task name.',
  'Return only the task prompt with no explanation, wrapper, or code fence.'
].join('\n')

const TASK_PROMPT_POLISH_SYSTEM_PROMPT = [
  'Improve the supplied scheduled task prompt without changing its intent.',
  'Make the recurring action, required inputs, constraints, and expected result concrete and concise.',
  'Do not turn the task into a persona, role profile, background, greeting, or initialization script.',
  'Keep the output in the same language as the input.',
  'Preserve Markdown, code, URLs, and every placeholder token verbatim, including tokens shaped like {{name}} and ${name}; keep duplicate occurrences.',
  'Return only the polished task prompt with no explanation, wrapper, or code fence.'
].join('\n')

type AgentInfo = { id: string; name: string }
type ChannelInfo = { id: string; agentId?: string | null; name: string; isActive?: boolean; hasActiveChatIds?: boolean }

function toChannelInfo(channel: AgentChannelEntity): ChannelInfo {
  // Config keys are snake_case in the channel config schemas; only some channel
  // types carry allowed_channel_ids, hence the narrow local view of the union.
  const config = channel.config as { allowed_chat_ids?: string[]; allowed_channel_ids?: string[] } | undefined
  return {
    id: channel.id,
    agentId: channel.agentId ?? null,
    name: channel.name || channel.type,
    isActive: channel.isActive,
    hasActiveChatIds:
      (config?.allowed_chat_ids?.length ?? 0) > 0 ||
      (config?.allowed_channel_ids?.length ?? 0) > 0 ||
      (channel.activeChatIds?.length ?? 0) > 0
  }
}

export type ScheduleKind = 'hourly' | 'daily' | 'weekdays' | 'weekly' | 'interval' | 'once' | 'cron'
export type ScheduleFormState = {
  kind: ScheduleKind
  value: string
  weekday: string
  timeoutMinutes: string
}

type TaskDraftSnapshot = {
  name: string
  prompt: string
  schedule: ScheduleFormState
  channelIds: string[]
  workspaceId: string | null
}
type TaskUpdateResult = {
  succeeded: boolean
  task: ScheduledTaskEntity
}

const DEFAULT_SCHEDULE: ScheduleFormState = {
  kind: 'daily',
  value: '09:00',
  weekday: '1',
  timeoutMinutes: ''
}

const parseScheduleDate = (value: string) => {
  if (!value) return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}

const parseTime = (value: string) => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
  return { hour, minute }
}

const formatTime = (hour: number, minute: number) =>
  `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`

export function triggerToFormState(trigger: Trigger): Omit<ScheduleFormState, 'timeoutMinutes'> {
  if (trigger.kind === 'interval') {
    return {
      kind: 'interval',
      value: String(Math.max(1, Math.round(trigger.ms / 60_000))),
      weekday: '1'
    }
  }

  if (trigger.kind === 'once') {
    return {
      kind: 'once',
      value: new Date(trigger.at).toISOString(),
      weekday: '1'
    }
  }

  const parts = trigger.expr.trim().split(/\s+/)
  if (parts.length !== 5) {
    return { kind: 'cron', value: trigger.expr, weekday: '1' }
  }

  const [minutePart, hourPart, dayOfMonth, month, dayOfWeek] = parts
  if (minutePart === '0' && hourPart === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return { kind: 'hourly', value: '', weekday: '1' }
  }

  const minute = Number(minutePart)
  const hour = Number(hourPart)
  const hasValidTime =
    Number.isInteger(minute) && minute >= 0 && minute <= 59 && Number.isInteger(hour) && hour >= 0 && hour <= 23

  if (!hasValidTime || dayOfMonth !== '*' || month !== '*') {
    return { kind: 'cron', value: trigger.expr, weekday: '1' }
  }

  const value = formatTime(hour, minute)
  if (dayOfWeek === '*') return { kind: 'daily', value, weekday: '1' }
  if (dayOfWeek === '1-5') return { kind: 'weekdays', value, weekday: '1' }
  if (/^[0-6]$/.test(dayOfWeek)) return { kind: 'weekly', value, weekday: dayOfWeek }
  return { kind: 'cron', value: trigger.expr, weekday: '1' }
}

export function formStateToTrigger(schedule: ScheduleFormState): Trigger | null {
  if (schedule.kind === 'hourly') return { kind: 'cron', expr: '0 * * * *' }

  if (schedule.kind === 'interval') {
    const minutes = Number(schedule.value.trim())
    if (!Number.isInteger(minutes) || minutes <= 0) return null
    return { kind: 'interval', ms: minutes * 60_000 }
  }

  if (schedule.kind === 'once') {
    const at = Date.parse(schedule.value.trim())
    return Number.isFinite(at) ? { kind: 'once', at } : null
  }

  if (schedule.kind === 'cron') {
    const expr = schedule.value.trim()
    return expr ? { kind: 'cron', expr } : null
  }

  const time = parseTime(schedule.value)
  if (!time) return null
  const prefix = `${time.minute} ${time.hour} * *`

  if (schedule.kind === 'daily') return { kind: 'cron', expr: `${prefix} *` }
  if (schedule.kind === 'weekdays') return { kind: 'cron', expr: `${prefix} 1-5` }
  if (!/^[0-6]$/.test(schedule.weekday)) return null
  return { kind: 'cron', expr: `${prefix} ${schedule.weekday}` }
}

function scheduleForKind(kind: ScheduleKind, current: ScheduleFormState): ScheduleFormState {
  switch (kind) {
    case 'hourly':
      return { ...current, kind, value: '' }
    case 'daily':
    case 'weekdays':
    case 'weekly':
      return { ...current, kind, value: parseTime(current.value) ? current.value : '09:00' }
    case 'interval':
    case 'once':
    case 'cron':
      return { ...current, kind, value: '' }
  }
}

function taskToDraftSnapshot(task: ScheduledTaskEntity): TaskDraftSnapshot {
  return {
    name: task.name,
    prompt: task.prompt,
    schedule: {
      ...triggerToFormState(task.trigger),
      timeoutMinutes: task.timeoutMinutes > 0 ? task.timeoutMinutes.toString() : ''
    },
    channelIds: task.channelIds ?? [],
    workspaceId: task.workspace.type === AGENT_WORKSPACE_TYPE.USER ? task.workspace.workspaceId : null
  }
}

function scheduleInputsEqual(a: ScheduleFormState, b: ScheduleFormState): boolean {
  return a.kind === b.kind && a.value === b.value && a.weekday === b.weekday
}

function stringArraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

function triggersEqual(a: Trigger, b: Trigger): boolean {
  if (a.kind === 'cron' && b.kind === 'cron') {
    return a.expr === b.expr && a.timezone === b.timezone && a.limit === b.limit
  }
  if (a.kind === 'interval' && b.kind === 'interval') return a.ms === b.ms && a.anchor === b.anchor
  if (a.kind === 'once' && b.kind === 'once') return a.at === b.at
  return false
}

function preserveCompatibleTriggerMetadata(previous: Trigger, next: Trigger): Trigger {
  if (previous.kind === 'cron' && next.kind === 'cron') {
    return { ...previous, expr: next.expr }
  }
  if (previous.kind === 'interval' && next.kind === 'interval') {
    return { ...previous, ms: next.ms }
  }
  return next
}

function getWeekdayLabel(weekday: string, t: TFunction) {
  const labels: Record<string, string> = {
    '0': t('agent.tasks.schedule.weekdays.sunday'),
    '1': t('agent.tasks.schedule.weekdays.monday'),
    '2': t('agent.tasks.schedule.weekdays.tuesday'),
    '3': t('agent.tasks.schedule.weekdays.wednesday'),
    '4': t('agent.tasks.schedule.weekdays.thursday'),
    '5': t('agent.tasks.schedule.weekdays.friday'),
    '6': t('agent.tasks.schedule.weekdays.saturday')
  }
  return labels[weekday] ?? weekday
}

function getScheduleKindLabel(kind: ScheduleKind, t: TFunction) {
  const labels: Record<ScheduleKind, string> = {
    hourly: t('agent.tasks.schedule.hourly'),
    daily: t('agent.tasks.schedule.daily'),
    weekdays: t('agent.tasks.schedule.weekdaysOnly'),
    weekly: t('agent.tasks.schedule.weekly'),
    interval: t('agent.tasks.schedule.interval'),
    once: t('agent.tasks.schedule.once'),
    cron: t('agent.tasks.schedule.custom')
  }
  return labels[kind]
}

function getTaskStatusLabel(status: string, t: TFunction) {
  const labels: Record<string, string> = {
    active: t('agent.tasks.status.active'),
    paused: t('agent.tasks.status.paused'),
    completed: t('agent.tasks.status.completed')
  }
  return labels[status] ?? status
}

function getTriggerSummary(trigger: Trigger, t: TFunction) {
  const schedule = triggerToFormState(trigger)
  switch (schedule.kind) {
    case 'hourly':
      return t('agent.tasks.schedule.summary.hourly')
    case 'daily':
      return t('agent.tasks.schedule.summary.daily', { time: schedule.value })
    case 'weekdays':
      return t('agent.tasks.schedule.summary.weekdays', { time: schedule.value })
    case 'weekly':
      return t('agent.tasks.schedule.summary.weekly', {
        weekday: getWeekdayLabel(schedule.weekday, t),
        time: schedule.value
      })
    case 'interval':
      return t('agent.tasks.schedule.summary.interval', { count: Number(schedule.value) })
    case 'once':
      return new Date(schedule.value).toLocaleString()
    case 'cron':
      return schedule.value
  }
}

const TaskTimeSelect: FC<{
  value: string
  disabled?: boolean
  onChange: (value: string) => void
}> = ({ value, disabled, onChange }) => {
  const { t } = useTranslation()
  const { hour, minute } = parseTime(value) ?? { hour: 9, minute: 0 }
  const hourValue = String(hour).padStart(2, '0')
  const minuteValue = String(minute).padStart(2, '0')

  return (
    <RowFlex role="group" aria-label={t('agent.tasks.schedule.time')} className="items-center gap-2">
      <Select
        value={hourValue}
        disabled={disabled}
        onValueChange={(nextHour) => onChange(`${nextHour}:${minuteValue}`)}>
        <SelectTrigger aria-label={t('agent.tasks.schedule.hour')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {SCHEDULE_HOURS.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <InputGroupText aria-hidden="true">:</InputGroupText>
      <Select
        value={minuteValue}
        disabled={disabled}
        onValueChange={(nextMinute) => onChange(`${hourValue}:${nextMinute}`)}>
        <SelectTrigger aria-label={t('agent.tasks.schedule.minute')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {SCHEDULE_MINUTES.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </RowFlex>
  )
}

function updatePositiveIntegerInput(value: string, onChange: (value: string) => void) {
  if (/^\d*$/.test(value)) onChange(value)
}

const TaskScheduleControls: FC<{
  value: ScheduleFormState
  disabled?: boolean
  invalid?: boolean
  onChange: (value: ScheduleFormState) => void
}> = ({ value, disabled, invalid, onChange }) => {
  const { t } = useTranslation()
  const id = useId()

  const updateKind = (kind: ScheduleKind) => {
    onChange(scheduleForKind(kind, value))
  }

  const updateValue = (nextValue: string) => onChange({ ...value, value: nextValue })

  const frequencyControl =
    value.kind === 'daily' || value.kind === 'weekdays' ? (
      <TaskTimeSelect value={value.value} disabled={disabled} onChange={updateValue} />
    ) : value.kind === 'weekly' ? (
      <>
        <Select
          value={value.weekday}
          disabled={disabled}
          onValueChange={(weekday) => {
            onChange({ ...value, weekday })
          }}>
          <SelectTrigger aria-label={t('agent.tasks.schedule.weekday')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {['1', '2', '3', '4', '5', '6', '0'].map((weekday) => (
                <SelectItem key={weekday} value={weekday}>
                  {getWeekdayLabel(weekday, t)}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <TaskTimeSelect value={value.value} disabled={disabled} onChange={updateValue} />
      </>
    ) : value.kind === 'interval' ? (
      <InputGroup className="w-40" data-disabled={disabled || undefined}>
        <InputGroupInput
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={value.value}
          placeholder={t('agent.tasks.intervalPlaceholder')}
          disabled={disabled}
          aria-label={t('agent.tasks.schedule.intervalMinutes')}
          aria-invalid={invalid || undefined}
          onChange={(event) => updatePositiveIntegerInput(event.target.value, updateValue)}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupText>{t('agent.tasks.intervalUnit')}</InputGroupText>
        </InputGroupAddon>
      </InputGroup>
    ) : value.kind === 'once' ? (
      <DateTimePicker
        value={parseScheduleDate(value.value)}
        granularity="minute"
        format="yyyy-MM-dd HH:mm"
        placeholder={t('agent.tasks.oncePlaceholder')}
        disabled={disabled}
        labels={{
          hour: t('agent.tasks.schedule.hour'),
          minute: t('agent.tasks.schedule.minute')
        }}
        onChange={(date) => {
          if (date) updateValue(date.toISOString())
        }}
      />
    ) : null

  return (
    <FieldGroup>
      <Field data-invalid={invalid || undefined}>
        <FieldLabel htmlFor={`${id}-kind`}>{t('agent.tasks.frequency.label')}</FieldLabel>
        <RowFlex className="flex-wrap items-center gap-3">
          <Select
            value={value.kind === 'cron' ? undefined : value.kind}
            disabled={disabled}
            onValueChange={(kind) => updateKind(kind as Exclude<ScheduleKind, 'cron'>)}>
            <SelectTrigger id={`${id}-kind`} aria-invalid={invalid || undefined}>
              <SelectValue placeholder={value.kind === 'cron' ? t('agent.tasks.schedule.custom') : undefined} />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="hourly">{t('agent.tasks.schedule.hourly')}</SelectItem>
                <SelectItem value="daily">{t('agent.tasks.schedule.daily')}</SelectItem>
                <SelectItem value="weekdays">{t('agent.tasks.schedule.weekdaysOnly')}</SelectItem>
                <SelectItem value="weekly">{t('agent.tasks.schedule.weekly')}</SelectItem>
                <SelectItem value="interval">{t('agent.tasks.schedule.interval')}</SelectItem>
                <SelectItem value="once">{t('agent.tasks.schedule.once')}</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          {frequencyControl}
        </RowFlex>
        <FieldError>{invalid ? t('agent.tasks.schedule.invalid') : undefined}</FieldError>
      </Field>

      <Field>
        <FieldLabel htmlFor={`${id}-timeout`}>{t('agent.tasks.timeout.label')}</FieldLabel>
        <InputGroup data-disabled={disabled || undefined}>
          <InputGroupInput
            id={`${id}-timeout`}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={value.timeoutMinutes}
            placeholder={t('agent.tasks.timeout.placeholder')}
            disabled={disabled}
            onChange={(event) =>
              updatePositiveIntegerInput(event.target.value, (timeoutMinutes) => onChange({ ...value, timeoutMinutes }))
            }
          />
          <InputGroupAddon align="inline-end">
            <InputGroupText>{t('agent.tasks.intervalUnit')}</InputGroupText>
          </InputGroupAddon>
        </InputGroup>
      </Field>
    </FieldGroup>
  )
}

const TaskChannelSelector: FC<{
  channels: ChannelInfo[]
  channelIds: string[]
  onChange: (value: string[]) => void
  disabled?: boolean
}> = ({ channels, channelIds, onChange, disabled }) => {
  const { t } = useTranslation()

  if (channels.length === 0) return null

  const hasNoChatIds = channelIds.some((id) => !channels.find((channel) => channel.id === id)?.hasActiveChatIds)

  return (
    <Field>
      <FieldLabel>{t('agent.tasks.channels.label')}</FieldLabel>
      <Combobox
        multiple
        size="default"
        width="100%"
        value={channelIds}
        disabled={disabled}
        searchable={channels.length > 5}
        onChange={(nextValue) => {
          if (Array.isArray(nextValue)) onChange(nextValue)
        }}
        placeholder={t('agent.tasks.channels.placeholder')}
        searchPlaceholder={t('agent.tasks.channels.placeholder')}
        emptyText={t('common.no_results')}
        options={channels.map((channel) => ({
          value: channel.id,
          label: channel.name,
          isActive: channel.isActive
        }))}
        renderOption={(option) => (
          <span className="flex min-w-0 items-center gap-2">
            <span
              aria-hidden="true"
              className={`inline-block h-1.5 w-1.5 rounded-full ${option.isActive ? 'bg-green-500' : 'bg-gray-400'}`}
            />
            <span className="truncate">{option.label}</span>
            <span className="sr-only">{t(option.isActive ? 'common.enabled' : 'common.disabled')}</span>
          </span>
        )}
      />
      {hasNoChatIds && <Alert type="warning" showIcon description={t('agent.tasks.channels.noActiveChatIds')} />}
    </Field>
  )
}

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

  const columns = useMemo<ColumnDef<TaskRunLogEntity>[]>(
    () => [
      {
        accessorKey: 'startedAt',
        header: t('agent.tasks.logs.runAt'),
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
        header: t('agent.tasks.logs.duration'),
        meta: { width: 80 },
        cell: ({ getValue, row }) => {
          const value = getValue() as number
          if (row.original.status === 'running') return '-'
          if (value < 1000) return `${value}ms`
          if (value < 60_000) return `${(value / 1000).toFixed(1)}s`
          return `${(value / 60_000).toFixed(1)}m`
        }
      },
      {
        accessorKey: 'status',
        header: t('agent.tasks.logs.status'),
        meta: { width: 90 },
        cell: ({ getValue }) => {
          const value = getValue() as string
          const labels: Record<string, string> = {
            completed: t('agent.tasks.logs.completed'),
            running: t('agent.tasks.logs.running'),
            failed: t('agent.tasks.logs.failed'),
            cancelled: t('agent.tasks.logs.cancelled')
          }
          return (
            <Badge variant={value === 'failed' ? 'destructive' : value === 'running' ? 'secondary' : 'outline'}>
              {labels[value] ?? value}
            </Badge>
          )
        }
      },
      {
        id: 'result',
        header: t('agent.tasks.logs.result'),
        meta: { width: 'calc(100% - 330px)', className: 'min-w-0' },
        cell: ({ row }) => {
          const record = row.original
          const isErrorStatus = record.status === 'failed' || record.status === 'cancelled'
          const text =
            record.status === 'running'
              ? t('agent.tasks.logs.running')
              : isErrorStatus
                ? record.error
                : (record.result ?? '-')

          return (
            <RowFlex className="items-start gap-1">
              {record.sessionId && (
                <Tooltip title={t('agent.tasks.logs.viewSession')}>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('agent.tasks.logs.viewSession')}
                    onClick={() => openConversation(record.sessionId!)}>
                    <ExternalLink size={12} />
                  </Button>
                </Tooltip>
              )}
              <span className={isErrorStatus ? 'line-clamp-4 text-red-500' : 'line-clamp-4'}>{text}</span>
            </RowFlex>
          )
        }
      }
    ],
    [openConversation, t]
  )

  if (isLoading) {
    return (
      <Center className="py-4">
        <Spinner text={t('common.loading')} />
      </Center>
    )
  }

  if (logsError) {
    return <EmptyState compact preset="no-result" description={t('agent.tasks.logs.loadError')} />
  }

  if (logs.length === 0) {
    return <EmptyState compact preset="no-result" description={t('agent.tasks.logs.empty')} />
  }

  return (
    <FieldGroup>
      <SearchInput
        size="sm"
        value={searchText}
        placeholder={t('agent.tasks.logs.search')}
        clearLabel={t('common.clear')}
        onClear={() => setSearchText('')}
        onChange={(event) => setSearchText(event.target.value)}
      />
      <div data-slot="task-logs-table-scroll" className="max-w-full overflow-x-auto">
        <div data-slot="task-logs-table-width" className="min-w-[720px]">
          <DataTable data={filteredLogs} columns={columns} rowKey="id" emptyText={t('agent.tasks.logs.empty')} />
        </div>
      </div>
    </FieldGroup>
  )
}

const TaskDetail: FC<{
  task: ScheduledTaskEntity
  agents: AgentInfo[]
  onBack: () => void
  onUpdate: (taskId: string, updates: UpdateTaskRequest) => Promise<TaskUpdateResult | undefined>
  onDelete: (taskId: string) => Promise<void>
  onRun: (taskId: string) => Promise<void>
  onToggleStatus: (taskId: string, newStatus: string) => Promise<void>
}> = ({ task, agents, onBack, onUpdate, onDelete, onRun, onToggleStatus }) => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const { channels: rawChannels } = useChannels()
  const isCompleted = task.status === 'completed'
  const agentName = agents.find((agent) => agent.id === task.agentId)?.name ?? task.agentId
  const taskChannels = useMemo(
    () => rawChannels.map(toChannelInfo).filter((channel) => channel.agentId === task.agentId),
    [rawChannels, task.agentId]
  )
  const selectedChannels = useMemo(
    () =>
      (task.channelIds ?? []).map(
        (channelId) => taskChannels.find((channel) => channel.id === channelId) ?? { id: channelId, name: channelId }
      ),
    [task.channelIds, taskChannels]
  )
  const hasUndeliverableChannel = selectedChannels.some((channel) => !channel.hasActiveChatIds)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const { data: workspaces } = useQuery('/agent-workspaces')

  const workspaceId = task.workspace.type === AGENT_WORKSPACE_TYPE.USER ? task.workspace.workspaceId : null
  const workspaceLabel =
    workspaceId === null
      ? t('agent.session.workspace_selector.no_project')
      : (workspaces?.find((workspace) => workspace.id === workspaceId)?.name ?? workspaceId)

  const formatDateTime = (iso: string | null | undefined) => {
    if (!iso) return '-'
    const date = new Date(iso)
    const diff = Math.abs(Date.now() - date.getTime())
    if (diff < 86_400_000) {
      return date.toLocaleString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
    }
    return date.toLocaleString(undefined, {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    })
  }

  const detailItems = [
    { label: t('agent.channels.bindAgent'), value: agentName },
    { label: t('agent.tasks.frequency.label'), value: getTriggerSummary(task.trigger, t) },
    {
      label: t('agent.tasks.timeout.label'),
      value:
        task.timeoutMinutes > 0
          ? `${task.timeoutMinutes} ${t('agent.tasks.intervalUnit')}`
          : t('agent.tasks.timeout.placeholder')
    },
    { label: t('agent.session.display.workdir'), value: workspaceLabel },
    {
      label: t('agent.tasks.channels.label'),
      value: selectedChannels.length > 0 ? selectedChannels.map((channel) => channel.name).join(', ') : t('common.none')
    },
    { label: t('agent.tasks.lastRun'), value: formatDateTime(task.lastRun) },
    { label: t('agent.tasks.nextRun'), value: formatDateTime(task.nextRun) }
  ]

  const handleEditSave = useCallback(
    async (request: UpdateTaskRequest) => {
      const result = await onUpdate(task.id, request)
      return result?.succeeded === true
    },
    [onUpdate, task.id]
  )

  return (
    <SettingsContentColumn theme={theme}>
      <SettingGroup theme={theme}>
        <SettingTitle className="flex-wrap gap-3">
          <Button
            type="button"
            size="lg"
            variant="ghost"
            className="px-0"
            aria-label={t('common.back')}
            onClick={onBack}>
            <ArrowLeft size={16} />
            <span className="min-w-0 break-words">{task.name}</span>
          </Button>
          <RowFlex className="flex-wrap items-center gap-2">
            {!isCompleted && (
              <Button type="button" variant="outline" className="min-w-18" onClick={() => setEditOpen(true)}>
                <PencilLine size={14} />
                {t('common.edit')}
              </Button>
            )}
            {!isCompleted && (
              <Button type="button" variant="default" className="min-w-18" onClick={() => void onRun(task.id)}>
                <Play size={14} />
                {t('agent.tasks.run')}
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" size="icon-sm" variant="ghost" aria-label={t('common.more')}>
                  <MoreHorizontal size={14} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuGroup>
                  <DropdownMenuItem variant="destructive" onSelect={() => setDeleteConfirmOpen(true)}>
                    <Trash2 />
                    {t('agent.tasks.delete.label')}
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </RowFlex>
        </SettingTitle>
        <RowFlex className="mt-3 flex-wrap items-center gap-2">
          {!isCompleted && (
            <Switch
              size="sm"
              checked={task.status === 'active'}
              onCheckedChange={(checked) => onToggleStatus(task.id, checked ? 'active' : 'paused')}
              aria-label={t('agent.tasks.status.active')}
              title={task.status === 'active' ? t('agent.tasks.pause') : t('agent.tasks.resume')}
            />
          )}
          <Badge variant="secondary">{getTaskStatusLabel(task.status, t)}</Badge>
          {task.nextRun && (
            <SettingDescription className="mt-0">
              {t('agent.tasks.nextRun')}: {formatDateTime(task.nextRun)}
            </SettingDescription>
          )}
        </RowFlex>
      </SettingGroup>

      <SettingGroup theme={theme}>
        <Tabs defaultValue="prompt" variant="line">
          <TabsList aria-label={task.name}>
            <TabsTrigger value="prompt">{t('agent.tasks.prompt.label')}</TabsTrigger>
            <TabsTrigger value="general">{t('settings.general.title')}</TabsTrigger>
            <TabsTrigger value="history">{t('agent.tasks.logs.label')}</TabsTrigger>
          </TabsList>
          <TabsContent value="prompt">
            <SettingDivider />
            <Item variant="muted">
              <ItemContent>
                <ItemDescription className="line-clamp-none whitespace-pre-wrap break-words">
                  {task.prompt}
                </ItemDescription>
              </ItemContent>
            </Item>
          </TabsContent>
          <TabsContent value="general">
            <SettingDivider />
            <ItemGroup>
              {detailItems.map((item, index) => (
                <Fragment key={item.label}>
                  {index > 0 && <ItemSeparator />}
                  <Item size="sm">
                    <ItemContent>
                      <ItemTitle>{item.label}</ItemTitle>
                      <ItemDescription className="line-clamp-none break-words">{item.value}</ItemDescription>
                    </ItemContent>
                  </Item>
                </Fragment>
              ))}
            </ItemGroup>
            {hasUndeliverableChannel && (
              <Alert type="warning" showIcon description={t('agent.tasks.channels.noActiveChatIds')} />
            )}
          </TabsContent>
          <TabsContent value="history">
            <SettingDivider />
            <TaskLogsInline taskId={task.id} agentId={task.agentId} />
          </TabsContent>
        </Tabs>
      </SettingGroup>

      <TaskFormDialog
        open={editOpen}
        task={task}
        agents={agents}
        onOpenChange={setEditOpen}
        onUpdate={handleEditSave}
      />

      <ConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        title={t('agent.tasks.delete.confirm')}
        confirmText={t('agent.tasks.delete.label')}
        cancelText={t('agent.tasks.cancel')}
        destructive
        onConfirm={() => onDelete(task.id)}
      />
    </SettingsContentColumn>
  )
}

type TaskFormDialogProps = {
  open: boolean
  agents: AgentInfo[]
  onOpenChange: (open: boolean) => void
} & (
  | {
      task: ScheduledTaskEntity
      onUpdate: (request: UpdateTaskRequest) => Promise<boolean>
      onCreate?: never
    }
  | {
      task?: undefined
      onCreate: (agentId: string, request: CreateTaskRequest) => Promise<boolean>
      onUpdate?: never
    }
)

const TaskFormDialog: FC<TaskFormDialogProps> = (props) => {
  const { open, task, agents, onOpenChange } = props
  const { t } = useTranslation()
  const { channels: rawChannels, error: channelsError, isLoading: channelsLoading } = useChannels()
  const channelsReady = !channelsLoading && !channelsError
  const isEditing = task !== undefined
  const [agentId, setAgentId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [schedule, setSchedule] = useState<ScheduleFormState>(DEFAULT_SCHEDULE)
  const [channelIds, setChannelIds] = useState<string[]>([])
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [promptPreviewKey, setPromptPreviewKey] = useState(0)
  const wasOpenRef = useRef(false)
  const initialDraftRef = useRef<TaskDraftSnapshot | null>(null)
  const { data: workspaces } = useQuery('/agent-workspaces')

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      const draft = task ? taskToDraftSnapshot(task) : null
      initialDraftRef.current = draft
      setAgentId(task?.agentId ?? (agents.length === 1 ? agents[0].id : null))
      setName(draft?.name ?? '')
      setPrompt(draft?.prompt ?? '')
      setSchedule(draft?.schedule ?? DEFAULT_SCHEDULE)
      setChannelIds(draft?.channelIds ?? [])
      setWorkspaceId(draft?.workspaceId ?? null)
      setSaving(false)
      setSubmitted(false)
      setPromptPreviewKey((key) => key + 1)
    }
    wasOpenRef.current = open
  }, [agents, open, task])

  const availableChannels = useMemo(
    () => (agentId ? rawChannels.map(toChannelInfo).filter((channel) => channel.agentId === agentId) : []),
    [agentId, rawChannels]
  )

  useEffect(() => {
    // Never prune against an unloaded channel list: with the channels query
    // still in flight (or failed) every draft binding would be dropped and the
    // next save would silently clear the task's subscriptions.
    if (!channelsReady) return
    setChannelIds((current) =>
      current.filter((channelId) => availableChannels.some((channel) => channel.id === channelId))
    )
  }, [availableChannels, channelsReady])

  const isSystemWorkspace = workspaceId === null
  const selectedAgent = agents.find((agent) => agent.id === agentId)
  const workspaceLabel = isSystemWorkspace
    ? t('agent.session.workspace_selector.no_project')
    : (workspaces?.find((workspace) => workspace.id === workspaceId)?.name ?? workspaceId)
  const trigger = formStateToTrigger(schedule)

  const handleSave = useCallback(async () => {
    setSubmitted(true)
    if (!agentId || !name.trim() || !prompt.trim() || !trigger) return

    setSaving(true)
    try {
      const timeout = Number(schedule.timeoutMinutes)
      const workspace =
        workspaceId === null
          ? ({ type: AGENT_WORKSPACE_TYPE.SYSTEM } as const)
          : ({ type: AGENT_WORKSPACE_TYPE.USER, workspaceId } as const)
      const timeoutMinutes = Number.isInteger(timeout) && timeout > 0 ? timeout : null

      let saved: boolean
      if (props.task) {
        const initialDraft = initialDraftRef.current ?? taskToDraftSnapshot(props.task)
        const updates: UpdateTaskRequest = {}

        if (agentId !== props.task.agentId) updates.agentId = agentId
        if (name !== initialDraft.name) updates.name = name.trim()
        if (prompt !== initialDraft.prompt) updates.prompt = prompt.trim()
        if (schedule.timeoutMinutes !== initialDraft.schedule.timeoutMinutes) {
          updates.timeoutMinutes = timeoutMinutes
        }
        if (workspaceId !== initialDraft.workspaceId) updates.workspace = workspace
        if (!stringArraysEqual(channelIds, initialDraft.channelIds)) updates.channelIds = channelIds
        if (!scheduleInputsEqual(schedule, initialDraft.schedule)) {
          const nextTrigger = preserveCompatibleTriggerMetadata(props.task.trigger, trigger)
          if (!triggersEqual(nextTrigger, props.task.trigger)) updates.trigger = nextTrigger
        }

        saved = Object.keys(updates).length === 0 || (await props.onUpdate(updates))
      } else {
        saved = await props.onCreate(agentId, {
          name: name.trim(),
          prompt: prompt.trim(),
          trigger,
          workspace,
          timeoutMinutes,
          channelIds: channelIds.length > 0 ? channelIds : undefined
        })
      }
      if (saved) onOpenChange(false)
    } finally {
      setSaving(false)
    }
  }, [agentId, channelIds, name, onOpenChange, prompt, props, schedule, trigger, workspaceId])

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !saving && onOpenChange(nextOpen)}>
      <DialogContent size="xl" closeOnOverlayClick={!saving}>
        <DialogHeader>
          <DialogTitle>
            {t(isEditing ? 'settings.scheduledTasks.editTitle' : 'settings.scheduledTasks.createTitle')}
          </DialogTitle>
          <DialogDescription>
            {t(isEditing ? 'settings.scheduledTasks.editDescription' : 'settings.scheduledTasks.createDescription')}
          </DialogDescription>
        </DialogHeader>
        <Scrollbar className="-m-1 max-h-[60vh] p-1 pr-3">
          <FieldGroup>
            <Field data-invalid={(submitted && !name.trim()) || undefined}>
              <FieldLabel required htmlFor="task-form-name">
                {t('agent.tasks.name.label')}
              </FieldLabel>
              <Input
                id="task-form-name"
                value={name}
                disabled={saving}
                required
                placeholder={t('agent.tasks.name.placeholder')}
                aria-invalid={(submitted && !name.trim()) || undefined}
                onChange={(event) => setName(event.target.value)}
              />
              <FieldError>
                {submitted && !name.trim() ? t('settings.scheduledTasks.validation.name') : undefined}
              </FieldError>
            </Field>

            <FieldGroup data-task-input-context>
              <PromptEditorField
                label={<FieldLabel required>{t('agent.tasks.prompt.label')}</FieldLabel>}
                value={prompt}
                onChange={setPrompt}
                placeholder={t('agent.tasks.prompt.placeholder')}
                error={submitted && !prompt.trim() ? t('settings.scheduledTasks.validation.prompt') : undefined}
                resetPreviewKey={promptPreviewKey}
                minHeight="100px"
                actions={
                  <PromptPolishActions
                    value={prompt}
                    fallbackSource={name}
                    emptyValueSystemPrompt={TASK_PROMPT_GENERATION_SYSTEM_PROMPT}
                    existingValueSystemPrompt={TASK_PROMPT_POLISH_SYSTEM_PROMPT}
                    disabled={saving}
                    onChange={(value) => {
                      setPrompt(value)
                      setPromptPreviewKey((key) => key + 1)
                    }}
                  />
                }
              />
              <RowFlex className="flex-wrap items-center gap-2">
                <AgentSelector
                  value={agentId}
                  onChange={(nextAgentId) => {
                    setAgentId(nextAgentId)
                    setChannelIds([])
                  }}
                  align="start"
                  mountStrategy="lazy-keep"
                  trigger={
                    <Button
                      type="button"
                      variant="outline"
                      disabled={saving}
                      aria-label={t('agent.channels.bindAgent')}
                      aria-invalid={(submitted && !agentId) || undefined}
                      aria-busy={saving || undefined}>
                      <Bot size={14} />
                      <span>{selectedAgent?.name ?? t('agent.channels.selectAgent')}</span>
                      <ChevronDown size={14} />
                    </Button>
                  }
                />
                <WorkspaceSelector
                  value={workspaceId}
                  onChange={setWorkspaceId}
                  disabled={saving}
                  align="start"
                  trigger={
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={saving}
                      aria-label={t('agent.session.display.workdir')}>
                      {isSystemWorkspace ? <CircleSlash size={14} /> : <Folder size={14} />}
                      <span>{workspaceLabel}</span>
                      <ChevronDown size={14} />
                    </Button>
                  }
                />
              </RowFlex>
              <FieldError>
                {submitted && !agentId ? t('settings.scheduledTasks.validation.agent') : undefined}
              </FieldError>
            </FieldGroup>

            <TaskScheduleControls
              value={schedule}
              disabled={saving}
              invalid={submitted && !trigger}
              onChange={setSchedule}
            />

            <TaskChannelSelector
              channels={availableChannels}
              channelIds={channelIds}
              disabled={saving}
              onChange={setChannelIds}
            />
          </FieldGroup>
        </Scrollbar>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button type="button" disabled={saving} loading={saving} aria-busy={saving} onClick={handleSave}>
            {t('agent.tasks.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const TasksSettings: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const navigate = useNavigate()
  const params = useParams({ strict: false })
  const taskId = params.taskId
  const { createTask } = useCreateTask()
  const { updateTask } = useUpdateTask()
  const { deleteTask } = useDeleteTask()
  const { runTask } = useRunTask()

  // Mirror AgentSelector's query exactly so both read one shared SWR cache
  // entry: the selector can list (and create in-place) up to the same server
  // cap, and a page-local list capped lower would miss those agents' tasks.
  const {
    data: agentsData,
    error: agentsError,
    isLoading: agentsLoading
  } = useQuery('/agents', { query: { limit: AGENTS_MAX_LIMIT } })
  const agents: AgentInfo[] = useMemo(
    () => (agentsData?.items ?? []).map((agent) => ({ id: agent.id, name: agent.name })),
    [agentsData]
  )
  const {
    tasks,
    total,
    page,
    pageCount,
    error: tasksError,
    isLoading: tasksLoading,
    hasNext,
    hasPrev,
    nextPage,
    prevPage,
    refetch: refetchTasks
  } = useAllTasks()
  const { task: taskDetails, error: taskError, isLoading: taskLoading } = useTask(taskId ?? null)
  const loading = agentsLoading || tasksLoading || (!!taskId && taskLoading)
  const [createOpen, setCreateOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [agentFilter, setAgentFilter] = useState(ALL_TASKS_FILTER)
  const [statusFilter, setStatusFilter] = useState(ALL_TASKS_FILTER)
  const taskUpdateTailsRef = useRef<Map<string, Promise<boolean>> | null>(null)

  const filteredTasks = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLocaleLowerCase()

    return tasks.filter((task) => {
      if (agentFilter !== ALL_TASKS_FILTER && task.agentId !== agentFilter) return false
      if (statusFilter !== ALL_TASKS_FILTER && task.status !== statusFilter) return false
      if (!normalizedQuery) return true

      const agentName = agents.find((agent) => agent.id === task.agentId)?.name ?? task.agentId
      return [task.name, agentName].some((value) => value.toLocaleLowerCase().includes(normalizedQuery))
    })
  }, [agentFilter, agents, searchQuery, statusFilter, tasks])

  const hasActiveFilters =
    searchQuery.trim().length > 0 || agentFilter !== ALL_TASKS_FILTER || statusFilter !== ALL_TASKS_FILTER

  const clearFilters = useCallback(() => {
    setSearchQuery('')
    setAgentFilter(ALL_TASKS_FILTER)
    setStatusFilter(ALL_TASKS_FILTER)
  }, [])

  useEffect(() => {
    if (agentsError || tasksError || taskError) {
      logger.error('Failed to load tasks settings', (agentsError ?? tasksError ?? taskError) as Error)
      toast.error(t('agent.tasks.error.loadFailed'))
    }
  }, [agentsError, t, taskError, tasksError])

  const getTaskUpdateTails = useCallback(() => {
    taskUpdateTailsRef.current ??= new Map()
    return taskUpdateTailsRef.current
  }, [])

  const enqueueTaskOperation = useCallback(
    (selectedTaskId: string, operation: (previousSucceeded: boolean) => Promise<boolean>): Promise<boolean> => {
      const tails = getTaskUpdateTails()
      const previous = tails.get(selectedTaskId) ?? Promise.resolve(true)
      const current = previous
        .catch(() => false)
        .then(operation)
        .catch(() => false)

      tails.set(selectedTaskId, current)
      void current.then(() => {
        if (tails.get(selectedTaskId) === current) tails.delete(selectedTaskId)
      })
      return current
    },
    [getTaskUpdateTails]
  )

  const handleCreate = useCallback(
    async (agentId: string, request: CreateTaskRequest) => {
      const created = await createTask(agentId, request)
      if (!created) return undefined
      await navigate({ to: '/settings/scheduled-tasks/$taskId', params: { taskId: created.id } })
      return created
    },
    [createTask, navigate]
  )

  const persistTaskUpdate = useCallback(
    async (task: ScheduledTaskEntity, updates: UpdateTaskRequest): Promise<TaskUpdateResult> => {
      const updated = await updateTask(task.agentId, task.id, updates)
      if (!updated) return { succeeded: false, task }
      return { succeeded: true, task: updated }
    },
    [updateTask]
  )

  const getTaskForAction = useCallback(
    (selectedTaskId: string) => {
      if (taskDetails?.id === selectedTaskId) return taskDetails
      return tasks.find((task) => task.id === selectedTaskId)
    },
    [taskDetails, tasks]
  )

  const handleUpdate = useCallback(
    (selectedTaskId: string, updates: UpdateTaskRequest): Promise<TaskUpdateResult | undefined> => {
      const task = getTaskForAction(selectedTaskId)
      if (!task) return Promise.resolve(undefined)

      let updateResult: TaskUpdateResult | undefined
      return enqueueTaskOperation(selectedTaskId, async (previousSucceeded) => {
        updateResult = await persistTaskUpdate(task, updates)
        return previousSucceeded && updateResult.succeeded
      }).then(() => updateResult)
    },
    [enqueueTaskOperation, getTaskForAction, persistTaskUpdate]
  )

  const handleDelete = useCallback(
    async (selectedTaskId: string) => {
      const task = getTaskForAction(selectedTaskId)
      if (!task) return
      const deleted = await deleteTask(task.agentId, selectedTaskId)
      if (!deleted) return
      await navigate({ to: '/settings/scheduled-tasks' })
    },
    [deleteTask, getTaskForAction, navigate]
  )

  const handleRun = useCallback(
    async (selectedTaskId: string) => {
      await enqueueTaskOperation(selectedTaskId, async (previousSucceeded) => {
        if (!previousSucceeded) return false
        const ran = await runTask(selectedTaskId)
        if (!ran) return false
        await refetchTasks()
        return true
      })
    },
    [enqueueTaskOperation, refetchTasks, runTask]
  )

  const handleToggleStatus = useCallback(
    async (selectedTaskId: string, newStatus: string) => {
      const task = getTaskForAction(selectedTaskId)
      if (!task) return
      await enqueueTaskOperation(selectedTaskId, async (previousSucceeded) => {
        const enabled = newStatus === 'active'
        if (enabled && !previousSucceeded) return false
        const toggleResult = await persistTaskUpdate(task, { enabled })
        return previousSucceeded && toggleResult.succeeded
      })
    },
    [enqueueTaskOperation, getTaskForAction, persistTaskUpdate]
  )

  if (loading) {
    return (
      <Center className="flex-1">
        <Spinner text={t('common.loading')} />
      </Center>
    )
  }

  const selectedTask = taskId ? taskDetails : undefined

  if (taskId) {
    if (!selectedTask) {
      return (
        <SettingsContentColumn theme={theme}>
          <EmptyState
            preset="no-result"
            title={t('settings.scheduledTasks.notFoundTitle')}
            description={t('settings.scheduledTasks.notFoundDescription')}
            actionLabel={t('common.back')}
            onAction={() => void navigate({ to: '/settings/scheduled-tasks' })}
          />
        </SettingsContentColumn>
      )
    }

    return (
      <TaskDetail
        key={selectedTask.id}
        task={selectedTask}
        agents={agents}
        onBack={() => void navigate({ to: '/settings/scheduled-tasks' })}
        onUpdate={handleUpdate}
        onDelete={handleDelete}
        onRun={handleRun}
        onToggleStatus={handleToggleStatus}
      />
    )
  }

  return (
    <SettingsContentColumn theme={theme} innerClassName="flex min-h-full flex-col">
      <SettingGroup theme={theme} className="flex flex-1 flex-col">
        <SettingTitle>
          <span>{t('settings.scheduledTasks.title')}</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button">
                <Plus size={16} />
                {t('settings.scheduledTasks.newTask')}
                <ChevronDown size={14} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                <DropdownMenuItem disabled={agents.length === 0} onSelect={() => setCreateOpen(true)}>
                  <PencilLine />
                  {t('settings.scheduledTasks.manualCreate')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openRoute('/app/agents')}>
                  <Bot />
                  {t('settings.scheduledTasks.agentCreate')}
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </SettingTitle>
        <SettingDescription>{t('settings.scheduledTasks.description')}</SettingDescription>
        <SettingDivider />

        {tasks.length === 0 ? (
          <EmptyState
            preset={agents.length === 0 ? 'no-agent' : 'no-result'}
            icon={agents.length === 0 ? undefined : CalendarClock}
            title={
              agents.length === 0
                ? t('settings.scheduledTasks.noAgentsTitle')
                : t('settings.scheduledTasks.noTasksTitle')
            }
            description={
              agents.length === 0 ? t('settings.scheduledTasks.noAgents') : t('settings.scheduledTasks.noTasks')
            }
            actionLabel={
              agents.length === 0 ? t('settings.scheduledTasks.agentCreate') : t('settings.scheduledTasks.manualCreate')
            }
            onAction={() => {
              if (agents.length === 0) openRoute('/app/agents')
              else setCreateOpen(true)
            }}
          />
        ) : (
          <>
            <RowFlex className="flex-wrap items-center gap-2 py-1">
              <div className="min-w-56 flex-1">
                <SearchInput
                  aria-label={t('settings.scheduledTasks.search')}
                  placeholder={t('settings.scheduledTasks.searchPlaceholder')}
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.currentTarget.value)}
                  onClear={() => setSearchQuery('')}
                  clearLabel={t('common.clear')}
                />
              </div>
              <Select value={agentFilter} onValueChange={setAgentFilter}>
                <SelectTrigger aria-label={t('settings.scheduledTasks.filterAgent')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value={ALL_TASKS_FILTER}>{t('settings.scheduledTasks.allAgents')}</SelectItem>
                    {agents.map((agent) => (
                      <SelectItem key={agent.id} value={agent.id}>
                        {agent.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger aria-label={t('settings.scheduledTasks.filterStatus')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value={ALL_TASKS_FILTER}>{t('settings.scheduledTasks.allStatuses')}</SelectItem>
                    <SelectItem value="active">{t('agent.tasks.status.active')}</SelectItem>
                    <SelectItem value="paused">{t('agent.tasks.status.paused')}</SelectItem>
                    <SelectItem value="completed">{t('agent.tasks.status.completed')}</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </RowFlex>

            {filteredTasks.length === 0 && hasActiveFilters ? (
              <EmptyState
                preset="no-result"
                title={t('settings.scheduledTasks.noMatchesTitle')}
                description={t('settings.scheduledTasks.noMatches')}
                actionLabel={t('settings.scheduledTasks.clearFilters')}
                onAction={clearFilters}
              />
            ) : (
              <ItemGroup>
                {filteredTasks.map((task, index) => (
                  <Fragment key={task.id}>
                    {index > 0 && <ItemSeparator />}
                    <Item asChild size="sm">
                      <Link to="/settings/scheduled-tasks/$taskId" params={{ taskId: task.id }}>
                        <ItemContent>
                          <ItemTitle>{task.name}</ItemTitle>
                          <ItemDescription>
                            {agents.find((agent) => agent.id === task.agentId)?.name ?? task.agentId} ·{' '}
                            {getTriggerSummary(task.trigger, t)}
                          </ItemDescription>
                        </ItemContent>
                        <ItemActions>
                          <Badge variant="outline">
                            {getScheduleKindLabel(triggerToFormState(task.trigger).kind, t)}
                          </Badge>
                          <Badge variant="secondary">{getTaskStatusLabel(task.status, t)}</Badge>
                          <ChevronRight size={16} />
                        </ItemActions>
                      </Link>
                    </Item>
                  </Fragment>
                ))}
              </ItemGroup>
            )}
            {pageCount > 1 && (
              <Pagination aria-label={t('settings.scheduledTasks.paginationLabel')} className="pt-4">
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      href="#"
                      aria-disabled={!hasPrev}
                      aria-label={t('common.previous')}
                      tabIndex={hasPrev ? undefined : -1}
                      className={hasPrev ? undefined : 'pointer-events-none opacity-40'}
                      onClick={(event) => {
                        event.preventDefault()
                        prevPage()
                      }}>
                      {t('common.previous')}
                    </PaginationPrevious>
                  </PaginationItem>
                  <PaginationItem>
                    <SettingDescription className="mt-0 px-2 tabular-nums">
                      {t('settings.scheduledTasks.paginationStatus', { page, pageCount, total })}
                    </SettingDescription>
                  </PaginationItem>
                  <PaginationItem>
                    <PaginationNext
                      href="#"
                      aria-disabled={!hasNext}
                      aria-label={t('common.next')}
                      tabIndex={hasNext ? undefined : -1}
                      className={hasNext ? undefined : 'pointer-events-none opacity-40'}
                      onClick={(event) => {
                        event.preventDefault()
                        nextPage()
                      }}>
                      {t('common.next')}
                    </PaginationNext>
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            )}
          </>
        )}
      </SettingGroup>

      <TaskFormDialog
        open={createOpen}
        agents={agents}
        onOpenChange={setCreateOpen}
        onCreate={async (agentId, request) => Boolean(await handleCreate(agentId, request))}
      />
    </SettingsContentColumn>
  )
}

export default TasksSettings
