import { Cron } from 'croner'
import type { TFunction } from 'i18next'
import { Bot, ChevronDown, CircleSlash, Folder } from 'lucide-react'
import { type FC, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Alert,
  Button,
  Combobox,
  DateTimePicker,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
  ItemDescription,
  RowFlex,
  Scrollbar,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch
} from '@cherrystudio/ui'
import PromptEditorField from '@renderer/components/PromptEditorField'
import { PromptPolishActions } from '@renderer/components/resourceCatalog/dialogs/components/PromptPolishActions'
import { AgentSelector, WorkspaceSelector } from '@renderer/components/resourceCatalog/selectors'
import { useDataChange, useQuery } from '@renderer/data/hooks/useDataApi'
import { useChannels } from '@renderer/hooks/agent/useChannels'
import { cn } from '@renderer/utils/style'
import type { AgentChannelEntity } from '@shared/data/api/schemas/agentChannels'
import { AGENT_WORKSPACE_TYPE } from '@shared/data/api/schemas/agentWorkspaces'
import type { Trigger } from '@shared/data/api/schemas/jobs'
import type { ScheduledTaskEntity } from '@shared/data/types/agent'
import type { AgentTaskForm, AgentTaskPatch } from '@shared/ipc/schemas/ai'

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

export type AgentInfo = { id: string; name: string }
type ChannelInfo = { id: string; agentId?: string | null; name: string; isActive?: boolean; hasActiveChatIds?: boolean }

export function toChannelInfo(channel: AgentChannelEntity): ChannelInfo {
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
  reuseSession: boolean
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

// Canonical value for the time presets: a sorted, deduped 'HH:MM,HH:MM…' list
// sharing one minute — per-entry minutes would cross-product into extra cron firings.
const parseTimes = (value: string): { hours: string[]; minute: string } | null => {
  const matches = value.split(',').map((part) => /^(\d{1,2}):(\d{2})$/.exec(part.trim()))
  if (matches.some((match) => match === null)) return null

  const minute = matches[0]![2]
  if (Number(minute) > 59 || matches.some((match) => match![2] !== minute)) return null

  const hours = matches.map((match) => Number(match![1]))
  if (hours.some((hour) => hour > 23)) return null

  const uniqueSorted = [...new Set(hours)].sort((a, b) => a - b)
  return { hours: uniqueSorted.map((hour) => String(hour).padStart(2, '0')), minute }
}

const formatTimes = (hours: string[], minute: string) =>
  [...new Set(hours)]
    .sort()
    .map((hour) => `${hour}:${minute}`)
    .join(',')

function isValidCronExpression(value: string): boolean {
  const expression = value.trim()

  let cron: Cron | undefined
  try {
    cron = new Cron(expression, { paused: true })
    return cron.nextRun() !== null
  } catch {
    return false
  } finally {
    cron?.stop()
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
  const hourParts = hourPart.split(',')
  const hasValidTime =
    Number.isInteger(minute) &&
    minute >= 0 &&
    minute <= 59 &&
    hourParts.every((part) => /^\d{1,2}$/.test(part) && Number(part) <= 23)

  if (!hasValidTime || dayOfMonth !== '*' || month !== '*') {
    return { kind: 'cron', value: trigger.expr, weekday: '1' }
  }

  // Canonical form: sorted, deduped (matches parseTimes/formatTimes so the UI
  // multi-select never disagrees with the value it renders).
  const value = formatTimes(
    hourParts.map((part) => part.padStart(2, '0')),
    String(minute).padStart(2, '0')
  )
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
    return isValidCronExpression(expr) ? { kind: 'cron', expr } : null
  }

  const times = parseTimes(schedule.value)
  if (!times || times.hours.length === 0) return null
  const prefix = `${Number(times.minute)} ${times.hours.map(Number).join(',')} * *`

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
      return { ...current, kind, value: parseTimes(current.value) ? current.value : '09:00' }
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
    workspaceId: task.workspace.type === AGENT_WORKSPACE_TYPE.USER ? task.workspace.workspaceId : null,
    reuseSession: task.reuseSession
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

export function getTriggerSummary(trigger: Trigger, t: TFunction) {
  const schedule = triggerToFormState(trigger)
  // Time presets may hold a comma-joined list; space it out for display.
  const time = schedule.value.split(',').join(', ')
  switch (schedule.kind) {
    case 'hourly':
      return t('agent.tasks.schedule.summary.hourly')
    case 'daily':
      return t('agent.tasks.schedule.summary.daily', { time })
    case 'weekdays':
      return t('agent.tasks.schedule.summary.weekdays', { time })
    case 'weekly':
      return t('agent.tasks.schedule.summary.weekly', {
        weekday: getWeekdayLabel(schedule.weekday, t),
        time
      })
    case 'interval':
      return t('agent.tasks.schedule.summary.interval', { count: Number(schedule.value) })
    case 'once':
      return new Date(schedule.value).toLocaleString()
    case 'cron':
      return schedule.value
  }
}

export const TaskTimeSelect: FC<{
  value: string
  disabled?: boolean
  onChange: (value: string) => void
}> = ({ value, disabled, onChange }) => {
  const { t } = useTranslation()
  // An empty preset means the user cleared every hour; render no selection so the
  // UI agrees with the empty form value (which blocks saving until repopulated).
  // A non-empty value that fails to parse is unexpected, so fall back to the
  // default selection rather than rendering a blank, uneditable control.
  const { hours, minute } =
    parseTimes(value) ?? (value === '' ? { hours: [], minute: '00' } : { hours: ['09'], minute: '00' })

  // The minute is encoded inside the comma-joined value, so clearing the last
  // hour would otherwise discard it (formatTimes([], '30') === ''). Track the
  // last committed minute in state so re-picking an hour after clearing every
  // selection keeps the minute the user did not edit (e.g. 18:30 -> clear 18 ->
  // pick 20 yields 20:30, not 20:00). While no hour is selected the minute
  // stays a local preview only: the form value remains '' and saving is blocked.
  // Seed the retained minute from the mounted value: lastValue starts equal to
  // value, so the update block below never runs on the first render and a
  // fresh/remounted selector loading a non-zero-minute schedule would otherwise
  // fall back to 00 once every hour is cleared.
  const [rememberedMinute, setRememberedMinute] = useState(() => {
    const parsed = parseTimes(value)
    return parsed && parsed.hours.length > 0 ? parsed.minute : '00'
  })
  const [lastValue, setLastValue] = useState(value)
  if (value !== lastValue) {
    setLastValue(value)
    const parsed = parseTimes(value)
    if (parsed && parsed.hours.length > 0) setRememberedMinute(parsed.minute)
  }
  const displayMinute = hours.length > 0 ? minute : rememberedMinute

  return (
    <RowFlex role="group" aria-label={t('agent.tasks.schedule.time')} className="items-center gap-2">
      <Combobox
        multiple
        searchable={false}
        width={160}
        aria-label={t('agent.tasks.schedule.hours')}
        placeholder={t('agent.tasks.schedule.hours')}
        disabled={disabled}
        options={SCHEDULE_HOURS.map((hour) => ({ value: hour, label: hour }))}
        value={hours}
        renderValue={(selectedHours) => {
          const values = Array.isArray(selectedHours) ? selectedHours : []
          return (
            <span className={cn('min-w-0 flex-1 truncate text-left', values.length === 0 && 'text-muted-foreground')}>
              {values.length > 0 ? values.join(', ') : t('agent.tasks.schedule.hours')}
            </span>
          )
        }}
        onChange={(next) => {
          if (Array.isArray(next)) onChange(formatTimes(next, displayMinute))
        }}
      />
      <InputGroupText aria-hidden="true">:</InputGroupText>
      <Select
        value={displayMinute}
        disabled={disabled}
        onValueChange={(nextMinute) => {
          if (hours.length === 0) {
            // No hour selected: the minute cannot live in the value string, so
            // keep it only as the preview for the next hour selection.
            setRememberedMinute(nextMinute)
            return
          }
          onChange(formatTimes(hours, nextMinute))
        }}>
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
    ) : value.kind === 'cron' ? (
      <Input
        className="w-72 max-w-full font-mono"
        value={value.value}
        placeholder={t('agent.tasks.schedule.cronPlaceholder')}
        disabled={disabled}
        aria-label={t('agent.tasks.schedule.cron')}
        aria-invalid={invalid || undefined}
        onChange={(event) => updateValue(event.target.value)}
      />
    ) : null

  return (
    <FieldGroup>
      <Field data-invalid={invalid || undefined}>
        <FieldLabel htmlFor={`${id}-kind`}>{t('agent.tasks.frequency.label')}</FieldLabel>
        <RowFlex className="flex-wrap items-center gap-3">
          <Select value={value.kind} disabled={disabled} onValueChange={(kind) => updateKind(kind as ScheduleKind)}>
            <SelectTrigger id={`${id}-kind`} aria-invalid={invalid || undefined}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="hourly">{t('agent.tasks.schedule.hourly')}</SelectItem>
                <SelectItem value="daily">{t('agent.tasks.schedule.daily')}</SelectItem>
                <SelectItem value="weekdays">{t('agent.tasks.schedule.weekdaysOnly')}</SelectItem>
                <SelectItem value="weekly">{t('agent.tasks.schedule.weekly')}</SelectItem>
                <SelectItem value="interval">{t('agent.tasks.schedule.interval')}</SelectItem>
                <SelectItem value="once">{t('agent.tasks.schedule.once')}</SelectItem>
                <SelectItem value="cron">{t('agent.tasks.schedule.cron')}</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          {frequencyControl}
        </RowFlex>
        <FieldError>
          {invalid
            ? t(value.kind === 'cron' ? 'agent.tasks.schedule.invalidCron' : 'agent.tasks.schedule.invalid')
            : undefined}
        </FieldError>
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
              className={`inline-block h-1.5 w-1.5 rounded-full ${option.isActive ? 'bg-success' : 'bg-muted-foreground'}`}
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

const TaskSessionReuseField: FC<{
  value: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
}> = ({ value, onChange, disabled }) => {
  const { t } = useTranslation()

  return (
    <Field>
      <RowFlex className="items-center justify-between gap-3">
        <div className="min-w-0">
          <FieldLabel htmlFor="task-form-reuse-session">{t('agent.tasks.reuseSession.label')}</FieldLabel>
          <ItemDescription>{t('agent.tasks.reuseSession.description')}</ItemDescription>
        </div>
        <Switch
          id="task-form-reuse-session"
          className="shrink-0"
          checked={value}
          disabled={disabled}
          onCheckedChange={onChange}
        />
      </RowFlex>
      {value && <Alert type="warning" showIcon description={t('agent.tasks.reuseSession.warning')} />}
    </Field>
  )
}

type TaskFormDialogProps = {
  open: boolean
  agents: AgentInfo[]
  onOpenChange: (open: boolean) => void
} & (
  | {
      task: ScheduledTaskEntity
      onUpdate: (request: AgentTaskPatch) => Promise<boolean>
      onCreate?: never
    }
  | {
      task?: undefined
      onCreate: (agentId: string, request: AgentTaskForm) => Promise<boolean>
      onUpdate?: never
    }
)

export const TaskFormDialog: FC<TaskFormDialogProps> = (props) => {
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
  const [reuseSession, setReuseSession] = useState(false)
  const [saving, setSaving] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [promptPreviewKey, setPromptPreviewKey] = useState(0)
  const [polishing, setPolishing] = useState(false)
  const wasOpenRef = useRef(false)
  const initialDraftRef = useRef<TaskDraftSnapshot | null>(null)
  const { data: workspaces, refetch: refetchWorkspaces } = useQuery('/agent-workspaces')
  useDataChange('/agent-workspaces', () => void refetchWorkspaces())

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
      setReuseSession(draft?.reuseSession ?? false)
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
  const trigger = useMemo(() => formStateToTrigger(schedule), [schedule])
  const unchangedExistingSchedule =
    props.task !== undefined &&
    scheduleInputsEqual(schedule, initialDraftRef.current?.schedule ?? taskToDraftSnapshot(props.task).schedule)
  const resolvedTrigger = trigger ?? (unchangedExistingSchedule ? props.task?.trigger : null)

  const handleSave = useCallback(async () => {
    setSubmitted(true)
    if (!agentId || !name.trim() || !prompt.trim() || !resolvedTrigger) return

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
        const updates: AgentTaskPatch = {}

        if (name !== initialDraft.name) updates.name = name.trim()
        if (prompt !== initialDraft.prompt) updates.prompt = prompt.trim()
        if (schedule.timeoutMinutes !== initialDraft.schedule.timeoutMinutes) {
          updates.timeoutMinutes = timeoutMinutes
        }
        if (workspaceId !== initialDraft.workspaceId) updates.workspace = workspace
        if (reuseSession !== initialDraft.reuseSession) updates.reuseSession = reuseSession
        if (!stringArraysEqual(channelIds, initialDraft.channelIds)) updates.channelIds = channelIds
        if (!scheduleInputsEqual(schedule, initialDraft.schedule)) {
          const nextTrigger = preserveCompatibleTriggerMetadata(props.task.trigger, resolvedTrigger)
          if (!triggersEqual(nextTrigger, props.task.trigger)) updates.trigger = nextTrigger
        }

        saved = Object.keys(updates).length === 0 || (await props.onUpdate(updates))
      } else {
        saved = await props.onCreate(agentId, {
          name: name.trim(),
          prompt: prompt.trim(),
          trigger: resolvedTrigger,
          workspace,
          timeoutMinutes,
          reuseSession,
          channelIds: channelIds.length > 0 ? channelIds : undefined
        })
      }
      if (saved) onOpenChange(false)
    } finally {
      setSaving(false)
    }
  }, [agentId, channelIds, name, onOpenChange, prompt, props, reuseSession, schedule, resolvedTrigger, workspaceId])

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
                autoFocus
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
                disabled={polishing}
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
                    onRunningChange={setPolishing}
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
                      disabled={saving || isEditing}
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
              invalid={submitted && !resolvedTrigger}
              onChange={setSchedule}
            />

            <TaskSessionReuseField value={reuseSession} disabled={saving} onChange={setReuseSession} />

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
