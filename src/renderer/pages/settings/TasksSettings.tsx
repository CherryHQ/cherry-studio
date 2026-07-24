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
  ItemMedia,
  ItemSeparator,
  ItemTitle,
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
  Textarea,
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
import { dataApiService } from '@renderer/data/DataApiService'
import { useQuery } from '@renderer/data/hooks/useDataApi'
import { useChannels } from '@renderer/hooks/agent/useChannels'
import { useCreateTask, useDeleteTask, useRunTask, useTaskLogs, useUpdateTask } from '@renderer/hooks/agent/useTasks'
import { useConversationNavigation } from '@renderer/hooks/useConversationNavigation'
import { useTheme } from '@renderer/hooks/useTheme'
import { openRoute } from '@renderer/services/mainWindowNavigation'
import { toast } from '@renderer/services/toast'
import { RESOURCE_PROMPT_POLISH_SYSTEM_PROMPT } from '@renderer/utils/resourceCatalog'
import { AGENT_PROMPT } from '@shared/ai/prompts'
import { AGENT_WORKSPACE_TYPE } from '@shared/data/api/schemas/agentWorkspaces'
import type { Trigger } from '@shared/data/api/schemas/jobs'
import type {
  AgentEntity,
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
  ChevronDown,
  ChevronRight,
  CircleSlash,
  ExternalLink,
  Folder,
  Maximize2,
  MoreHorizontal,
  PencilLine,
  Play,
  Plus,
  Trash2
} from 'lucide-react'
import { type FC, Fragment, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('TasksSettings')

type AgentInfo = { id: string; name: string }
type ChannelInfo = { id: string; agentId?: string | null; name: string; isActive?: boolean; hasActiveChatIds?: boolean }

export type ScheduleKind = 'hourly' | 'daily' | 'weekdays' | 'weekly' | 'interval' | 'once' | 'cron'
export type ScheduleFormState = {
  kind: ScheduleKind
  value: string
  weekday: string
  timeoutMinutes: string
}

type ScheduleCommitPatch = {
  trigger?: Trigger
  timeoutMinutes?: number | null
}
type TaskDraftField = 'name' | 'prompt' | 'schedule' | 'channelIds' | 'workspace'
type TaskDraftVersions = Record<TaskDraftField, number>
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

function createTaskDraftVersions(): TaskDraftVersions {
  return {
    name: 0,
    prompt: 0,
    schedule: 0,
    channelIds: 0,
    workspace: 0
  }
}

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
      timeoutMinutes: task.timeoutMinutes?.toString() ?? ''
    },
    channelIds: task.channelIds ?? [],
    workspaceId: task.workspace.type === AGENT_WORKSPACE_TYPE.USER ? task.workspace.workspaceId : null
  }
}

function draftFieldsForUpdate(updates: UpdateTaskRequest): TaskDraftField[] {
  const fields: TaskDraftField[] = []
  if ('name' in updates) fields.push('name')
  if ('prompt' in updates) fields.push('prompt')
  if ('trigger' in updates || 'timeoutMinutes' in updates) fields.push('schedule')
  if ('channelIds' in updates) fields.push('channelIds')
  if ('workspace' in updates) fields.push('workspace')
  return fields
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

const TaskScheduleControls: FC<{
  value: ScheduleFormState
  disabled?: boolean
  invalid?: boolean
  onChange: (value: ScheduleFormState) => void
  onCommit?: (patch: ScheduleCommitPatch) => void
}> = ({ value, disabled, invalid, onChange, onCommit }) => {
  const { t } = useTranslation()
  const id = useId()

  const commitTrigger = (schedule = value) => {
    const trigger = formStateToTrigger(schedule)
    if (trigger) onCommit?.({ trigger })
  }

  const updateKind = (kind: ScheduleKind) => {
    const next = scheduleForKind(kind, value)
    onChange(next)
    commitTrigger(next)
  }

  const updateValue = (nextValue: string, commit = false) => {
    const next = { ...value, value: nextValue }
    onChange(next)
    if (commit) commitTrigger(next)
  }

  const commitTimeoutMinutes = () => {
    if (!onCommit) return
    if (!value.timeoutMinutes.trim()) {
      onCommit({ timeoutMinutes: null })
      return
    }
    const minutes = Number(value.timeoutMinutes)
    if (Number.isInteger(minutes) && minutes > 0) onCommit({ timeoutMinutes: minutes })
  }

  const frequencyControl =
    value.kind === 'daily' || value.kind === 'weekdays' ? (
      <Input
        className="w-40"
        type="time"
        value={value.value}
        disabled={disabled}
        aria-label={t('agent.tasks.schedule.time')}
        onChange={(event) => updateValue(event.target.value)}
        onBlur={() => commitTrigger()}
      />
    ) : value.kind === 'weekly' ? (
      <>
        <Select
          value={value.weekday}
          disabled={disabled}
          onValueChange={(weekday) => {
            const next = { ...value, weekday }
            onChange(next)
            commitTrigger(next)
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
        <Input
          className="w-40"
          type="time"
          value={value.value}
          disabled={disabled}
          aria-label={t('agent.tasks.schedule.time')}
          onChange={(event) => updateValue(event.target.value)}
          onBlur={() => commitTrigger()}
        />
      </>
    ) : value.kind === 'interval' ? (
      <InputGroup className="w-40" data-disabled={disabled || undefined}>
        <InputGroupInput
          type="number"
          min={1}
          value={value.value}
          placeholder={t('agent.tasks.intervalPlaceholder')}
          disabled={disabled}
          aria-label={t('agent.tasks.schedule.intervalMinutes')}
          aria-invalid={invalid || undefined}
          onChange={(event) => updateValue(event.target.value)}
          onBlur={() => commitTrigger()}
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
          if (date) updateValue(date.toISOString(), true)
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
            type="number"
            min={1}
            value={value.timeoutMinutes}
            placeholder={t('agent.tasks.timeout.placeholder')}
            disabled={disabled}
            onChange={(event) => onChange({ ...value, timeoutMinutes: event.target.value })}
            onBlur={commitTimeoutMinutes}
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
              <span>{text}</span>
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
  channels: ChannelInfo[]
  onBack: () => void
  onUpdate: (taskId: string, updates: UpdateTaskRequest) => Promise<TaskUpdateResult | undefined>
  onDelete: (taskId: string) => Promise<void>
  onRun: (taskId: string) => Promise<void>
  onToggleStatus: (taskId: string, newStatus: string) => Promise<void>
}> = ({ task, agents, channels, onBack, onUpdate, onDelete, onRun, onToggleStatus }) => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const isCompleted = task.status === 'completed'
  const agentName = agents.find((agent) => agent.id === task.agentId)?.name ?? task.agentId
  const taskChannels = useMemo(
    () => channels.filter((channel) => channel.agentId === task.agentId),
    [channels, task.agentId]
  )

  const initialDraft = taskToDraftSnapshot(task)
  const [name, setName] = useState(initialDraft.name)
  const [prompt, setPrompt] = useState(initialDraft.prompt)
  const [promptModalOpen, setPromptModalOpen] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [schedule, setSchedule] = useState<ScheduleFormState>(initialDraft.schedule)
  const [channelIds, setChannelIds] = useState<string[]>(initialDraft.channelIds)
  const [workspaceId, setWorkspaceId] = useState<string | null>(initialDraft.workspaceId)
  const draftVersionsRef = useRef<TaskDraftVersions>(createTaskDraftVersions())
  const submittedDraftVersionsRef = useRef<TaskDraftVersions>(createTaskDraftVersions())
  const appliedDraftVersionsRef = useRef<TaskDraftVersions>(createTaskDraftVersions())
  const { data: workspaces } = useQuery('/agent-workspaces')

  const selectedChannelIds = useMemo(() => {
    const ownedChannelIds = new Set(taskChannels.map((channel) => channel.id))
    return channelIds.filter((channelId) => ownedChannelIds.has(channelId))
  }, [channelIds, taskChannels])
  const isSystemWorkspace = workspaceId === null
  const workspaceLabel = isSystemWorkspace
    ? t('agent.session.workspace_selector.no_project')
    : (workspaces?.find((workspace) => workspace.id === workspaceId)?.name ?? workspaceId)

  const markDraftChanged = useCallback((field: TaskDraftField) => {
    draftVersionsRef.current[field] += 1
  }, [])

  const applyPersistedTaskFields = useCallback((persistedTask: ScheduledTaskEntity, fields: TaskDraftField[]) => {
    const next = taskToDraftSnapshot(persistedTask)
    const selectedFields = new Set(fields)
    if (selectedFields.has('name')) setName(next.name)
    if (selectedFields.has('prompt')) setPrompt(next.prompt)
    if (selectedFields.has('schedule')) setSchedule(next.schedule)
    if (selectedFields.has('channelIds')) setChannelIds(next.channelIds)
    if (selectedFields.has('workspace')) setWorkspaceId(next.workspaceId)
  }, [])

  useEffect(() => {
    const next = taskToDraftSnapshot(task)
    const draftVersions = draftVersionsRef.current
    const appliedVersions = appliedDraftVersionsRef.current

    setName((current) => (draftVersions.name === appliedVersions.name ? next.name : current))
    setPrompt((current) => (draftVersions.prompt === appliedVersions.prompt ? next.prompt : current))
    setSchedule((current) => (draftVersions.schedule === appliedVersions.schedule ? next.schedule : current))
    setChannelIds((current) => (draftVersions.channelIds === appliedVersions.channelIds ? next.channelIds : current))
    setWorkspaceId((current) => (draftVersions.workspace === appliedVersions.workspace ? next.workspaceId : current))
  }, [task])

  const saveField = useCallback(
    (updates: UpdateTaskRequest) => {
      const fields = draftFieldsForUpdate(updates)
      const hasUnsubmittedDraft = fields.some(
        (field) => draftVersionsRef.current[field] !== submittedDraftVersionsRef.current[field]
      )
      if (!hasUnsubmittedDraft) return

      const submittedVersions = fields.map((field) => [field, draftVersionsRef.current[field]] as const)
      for (const [field, version] of submittedVersions) {
        submittedDraftVersionsRef.current[field] = version
      }

      void onUpdate(task.id, updates).then((result) => {
        if (!result) return
        const applicableFields = submittedVersions
          .filter(([field, version]) => draftVersionsRef.current[field] === version)
          .map(([field, version]) => {
            appliedDraftVersionsRef.current[field] = version
            return field
          })
        applyPersistedTaskFields(result.task, applicableFields)
      })
    },
    [applyPersistedTaskFields, onUpdate, task.id]
  )

  const handlePromptModalOpenChange = useCallback(
    (open: boolean) => {
      if (!open && prompt.trim()) saveField({ prompt: prompt.trim() })
      setPromptModalOpen(open)
    },
    [prompt, saveField]
  )

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

  return (
    <SettingsContentColumn theme={theme}>
      <SettingGroup theme={theme}>
        <SettingTitle>
          <RowFlex className="items-center gap-2">
            <Button type="button" size="icon-lg" variant="ghost" aria-label={t('common.back')} onClick={onBack}>
              <ArrowLeft size={18} />
            </Button>
            <span>{task.name}</span>
          </RowFlex>
          <RowFlex className="items-center gap-2">
            <Badge variant="secondary">{getTaskStatusLabel(task.status, t)}</Badge>
            {!isCompleted && (
              <Switch
                size="sm"
                checked={task.status === 'active'}
                onCheckedChange={(checked) => onToggleStatus(task.id, checked ? 'active' : 'paused')}
                aria-label={t('agent.tasks.status.active')}
                title={task.status === 'active' ? t('agent.tasks.pause') : t('agent.tasks.resume')}
              />
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" size="icon-sm" variant="ghost" aria-label={t('common.more')}>
                  <MoreHorizontal size={14} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuGroup>
                  {!isCompleted && (
                    <DropdownMenuItem onSelect={() => void onRun(task.id)}>
                      <Play />
                      {t('agent.tasks.run')}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem variant="destructive" onSelect={() => setDeleteConfirmOpen(true)}>
                    <Trash2 />
                    {t('agent.tasks.delete.label')}
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </RowFlex>
        </SettingTitle>
        <SettingDivider />
        <ItemGroup>
          <Item size="sm">
            <ItemMedia>
              <Bot size={16} />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>{agentName}</ItemTitle>
              <ItemDescription>{getTriggerSummary(task.trigger, t)}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <Badge variant="outline">{getScheduleKindLabel(triggerToFormState(task.trigger).kind, t)}</Badge>
            </ItemActions>
          </Item>
          {(task.lastRun || task.nextRun) && <ItemSeparator />}
          {(task.lastRun || task.nextRun) && (
            <Item size="sm">
              <ItemContent>
                {task.lastRun && (
                  <ItemDescription>
                    {t('agent.tasks.lastRun')}: {formatDateTime(task.lastRun)}
                  </ItemDescription>
                )}
                {task.nextRun && (
                  <ItemDescription>
                    {t('agent.tasks.nextRun')}: {formatDateTime(task.nextRun)}
                  </ItemDescription>
                )}
              </ItemContent>
            </Item>
          )}
        </ItemGroup>
      </SettingGroup>

      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.general.title')}</SettingTitle>
        <SettingDivider />
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="scheduled-task-name">{t('agent.tasks.name.label')}</FieldLabel>
            <Input
              id="scheduled-task-name"
              value={name}
              onChange={(event) => {
                markDraftChanged('name')
                setName(event.target.value)
              }}
              onBlur={() => name.trim() && saveField({ name: name.trim() })}
              disabled={isCompleted}
            />
          </Field>

          <Field>
            <RowFlex className="items-center justify-between">
              <FieldLabel htmlFor="scheduled-task-prompt">{t('agent.tasks.prompt.label')}</FieldLabel>
              {!isCompleted && (
                <Tooltip title={t('agent.tasks.prompt.expand')}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('agent.tasks.prompt.expand')}
                    onClick={() => setPromptModalOpen(true)}>
                    <Maximize2 size={13} />
                  </Button>
                </Tooltip>
              )}
            </RowFlex>
            <Textarea.Input
              id="scheduled-task-prompt"
              value={prompt}
              onChange={(event) => {
                markDraftChanged('prompt')
                setPrompt(event.target.value)
              }}
              onBlur={() => prompt.trim() && saveField({ prompt: prompt.trim() })}
              disabled={isCompleted}
              rows={4}
            />
          </Field>

          <TaskScheduleControls
            value={schedule}
            disabled={isCompleted}
            onChange={(nextSchedule) => {
              markDraftChanged('schedule')
              setSchedule(nextSchedule)
            }}
            onCommit={saveField}
          />

          <TaskChannelSelector
            channels={taskChannels}
            channelIds={selectedChannelIds}
            disabled={isCompleted}
            onChange={(nextChannelIds) => {
              markDraftChanged('channelIds')
              setChannelIds(nextChannelIds)
              saveField({ channelIds: nextChannelIds })
            }}
          />

          <Field orientation="horizontal">
            <FieldLabel>{t('agent.session.display.workdir')}</FieldLabel>
            <WorkspaceSelector
              value={workspaceId}
              onChange={(nextWorkspaceId) => {
                markDraftChanged('workspace')
                setWorkspaceId(nextWorkspaceId)
                saveField({
                  workspace:
                    nextWorkspaceId === null
                      ? { type: AGENT_WORKSPACE_TYPE.SYSTEM }
                      : { type: AGENT_WORKSPACE_TYPE.USER, workspaceId: nextWorkspaceId }
                })
              }}
              disabled={isCompleted}
              align="end"
              trigger={
                <Button type="button" variant="outline" size="sm" disabled={isCompleted}>
                  {isSystemWorkspace ? <CircleSlash size={14} /> : <Folder size={14} />}
                  <span>{workspaceLabel}</span>
                  <ChevronDown size={14} />
                </Button>
              }
            />
          </Field>
        </FieldGroup>
      </SettingGroup>

      <SettingGroup theme={theme}>
        <SettingTitle>{t('agent.tasks.logs.label')}</SettingTitle>
        <SettingDivider />
        <TaskLogsInline taskId={task.id} agentId={task.agentId} />
      </SettingGroup>

      <Dialog open={promptModalOpen} onOpenChange={handlePromptModalOpenChange}>
        <DialogContent size="xl" closeOnOverlayClick={false}>
          <DialogHeader>
            <DialogTitle>{t('agent.tasks.prompt.label')}</DialogTitle>
            <DialogDescription>{task.name}</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="scheduled-task-prompt-dialog">{t('agent.tasks.prompt.label')}</FieldLabel>
            <Textarea.Input
              id="scheduled-task-prompt-dialog"
              value={prompt}
              onChange={(event) => {
                markDraftChanged('prompt')
                setPrompt(event.target.value)
              }}
              disabled={isCompleted}
              rows={14}
            />
          </Field>
        </DialogContent>
      </Dialog>

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

const CreateTaskDialog: FC<{
  open: boolean
  agents: AgentInfo[]
  channels: ChannelInfo[]
  onOpenChange: (open: boolean) => void
  onCreate: (agentId: string, request: CreateTaskRequest) => Promise<ScheduledTaskEntity | undefined>
}> = ({ open, agents, channels, onOpenChange, onCreate }) => {
  const { t } = useTranslation()
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
  const { data: workspaces } = useQuery('/agent-workspaces')

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setAgentId(agents.length === 1 ? agents[0].id : null)
      setName('')
      setPrompt('')
      setSchedule(DEFAULT_SCHEDULE)
      setChannelIds([])
      setWorkspaceId(null)
      setSaving(false)
      setSubmitted(false)
      setPromptPreviewKey((key) => key + 1)
    }
    wasOpenRef.current = open
  }, [agents, open])

  const availableChannels = useMemo(
    () => (agentId ? channels.filter((channel) => channel.agentId === agentId) : []),
    [agentId, channels]
  )

  useEffect(() => {
    setChannelIds((current) =>
      current.filter((channelId) => availableChannels.some((channel) => channel.id === channelId))
    )
  }, [availableChannels])

  const isSystemWorkspace = workspaceId === null
  const selectedAgent = agents.find((agent) => agent.id === agentId)
  const workspaceLabel = isSystemWorkspace
    ? t('agent.session.workspace_selector.no_project')
    : (workspaces?.find((workspace) => workspace.id === workspaceId)?.name ?? workspaceId)
  const trigger = formStateToTrigger(schedule)

  const handleCreate = useCallback(async () => {
    setSubmitted(true)
    if (!agentId || !name.trim() || !prompt.trim() || !trigger) return

    setSaving(true)
    try {
      const timeout = Number(schedule.timeoutMinutes)
      const created = await onCreate(agentId, {
        name: name.trim(),
        prompt: prompt.trim(),
        trigger,
        workspace:
          workspaceId === null
            ? { type: AGENT_WORKSPACE_TYPE.SYSTEM }
            : { type: AGENT_WORKSPACE_TYPE.USER, workspaceId },
        timeoutMinutes: Number.isInteger(timeout) && timeout > 0 ? timeout : undefined,
        channelIds: channelIds.length > 0 ? channelIds : undefined
      })
      if (created) onOpenChange(false)
    } finally {
      setSaving(false)
    }
  }, [agentId, channelIds, name, onCreate, onOpenChange, prompt, schedule.timeoutMinutes, trigger, workspaceId])

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !saving && onOpenChange(nextOpen)}>
      <DialogContent size="xl" closeOnOverlayClick={!saving}>
        <DialogHeader>
          <DialogTitle>{t('settings.scheduledTasks.createTitle')}</DialogTitle>
          <DialogDescription>{t('settings.scheduledTasks.createDescription')}</DialogDescription>
        </DialogHeader>
        <Scrollbar className="max-h-[60vh] pr-2">
          <FieldGroup>
            <Field data-invalid={(submitted && !name.trim()) || undefined}>
              <FieldLabel required htmlFor="create-task-name">
                {t('agent.tasks.name.label')}
              </FieldLabel>
              <Input
                id="create-task-name"
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
                minHeight="160px"
                actions={
                  <PromptPolishActions
                    value={prompt}
                    fallbackSource={name}
                    emptyValueSystemPrompt={AGENT_PROMPT}
                    existingValueSystemPrompt={RESOURCE_PROMPT_POLISH_SYSTEM_PROMPT}
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
                  onChange={setAgentId}
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
          <Button type="button" disabled={saving} loading={saving} aria-busy={saving} onClick={handleCreate}>
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
  const { channels: rawChannels = [] } = useChannels()
  const { createTask } = useCreateTask()
  const { updateTask } = useUpdateTask()
  const { deleteTask } = useDeleteTask()
  const { runTask } = useRunTask()

  const [agents, setAgents] = useState<AgentInfo[]>([])
  const [tasks, setTasks] = useState<ScheduledTaskEntity[]>([])
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const taskUpdateTailsRef = useRef<Map<string, Promise<boolean>> | null>(null)
  const persistedTasksRef = useRef(new Map<string, ScheduledTaskEntity>())

  const channels: ChannelInfo[] = useMemo(
    () =>
      rawChannels.map((channel: any) => ({
        id: channel.id,
        agentId: channel.agent_id ?? channel.agentId ?? null,
        name: channel.name || channel.type,
        isActive: channel.is_active === true || channel.isActive === true,
        hasActiveChatIds:
          ((channel.config?.allowed_chat_ids as string[]) ?? []).length > 0 ||
          ((channel.config?.allowed_channel_ids as string[]) ?? []).length > 0 ||
          ((channel.active_chat_ids ?? channel.activeChatIds ?? []) as string[]).length > 0
      })),
    [rawChannels]
  )

  const loadData = useCallback(async () => {
    try {
      const agentsResult = await dataApiService.get('/agents', { query: { limit: 100 } })
      const agentList = (agentsResult as any).items ?? []
      const tasksPerAgent = await Promise.all(
        agentList.map(async (agent: AgentEntity) => {
          const result = await dataApiService.get(`/agents/${agent.id}/tasks` as never, {
            query: { limit: 200 }
          })
          return (result as any).items ?? []
        })
      )
      const loadedTasks = tasksPerAgent.flat() as ScheduledTaskEntity[]
      persistedTasksRef.current = new Map(loadedTasks.map((task) => [task.id, task]))
      setTasks(loadedTasks)
      setAgents(agentList.map((agent: AgentEntity) => ({ id: agent.id, name: agent.name ?? agent.id })))
    } catch (error) {
      logger.error('Failed to load tasks settings', error as Error)
      toast.error(t('agent.tasks.error.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [t])

  const refreshTask = useCallback(
    async (agentId: string, selectedTaskId: string) => {
      try {
        const refreshed = (await dataApiService.get(
          `/agents/${agentId}/tasks/${selectedTaskId}` as never
        )) as ScheduledTaskEntity
        persistedTasksRef.current.set(selectedTaskId, refreshed)
        setTasks((currentTasks) =>
          currentTasks.map((currentTask) => (currentTask.id === selectedTaskId ? refreshed : currentTask))
        )
      } catch (error) {
        logger.error('Failed to refresh scheduled task', error as Error)
        toast.error(t('agent.tasks.error.loadFailed'))
      }
    },
    [t]
  )

  useEffect(() => {
    void loadData()
  }, [loadData])

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
      await loadData()
      await navigate({ to: '/settings/scheduled-tasks/$taskId', params: { taskId: created.id } })
      return created
    },
    [createTask, loadData, navigate]
  )

  const persistTaskUpdate = useCallback(
    async (task: ScheduledTaskEntity, updates: UpdateTaskRequest): Promise<TaskUpdateResult> => {
      const updated = await updateTask(task.agentId, task.id, updates)
      if (!updated) {
        return { succeeded: false, task: persistedTasksRef.current.get(task.id) ?? task }
      }
      persistedTasksRef.current.set(task.id, updated)
      setTasks((currentTasks) =>
        currentTasks.map((currentTask) => (currentTask.id === task.id ? updated : currentTask))
      )
      return { succeeded: true, task: updated }
    },
    [updateTask]
  )

  const handleUpdate = useCallback(
    (selectedTaskId: string, updates: UpdateTaskRequest): Promise<TaskUpdateResult | undefined> => {
      const task = tasks.find((currentTask) => currentTask.id === selectedTaskId)
      if (!task) return Promise.resolve(undefined)

      let updateResult: TaskUpdateResult | undefined
      return enqueueTaskOperation(selectedTaskId, async (previousSucceeded) => {
        updateResult = await persistTaskUpdate(task, updates)
        return previousSucceeded && updateResult.succeeded
      }).then(() => updateResult)
    },
    [enqueueTaskOperation, persistTaskUpdate, tasks]
  )

  const handleDelete = useCallback(
    async (selectedTaskId: string) => {
      const task = tasks.find((currentTask) => currentTask.id === selectedTaskId)
      if (!task) return
      const deleted = await deleteTask(task.agentId, selectedTaskId)
      if (!deleted) return

      persistedTasksRef.current.delete(selectedTaskId)
      setTasks((currentTasks) => currentTasks.filter((currentTask) => currentTask.id !== selectedTaskId))
      await navigate({ to: '/settings/scheduled-tasks' })
      void loadData()
    },
    [deleteTask, loadData, navigate, tasks]
  )

  const handleRun = useCallback(
    async (selectedTaskId: string) => {
      const task = tasks.find((currentTask) => currentTask.id === selectedTaskId)
      if (!task) return
      await enqueueTaskOperation(selectedTaskId, async (previousSucceeded) => {
        if (!previousSucceeded) return false
        const ran = await runTask(selectedTaskId)
        if (!ran) return false
        await refreshTask(task.agentId, selectedTaskId)
        return true
      })
    },
    [enqueueTaskOperation, refreshTask, runTask, tasks]
  )

  const handleToggleStatus = useCallback(
    async (selectedTaskId: string, newStatus: string) => {
      const task = tasks.find((currentTask) => currentTask.id === selectedTaskId)
      if (!task) return
      await enqueueTaskOperation(selectedTaskId, async (previousSucceeded) => {
        const enabled = newStatus === 'active'
        if (enabled && !previousSucceeded) return false
        const toggleResult = await persistTaskUpdate(task, { enabled })
        return previousSucceeded && toggleResult.succeeded
      })
    },
    [enqueueTaskOperation, persistTaskUpdate, tasks]
  )

  if (loading) {
    return (
      <Center className="flex-1">
        <Spinner text={t('common.loading')} />
      </Center>
    )
  }

  const selectedTask = taskId ? tasks.find((task) => task.id === taskId) : undefined

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
        channels={channels}
        onBack={() => void navigate({ to: '/settings/scheduled-tasks' })}
        onUpdate={handleUpdate}
        onDelete={handleDelete}
        onRun={handleRun}
        onToggleStatus={handleToggleStatus}
      />
    )
  }

  return (
    <SettingsContentColumn theme={theme}>
      <SettingGroup theme={theme}>
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
          <ItemGroup>
            {tasks.map((task, index) => (
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
                      <Badge variant="outline">{getScheduleKindLabel(triggerToFormState(task.trigger).kind, t)}</Badge>
                      <Badge variant="secondary">{getTaskStatusLabel(task.status, t)}</Badge>
                      <ChevronRight size={16} />
                    </ItemActions>
                  </Link>
                </Item>
              </Fragment>
            ))}
          </ItemGroup>
        )}
      </SettingGroup>

      <CreateTaskDialog
        open={createOpen}
        agents={agents}
        channels={channels}
        onOpenChange={setCreateOpen}
        onCreate={handleCreate}
      />
    </SettingsContentColumn>
  )
}

export default TasksSettings
