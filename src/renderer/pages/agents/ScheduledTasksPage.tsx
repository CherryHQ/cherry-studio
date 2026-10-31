import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { lazy, Suspense, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@cherrystudio/ui'
import { ResourceList } from '@renderer/components/chat/resourceList/base'
import { ConversationNavigationPane } from '@renderer/components/chat/shell/ConversationNavigationPane'
import { ConversationSidebarToggleButton } from '@renderer/components/chat/shell/ConversationSidebarToggleButton'
import { formatTaskCardTime, TaskRunSummaryLine } from '@renderer/components/ScheduledTask/TaskRunSummaryLine'
import { useQuery } from '@renderer/data/hooks/useDataApi'
import { usePreference } from '@renderer/data/hooks/usePreference'
import { useTaskConversation } from '@renderer/hooks/agent/useTaskConversation'
import { useAllTasks, useCreateTask, useTask } from '@renderer/hooks/agent/useTasks'
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
  const { taskId, runId } = routeApi.useSearch<AppRouter>()
  const navigate = useNavigate()
  const active = useAllTasks('active')
  const paused = useAllTasks('paused')
  const { task, error: taskError, isLoading: taskLoading, refetch: refreshTask } = useTask(taskId ?? null)
  const selectedTask = task?.id === taskId && !taskError ? task : null
  const conversation = useTaskConversation(selectedTask, runId)
  const bootstrap = useAgentConversationBootstrap({
    session: conversation.session,
    sessionLoading: conversation.sessionLoading,
    sessionSource: conversation.session ? 'query' : 'none'
  })
  const [paneOpen, setPaneOpen] = usePreference('topic.tab.show')
  const shell = useConversationShellPaneState({ persistedPaneOpen: paneOpen, setPersistedPaneOpen: setPaneOpen })
  const [createOpen, setCreateOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const { createTask } = useCreateTask()
  const ids = useMemo(
    () => [...new Set([...active.tasks, ...paused.tasks].map((item) => item.agentId))].sort(),
    [active.tasks, paused.tasks]
  )
  const { data: owners } = useQuery('/agents', { query: { ids, limit: 100 }, enabled: ids.length > 0 })
  const names = useMemo(() => new Map(owners?.items.map((agent) => [agent.id, agent.name])), [owners])
  const {
    data: availableAgents,
    isLoading: agentsLoading,
    error: agentsError,
    refetch: refreshAgents
  } = useQuery('/agents', {
    query: { limit: 500 },
    enabled: createOpen
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
        <ScheduledTaskGroup
          status="active"
          source={active}
          selectedTaskId={taskId}
          agents={names}
          onSelect={selectTask}
          onDeleted={handleTaskDeleted}
        />
        <ScheduledTaskGroup
          status="paused"
          source={paused}
          selectedTaskId={taskId}
          agents={names}
          onSelect={selectTask}
          onDeleted={handleTaskDeleted}
        />
      </div>
    </ConversationNavigationPane>
  )
  const toolbar = (
    <div className="flex min-h-(--navbar-height) flex-wrap items-center gap-2 border-b border-border-subtle px-3 py-1.5">
      <ConversationSidebarToggleButton sidebarOpen={shell.shellPaneOpen} onSidebarToggle={shell.toggleShellPane} />
      <span className="min-w-0 flex-1 truncate text-sm font-medium">
        {selectedTask?.name ?? t('settings.scheduledTasks.title')}
      </span>
      {selectedTask?.runSummary && (
        <span className="text-xs">
          <TaskRunSummaryLine summary={selectedTask.runSummary} />
        </span>
      )}
      {!!conversation.result?.logs.length && (
        <Select value={runId ?? conversation.result.runId ?? ''} onValueChange={selectRun}>
          <SelectTrigger className="w-auto max-w-full" aria-label={t('scheduledTasks.conversation')}>
            <SelectValue placeholder={t('scheduledTasks.conversation')} />
          </SelectTrigger>
          <SelectContent>
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
                : !selectedTask?.runSummary && !conversation.result?.total
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
      {createOpen && (
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
            open
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
