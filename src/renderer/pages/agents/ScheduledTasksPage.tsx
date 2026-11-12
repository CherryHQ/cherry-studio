import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { lazy, Suspense, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Tooltip } from '@cherrystudio/ui'
import { ResourceList } from '@renderer/components/chat/resourceList/base'
import { ConversationNavigationPane } from '@renderer/components/chat/shell/ConversationNavigationPane'
import { ConversationSidebarToggleButton } from '@renderer/components/chat/shell/ConversationSidebarToggleButton'
import { formatTaskCardTime, TaskRunSummaryLine } from '@renderer/components/ScheduledTask/TaskRunSummaryLine'
import { useQuery } from '@renderer/data/hooks/useDataApi'
import { usePreference } from '@renderer/data/hooks/usePreference'
import { useTaskConversation } from '@renderer/hooks/agent/useTaskConversation'
import { TASKS_PAGE_LIMIT, useAllTasks, useCreateTask, useTask } from '@renderer/hooks/agent/useTasks'
import { useCommandHandler } from '@renderer/hooks/command'
import { useCurrentTabId, useIsActiveTab } from '@renderer/hooks/tab'
import { useConversationLocateRequest } from '@renderer/hooks/useConversationLocateRequest'
import { useConversationShellPaneState } from '@renderer/hooks/useConversationShellPaneState'
import type { AppRouter } from '@renderer/types/router'

import AgentChat from './AgentChat'
import { ScheduledTaskGroup } from './components/ScheduledTaskSidebar'
import { useAgentConversationBootstrap } from './useAgentConversationBootstrap'

const TaskFormDialog = lazy(() =>
  import('@renderer/components/ScheduledTask/TaskFormDialog').then((module) => ({ default: module.TaskFormDialog }))
)
const routeApi = getRouteApi('/app/scheduled-tasks')

export default function ScheduledTasksPage() {
  const { t } = useTranslation()
  const { taskId, runId, notificationId } = routeApi.useSearch<AppRouter>()
  const navigate = useNavigate()
  const active = useAllTasks('active')
  const paused = useAllTasks(['paused', 'missed'])
  const completed = useAllTasks('completed')
  const { task, error: taskError, isLoading: taskLoading, refetch: refreshTask } = useTask(taskId ?? null)
  const selectedTask = task?.id === taskId && !taskError ? task : null
  const { data: notification, error: notificationError } = useQuery('/notifications/:id', {
    params: { id: notificationId ?? '' },
    enabled: !!notificationId,
    swrOptions: { shouldRetryOnError: false }
  })
  const resultError =
    selectedTask?.runSummary?.status === 'failed' &&
    notificationId &&
    notification?.id === notificationId &&
    !notificationError &&
    notification.target?.kind === 'scheduled-task' &&
    notification.target.taskId === selectedTask?.id
      ? notification.target.result?.errorSummary
      : undefined
  const conversation = useTaskConversation(selectedTask, runId)
  const bootstrap = useAgentConversationBootstrap({
    session: conversation.session,
    sessionLoading: conversation.sessionLoading,
    sessionSource: conversation.session ? 'query' : 'none'
  })
  const currentTabId = useCurrentTabId()
  const isActiveTab = useIsActiveTab()
  const { locateMessageId, locateToEnd, clearLocate } = useConversationLocateRequest({
    navigationTabId: currentTabId ?? undefined,
    activeConversationId: conversation.result?.session?.id,
    visibleConversationId: bootstrap.session?.id
  })
  const [paneOpen, setPaneOpen] = usePreference('topic.tab.show')
  const shell = useConversationShellPaneState({ persistedPaneOpen: paneOpen, setPersistedPaneOpen: setPaneOpen })
  useCommandHandler('app.sidebar.toggle', shell.toggleShellPane, { enabled: isActiveTab })
  // Keep the lazy form mounted after first use so Dialog can finish its exit animation.
  const [createOpen, setCreateOpen] = useState<boolean>()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const { createTask } = useCreateTask()
  const ids = useMemo(
    () => [...new Set([...active.tasks, ...paused.tasks, ...completed.tasks].map((item) => item.agentId))].sort(),
    [active.tasks, paused.tasks, completed.tasks]
  )
  const { data: owners } = useQuery('/agents', { query: { ids, limit: 3 * TASKS_PAGE_LIMIT }, enabled: ids.length > 0 })
  const names = useMemo(() => new Map(owners?.items.map((agent) => [agent.id, agent.name])), [owners])
  const {
    data: availableAgents,
    isLoading: agentsLoading,
    error: agentsError,
    refetch: refreshAgents
  } = useQuery('/agents', {
    query: { limit: 500 },
    enabled: createOpen === true
  })
  const selectTask = (id: string) => {
    void navigate({ to: '/app/scheduled-tasks', search: { taskId: id }, replace: true })
  }
  const selectRun = (id: string) => {
    if (taskId) void navigate({ to: '/app/scheduled-tasks', search: { taskId, runId: id }, replace: true })
  }
  const handleTaskDeleted = async (id: string) => {
    if (taskId === id) await navigate({ to: '/app/scheduled-tasks', search: {}, replace: true })
  }
  const changeCreateOpen = (open: boolean) => {
    setCreateOpen(open)
    if (!open) requestAnimationFrame(() => triggerRef.current?.focus())
  }
  const pane = (
    <ConversationNavigationPane className="border-r-[0.5px] border-border bg-background p-1.5 text-foreground">
      <ResourceList.Header>
        <ResourceList.HeaderItem
          ref={triggerRef}
          icon={<Plus />}
          label={t('scheduledTasks.add')}
          onClick={() => setCreateOpen(true)}
        />
      </ResourceList.Header>
      <div className="min-h-0 flex-1 overflow-y-auto pb-3">
        {(
          [
            ['active', active],
            ['paused', paused],
            ['completed', completed]
          ] as const
        ).map(([status, source]) => (
          <ScheduledTaskGroup
            key={status}
            status={status}
            source={source}
            selectedTaskId={taskId}
            agents={names}
            onSelect={selectTask}
            onDeleted={handleTaskDeleted}
          />
        ))}
      </div>
    </ConversationNavigationPane>
  )
  const toolbar = (
    <div className="flex min-h-(--navbar-height) flex-wrap items-center gap-2 px-3 py-1.5">
      <ConversationSidebarToggleButton sidebarOpen={shell.shellPaneOpen} onSidebarToggle={shell.toggleShellPane} />
      <span className="min-w-0 flex-1 truncate text-sm font-medium">
        {selectedTask?.name ?? t('settings.scheduledTasks.title')}
      </span>
      {selectedTask?.runSummary && (
        <Tooltip content={resultError} placement="bottom" asChild>
          <span className="text-xs" tabIndex={resultError ? 0 : undefined}>
            <TaskRunSummaryLine summary={selectedTask.runSummary} />
          </span>
        </Tooltip>
      )}
      {!!conversation.result?.logs.length && (
        <Select value={runId ?? conversation.result.runId ?? ''} onValueChange={selectRun}>
          <SelectTrigger className="w-auto max-w-full" aria-label={t('scheduledTasks.conversation')}>
            <SelectValue placeholder={t('scheduledTasks.conversation')} />
          </SelectTrigger>
          <SelectContent className="max-h-[min(20rem,var(--radix-select-content-available-height))]">
            {runId && conversation.result.startedAt && !conversation.result.logs.some((log) => log.id === runId) && (
              <SelectItem value={runId}>{formatTaskCardTime(conversation.result.startedAt)}</SelectItem>
            )}
            {conversation.result.logs.map((log) => (
              <SelectItem key={log.id} value={log.id}>
                {formatTaskCardTime(log.startedAt)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {conversation.newerRunId && (
        <Button size="sm" variant="outline" onClick={() => selectRun(conversation.newerRunId!)}>
          {t('scheduledTasks.latest')}
        </Button>
      )}
      {conversation.hasMore && (
        <Button variant="ghost" size="sm" disabled={conversation.loading} onClick={() => void conversation.loadMore()}>
          {t('scheduledTasks.older')}
        </Button>
      )}
    </div>
  )
  const pending = taskLoading || conversation.loading || conversation.sessionLoading
  const error = taskError ?? conversation.error
  const waitingForFirstRun =
    (selectedTask?.status === 'active' || selectedTask?.status === 'paused') &&
    !selectedTask.runSummary &&
    !conversation.result?.total
  const empty = (
    <div
      className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground"
      role={error ? 'alert' : 'status'}>
      <p>
        {error
          ? t('scheduledTasks.unavailable')
          : pending
            ? t('common.loading')
            : !taskId
              ? t('scheduledTasks.select')
              : conversation.hasMore
                ? t('scheduledTasks.moreHistory')
                : waitingForFirstRun
                  ? t('agent.tasks.reuseSession.pending')
                  : t('scheduledTasks.noConversation')}
      </p>
      {!!error && (
        <Button
          variant="outline"
          onClick={() => {
            void refreshTask()
            conversation.retry()
          }}>
          {t('common.retry')}
        </Button>
      )}
      {conversation.hasMore && (
        <Button variant="outline" disabled={conversation.loading} onClick={() => void conversation.loadMore()}>
          {t('scheduledTasks.older')}
        </Button>
      )}
    </div>
  )
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <AgentChat
        conversationBootstrap={bootstrap}
        locateMessageId={locateMessageId}
        locateToEnd={locateToEnd}
        onLocateMessageHandled={clearLocate}
        pane={pane}
        paneOpen={shell.shellPaneOpen}
        panePosition="left"
        onPaneCollapse={() => shell.setShellPaneOpenManually(false)}
        onPaneAutoCollapseChange={shell.handlePaneAutoCollapseChange}
        paneManualToggle={shell.paneManualToggle}
        showResourceListControls={false}
        conversationToolbar={toolbar}
        centerSurface={!conversation.session ? { content: empty } : null}
      />
      {conversation.session && !!error && (
        <div role="alert" className="flex items-center gap-2 px-3 py-1 text-sm">
          {t('agent.tasks.logs.loadError')}
          <Button variant="ghost" onClick={conversation.retry}>
            {t('common.retry')}
          </Button>
        </div>
      )}
      {createOpen !== undefined && (
        <Suspense fallback={<p role="status">{t('common.loading')}</p>}>
          <TaskFormDialog
            agentNotice={
              !agentsLoading &&
              (agentsError || !availableAgents?.items.length) && (
                <div role="status" className="flex items-center gap-2 p-3">
                  {agentsError ? t('agent.tasks.error.loadFailed') : t('settings.scheduledTasks.noAgents')}
                  {agentsError ? (
                    <Button onClick={() => void refreshAgents()}>{t('common.retry')}</Button>
                  ) : (
                    <Button
                      onClick={() => {
                        changeCreateOpen(false)
                        void navigate({ to: '/app/agents' })
                      }}>
                      {t('title.work')}
                    </Button>
                  )}
                </div>
              )
            }
            open={createOpen}
            agents={availableAgents?.items ?? []}
            onOpenChange={changeCreateOpen}
            onCreate={async (agentId, form) => {
              const created = await createTask(agentId, form)
              if (!created) return false
              selectTask(created.id)
              return true
            }}
          />
        </Suspense>
      )}
    </div>
  )
}
