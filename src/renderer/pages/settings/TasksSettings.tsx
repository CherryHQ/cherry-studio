import { Link, useNavigate, useParams } from '@tanstack/react-router'
import type { TFunction } from 'i18next'
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  CalendarCheck2,
  CalendarClock,
  CalendarFold,
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  PencilLine,
  Play,
  Plus,
  Trash2
} from 'lucide-react'
import { type FC, Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { ColumnDef } from '@cherrystudio/ui'
import {
  Alert,
  Badge,
  Button,
  Center,
  ConfirmDialog,
  DataTable,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  FieldGroup,
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
import CollapsibleSearchBar from '@renderer/components/CollapsibleSearchBar'
import { getTriggerSummary } from '@renderer/components/ScheduledTask/scheduleForm'
import { type AgentInfo, TaskFormDialog, toChannelInfo } from '@renderer/components/ScheduledTask/TaskFormDialog'
import { formatTaskCardTime, TaskRunSummaryLine } from '@renderer/components/ScheduledTask/TaskRunSummaryLine'
import {
  SettingDescription,
  SettingDivider,
  SettingGroup,
  SettingsContentColumn,
  SettingTitle
} from '@renderer/components/SettingsPrimitives'
import { useDataChange, useQuery } from '@renderer/data/hooks/useDataApi'
import { useChannels } from '@renderer/hooks/agent/useChannels'
import {
  useAllTasks,
  useCreateTask,
  useDeleteTask,
  useRunTask,
  useSetTaskEnabled,
  useTask,
  useTaskLogs,
  useUpdateTask
} from '@renderer/hooks/agent/useTasks'
import { useConversationNavigation } from '@renderer/hooks/useConversationNavigation'
import { useTheme } from '@renderer/hooks/useTheme'
import { ipcApi } from '@renderer/ipc'
import { openRoute } from '@renderer/services/mainWindowNavigation'
import { toast } from '@renderer/services/toast'
import { cn } from '@renderer/utils/style'
import { AGENTS_MAX_LIMIT } from '@shared/data/api/schemas/agents'
import { AGENT_WORKSPACE_TYPE } from '@shared/data/api/schemas/agentWorkspaces'
import type { ScheduledTaskEntity, ScheduledTaskListItem, TaskRunLogEntity } from '@shared/data/types/agent'
import type { AgentTaskForm, AgentTaskPatch } from '@shared/ipc/schemas/ai'

const logger = loggerService.withContext('TasksSettings')
const ALL_TASKS_FILTER = 'all'

type TaskUpdateResult = {
  succeeded: boolean
  task: ScheduledTaskEntity
}

function getTaskStatusLabel(status: string, t: TFunction) {
  const labels: Record<string, string> = {
    active: t('agent.tasks.status.active'),
    paused: t('agent.tasks.status.paused'),
    completed: t('agent.tasks.status.completed'),
    missed: t('agent.tasks.status.missed')
  }
  return labels[status] ?? status
}

function getTaskScheduleStatusIconPresentation(status: ScheduledTaskEntity['status']) {
  switch (status) {
    case 'active':
      return {
        Icon: CalendarClock,
        wrapperClassName: 'bg-info-subtle text-info-subtle-foreground',
        iconClassName: 'text-info-subtle-foreground'
      }
    case 'missed':
    case 'paused':
      return {
        Icon: CalendarFold,
        wrapperClassName: 'bg-warning-subtle text-warning-subtle-foreground',
        iconClassName: 'text-warning-subtle-foreground'
      }
    case 'completed':
      return {
        Icon: CalendarCheck2,
        wrapperClassName: 'bg-success-subtle text-success-subtle-foreground',
        iconClassName: 'text-success-subtle-foreground'
      }
  }
}

const TaskScheduleStatusIcon: FC<{ status: ScheduledTaskEntity['status'] }> = ({ status }) => {
  const { Icon, wrapperClassName, iconClassName } = getTaskScheduleStatusIconPresentation(status)

  return (
    <div className={cn('flex size-10 shrink-0 items-center justify-center rounded-lg', wrapperClassName)}>
      <Icon size={20} aria-hidden className={iconClassName} />
    </div>
  )
}

const TaskCardRunStatus: FC<{ task: ScheduledTaskListItem }> = ({ task }) => {
  const { t } = useTranslation()
  const nextRun = task.status === 'active' ? task.nextRun : null

  if (!task.runSummary && !nextRun) return null

  return (
    <div className="flex flex-col items-end gap-0.5 whitespace-nowrap text-xs">
      {task.runSummary && <TaskRunSummaryLine summary={task.runSummary} />}
      {nextRun && (
        <span className="text-muted-foreground">
          {t('agent.tasks.nextRun')} · {formatTaskCardTime(nextRun)}
        </span>
      )}
    </div>
  )
}

const TaskLogsInline: FC<{ taskId: string; agentId: string }> = ({ taskId, agentId }) => {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? i18n.language
  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      }),
    [locale]
  )
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
        dateFormatter.format(new Date(log.startedAt)).toLowerCase().includes(query)
    )
  }, [dateFormatter, logs, searchText])

  const columns = useMemo<ColumnDef<TaskRunLogEntity>[]>(
    () => [
      {
        accessorKey: 'startedAt',
        header: t('agent.tasks.logs.runAt'),
        meta: { width: 160 },
        cell: ({ getValue }) => dateFormatter.format(new Date(getValue() as string))
      },
      {
        accessorKey: 'durationMs',
        header: t('agent.tasks.logs.duration'),
        meta: { width: 80 },
        cell: ({ getValue, row }) => {
          const value = getValue() as number | null
          if (value == null || row.original.status === 'running') return '-'
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
                    <ArrowRight size={13} />
                  </Button>
                </Tooltip>
              )}
              <span className={isErrorStatus ? 'line-clamp-4 text-error' : 'line-clamp-4'}>{text}</span>
            </RowFlex>
          )
        }
      }
    ],
    [dateFormatter, openConversation, t]
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
  onUpdate: (taskId: string, updates: AgentTaskPatch) => Promise<TaskUpdateResult | undefined>
  onDelete: (taskId: string) => Promise<void>
  onRun: (taskId: string) => Promise<void>
  onToggleStatus: (taskId: string, newStatus: string) => Promise<void>
}> = ({ task, agents, onBack, onUpdate, onDelete, onRun, onToggleStatus }) => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const { channels: rawChannels } = useChannels()
  const { openConversation } = useConversationNavigation('agents')
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
  const { data: workspaces, refetch: refetchWorkspaces } = useQuery('/agent-workspaces')
  useDataChange('/agent-workspaces', () => void refetchWorkspaces())

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
      label: t('agent.tasks.reuseSession.label'),
      // A raw session UUID tells the user nothing — show the state, and make the
      // bound case a real affordance (the same jump the run log already offers).
      // The bound session only exists once a fire has run; until then the switch
      // is on but there is nothing to point at yet.
      value: !task.reuseSession ? (
        t('common.disabled')
      ) : task.reuseSessionId ? (
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto p-0"
          onClick={() => openConversation(task.reuseSessionId as string)}>
          {t('agent.tasks.reuseSession.bound')}
          <ArrowRight size={13} />
        </Button>
      ) : (
        t('agent.tasks.reuseSession.pending')
      )
    },
    {
      label: t('agent.tasks.channels.label'),
      value: selectedChannels.length > 0 ? selectedChannels.map((channel) => channel.name).join(', ') : t('common.none')
    },
    { label: t('agent.tasks.lastRun'), value: formatDateTime(task.lastRun) },
    { label: t('agent.tasks.nextRun'), value: formatDateTime(task.nextRun) }
  ]

  const handleEditSave = useCallback(
    async (request: AgentTaskPatch) => {
      const result = await onUpdate(task.id, request)
      return result?.succeeded === true
    },
    [onUpdate, task.id]
  )

  return (
    <SettingsContentColumn theme={theme} className="pt-4">
      <div>
        <SettingTitle className="flex-wrap gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              className="-ml-2 shrink-0 rounded-full"
              aria-label={t('common.back')}
              title={t('common.back')}
              onClick={onBack}>
              <ArrowLeft size={16} />
            </Button>
            <span className="min-w-0 break-words">{task.name}</span>
            {task.status === 'missed' && <Badge variant="secondary">{t('agent.tasks.status.missed')}</Badge>}
            {!isCompleted && task.status !== 'missed' && (
              <Switch
                className="ml-1 shrink-0"
                size="sm"
                checked={task.status === 'active'}
                onCheckedChange={(checked) => onToggleStatus(task.id, checked ? 'active' : 'paused')}
                aria-label={t('agent.tasks.status.active')}
                title={task.status === 'active' ? t('agent.tasks.pause') : t('agent.tasks.resume')}
              />
            )}
          </div>
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
        {task.nextRun && (
          <SettingDescription>
            {t('agent.tasks.nextRun')}: {formatDateTime(task.nextRun)}
          </SettingDescription>
        )}
      </div>

      <SettingGroup theme={theme}>
        <Tabs defaultValue="prompt" variant="line">
          <TabsList aria-label={task.name}>
            <TabsTrigger value="prompt">{t('agent.tasks.prompt.label')}</TabsTrigger>
            <TabsTrigger value="general">{t('settings.general.title')}</TabsTrigger>
            <TabsTrigger value="history">{t('agent.tasks.logs.label')}</TabsTrigger>
          </TabsList>
          <TabsContent value="prompt" className="min-w-0">
            <SettingDivider />
            <Item variant="muted" className="min-w-0 max-w-full">
              <ItemContent className="min-w-0">
                <ItemDescription className="wrap-anywhere line-clamp-none min-w-0 max-w-full whitespace-pre-wrap">
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
  const { setTaskEnabled } = useSetTaskEnabled()

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

  const createTaskWithAgent = useCallback(async () => {
    try {
      const { sessionId } = await ipcApi.request('ai.agent.assistant_session.create')
      openRoute('/app/agents', { intent: 'task', sessionId })
    } catch (error) {
      logger.error('Failed to create scheduled task chat session', error as Error)
      toast.error(t('settings.scheduledTasks.agentCreateFailed'))
    }
  }, [t])

  const clearFilters = useCallback(() => {
    setSearchQuery('')
    setAgentFilter(ALL_TASKS_FILTER)
    setStatusFilter(ALL_TASKS_FILTER)
  }, [])

  useEffect(() => {
    if (agentsError || tasksError || taskError) {
      logger.error('Failed to load tasks settings', agentsError ?? tasksError ?? taskError)
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
    async (agentId: string, request: AgentTaskForm) => {
      const created = await createTask(agentId, request)
      if (!created) return undefined
      await navigate({ to: '/settings/scheduled-tasks/$taskId', params: { taskId: created.id } })
      return created
    },
    [createTask, navigate]
  )

  const persistTaskUpdate = useCallback(
    async (task: ScheduledTaskEntity, updates: AgentTaskPatch): Promise<TaskUpdateResult> => {
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
    (selectedTaskId: string, updates: AgentTaskPatch): Promise<TaskUpdateResult | undefined> => {
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
      await deleteTask(task.agentId, selectedTaskId, {
        onDeleted: () => navigate({ to: '/settings/scheduled-tasks' })
      })
    },
    [deleteTask, getTaskForAction, navigate]
  )

  const handleRun = useCallback(
    async (selectedTaskId: string) => {
      await enqueueTaskOperation(selectedTaskId, async (previousSucceeded) => {
        if (!previousSucceeded) return false
        const task = getTaskForAction(selectedTaskId)
        if (!task) return false
        const ran = await runTask(task.agentId, selectedTaskId)
        if (!ran) return false
        await refetchTasks()
        return true
      })
    },
    [enqueueTaskOperation, getTaskForAction, refetchTasks, runTask]
  )

  const handleToggleStatus = useCallback(
    async (selectedTaskId: string, newStatus: string) => {
      const task = getTaskForAction(selectedTaskId)
      if (!task) return
      await enqueueTaskOperation(selectedTaskId, async (previousSucceeded) => {
        const enabled = newStatus === 'active'
        if (enabled && !previousSucceeded) return false
        const updated = await setTaskEnabled(task.agentId, task.id, enabled)
        return previousSucceeded && updated !== undefined
      })
    },
    [enqueueTaskOperation, getTaskForAction, setTaskEnabled]
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
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 px-6 pt-4">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-1.5">
            <SettingTitle className="shrink-0">
              <span>{t('settings.scheduledTasks.title')}</span>
            </SettingTitle>
            <CollapsibleSearchBar
              onSearch={setSearchQuery}
              value={searchQuery}
              placeholder={t('settings.scheduledTasks.searchPlaceholder')}
              tooltip={t('settings.scheduledTasks.search')}
              clearLabel={t('common.clear')}
              maxWidth={220}
              collapsedSize={30}
              style={{ borderRadius: 8 }}
            />
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {tasks.length > 0 && (
              <>
                <Select value={agentFilter} onValueChange={setAgentFilter}>
                  <SelectTrigger
                    className="h-8 min-w-32 bg-transparent"
                    aria-label={t('settings.scheduledTasks.filterAgent')}>
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
                  <SelectTrigger
                    className="h-8 min-w-32 bg-transparent"
                    aria-label={t('settings.scheduledTasks.filterStatus')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value={ALL_TASKS_FILTER}>{t('settings.scheduledTasks.allStatuses')}</SelectItem>
                      <SelectItem value="active">{t('agent.tasks.status.active')}</SelectItem>
                      <SelectItem value="paused">{t('agent.tasks.status.paused')}</SelectItem>
                      <SelectItem value="completed">{t('agent.tasks.status.completed')}</SelectItem>
                      <SelectItem value="missed">{t('agent.tasks.status.missed')}</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" size="sm" className="shrink-0">
                  <Plus size={12} className="lucide-custom" />
                  {t('settings.scheduledTasks.newTask')}
                  <ChevronDown size={12} className="text-primary-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-40">
                <DropdownMenuGroup>
                  <DropdownMenuItem disabled={agents.length === 0} onSelect={() => setCreateOpen(true)}>
                    <PencilLine />
                    {t('settings.scheduledTasks.manualCreate')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void createTaskWithAgent()}>
                    <Bot />
                    {t('settings.scheduledTasks.agentCreate')}
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      <Scrollbar className="min-h-0 flex-1 px-6 pt-4 pb-3">
        <div className="mx-auto w-full max-w-3xl">
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
              actionLabel={agents.length === 0 ? t('settings.scheduledTasks.agentCreate') : undefined}
              className="py-20"
              onAction={agents.length === 0 ? () => openRoute('/app/agents') : undefined}
            />
          ) : (
            <>
              {filteredTasks.length === 0 && hasActiveFilters ? (
                <EmptyState
                  preset="no-result"
                  title={t('settings.scheduledTasks.noMatchesTitle')}
                  description={t('settings.scheduledTasks.noMatches')}
                  actionLabel={t('settings.scheduledTasks.clearFilters')}
                  className="py-20"
                  onAction={clearFilters}
                />
              ) : (
                <ItemGroup className="gap-3">
                  {filteredTasks.map((task) => (
                    <Item
                      key={task.id}
                      asChild
                      variant="outline"
                      className="rounded-xl border-border bg-card transition-[border-color,box-shadow] hover:border-border-strong hover:bg-card hover:shadow-sm">
                      <Link
                        to="/settings/scheduled-tasks/$taskId"
                        params={{ taskId: task.id }}
                        style={{ backgroundColor: 'var(--settings-group-background, var(--card))' }}>
                        <TaskScheduleStatusIcon status={task.status} />
                        <ItemContent className="min-w-0">
                          <ItemTitle className="min-w-0 max-w-full">
                            <span className="truncate">{task.name}</span>
                            <Badge variant="secondary" className="shrink-0">
                              {getTaskStatusLabel(task.status, t)}
                            </Badge>
                          </ItemTitle>
                          <ItemDescription className="truncate text-xs leading-4">
                            {agents.find((agent) => agent.id === task.agentId)?.name ?? task.agentId} ·{' '}
                            {getTriggerSummary(task.trigger, t)}
                          </ItemDescription>
                        </ItemContent>
                        <ItemActions className="ml-auto shrink-0">
                          <TaskCardRunStatus task={task} />
                          <ChevronRight size={16} className="text-foreground-tertiary" />
                        </ItemActions>
                      </Link>
                    </Item>
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
        </div>
      </Scrollbar>

      <TaskFormDialog
        open={createOpen}
        agents={agents}
        onOpenChange={setCreateOpen}
        onCreate={async (agentId, request) => Boolean(await handleCreate(agentId, request))}
      />
    </div>
  )
}

export default TasksSettings
