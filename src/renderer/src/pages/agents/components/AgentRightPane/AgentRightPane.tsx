import { Badge } from '@cherrystudio/ui'
import { EmptyState } from '@renderer/components/chat'
import MessageList from '@renderer/components/chat/messages/MessageList'
import { MessageListProvider } from '@renderer/components/chat/messages/MessageListProvider'
import ArtifactPane, { type ArtifactPaneViewMode } from '@renderer/components/chat/panes/ArtifactPane'
import { Shell, useShellActions, useShellState } from '@renderer/components/chat/panes/Shell'
import { usePreference } from '@renderer/data/hooks/usePreference'
import { useAgentMessageListProviderValue } from '@renderer/pages/agents/messages/agentMessageListAdapter'
import type { Topic, TopicType as TopicTypeEnum } from '@renderer/types'
import { TopicType } from '@renderer/types'
import { cn } from '@renderer/utils'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import type { CherryMessagePart, CherryUIMessage, ModelSnapshot } from '@shared/data/types/message'
import { Activity, CheckCircle, Circle, FolderOpen, GitBranch, Loader2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { createContext, use, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  type AgentRightPaneStatus,
  type AgentStatusTask,
  type AgentToolFlowOpenInput,
  buildAgentRightPaneStatus,
  buildAgentToolFlowProjection
} from './agentRightPaneProjection'

// ── Agent-specific composition over the generic RightPane shell ─────────────
// Owns the agent business logic — subagent tool-flow tabs, task/status
// projections, agent session metadata — and feeds it into Shell.* slots.

const FLOW_TAB_PREFIX = 'flow:'
const MAX_FLOW_TAB_TITLE_LENGTH = 32
const FALLBACK_TIMESTAMP = '1970-01-01T00:00:00.000Z'

function getFlowTabValue(toolCallId: string): string {
  return `${FLOW_TAB_PREFIX}${toolCallId}`
}

function getFlowToolCallId(tab: string): string | undefined {
  return tab.startsWith(FLOW_TAB_PREFIX) ? tab.slice(FLOW_TAB_PREFIX.length) : undefined
}

function getFlowTabTitle(input: AgentToolFlowOpenInput): string {
  const title = input.title?.trim() || input.toolName?.trim() || input.toolCallId
  return title.length > MAX_FLOW_TAB_TITLE_LENGTH ? `${title.slice(0, MAX_FLOW_TAB_TITLE_LENGTH - 3)}...` : title
}

interface AgentFlowTab {
  toolCallId: string
  toolName?: string
  sourceMessageId?: string
  title: string
}

interface AgentRightPaneMeta {
  sessionId?: string
  sessionName?: string
  agentId?: string
  agentName?: string
  agentAvatar?: string
  modelFallback?: ModelSnapshot
}

interface AgentRightPaneState {
  flowTabs: AgentFlowTab[]
  activeFlowTab?: AgentFlowTab
  flow: ReturnType<typeof buildAgentToolFlowProjection>
  status: AgentRightPaneStatus
  selectedFile: string | null
  viewMode: ArtifactPaneViewMode
  workspacePath?: string
}

interface AgentRightPaneActions {
  openAgentToolFlow: (input: AgentToolFlowOpenInput) => void
  closeFlowTab: (toolCallId: string) => void
  setSelectedFile: (file: string | null) => void
  setViewMode: (mode: ArtifactPaneViewMode) => void
}

interface AgentRightPaneContextValue {
  state: AgentRightPaneState
  actions: AgentRightPaneActions
  meta: AgentRightPaneMeta
}

interface AgentRightPaneProviderProps extends AgentRightPaneMeta {
  children: ReactNode
  workspacePath?: string
  messages: CherryUIMessage[]
  partsByMessageId: Record<string, CherryMessagePart[]>
}

const AgentRightPaneContext = createContext<AgentRightPaneContextValue | null>(null)

function useAgentRightPane(): AgentRightPaneContextValue {
  const value = use(AgentRightPaneContext)
  if (!value) throw new Error('useAgentRightPane must be used within <AgentRightPane>')
  return value
}

export function useAgentRightPaneActions(): AgentRightPaneActions {
  return useAgentRightPane().actions
}

function AgentRightPaneStateProvider({
  children,
  workspacePath,
  messages,
  partsByMessageId,
  sessionId,
  sessionName,
  agentId,
  agentName,
  agentAvatar,
  modelFallback
}: AgentRightPaneProviderProps) {
  const { activeTab } = useShellState()
  const { openTab } = useShellActions()
  const [flowTabs, setFlowTabs] = useState<AgentFlowTab[]>([])
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<ArtifactPaneViewMode>('preview')

  const activeFlowToolCallId = getFlowToolCallId(activeTab)
  const activeFlowTab = activeFlowToolCallId
    ? flowTabs.find((flowTab) => flowTab.toolCallId === activeFlowToolCallId)
    : undefined

  const flow = useMemo(
    () => buildAgentToolFlowProjection(messages, partsByMessageId, activeFlowTab?.toolCallId),
    [activeFlowTab?.toolCallId, messages, partsByMessageId]
  )
  const status = useMemo(() => buildAgentRightPaneStatus(messages, partsByMessageId), [messages, partsByMessageId])

  useEffect(() => {
    setSelectedFile(null)
    setViewMode('preview')
  }, [workspacePath])

  const openAgentToolFlow = useCallback(
    (input: AgentToolFlowOpenInput) => {
      const nextTab: AgentFlowTab = {
        toolCallId: input.toolCallId,
        toolName: input.toolName,
        sourceMessageId: input.sourceMessageId,
        title: getFlowTabTitle(input)
      }
      setFlowTabs((currentTabs) => {
        if (!currentTabs.some((tab) => tab.toolCallId === input.toolCallId)) return [...currentTabs, nextTab]
        return currentTabs.map((tab) => (tab.toolCallId === input.toolCallId ? { ...tab, ...nextTab } : tab))
      })
      openTab(getFlowTabValue(input.toolCallId))
    },
    [openTab]
  )
  const closeFlowTab = useCallback(
    (toolCallId: string) => {
      setFlowTabs((currentTabs) => currentTabs.filter((tab) => tab.toolCallId !== toolCallId))
      if (getFlowToolCallId(activeTab) === toolCallId) openTab('files')
    },
    [activeTab, openTab]
  )

  const value = useMemo<AgentRightPaneContextValue>(
    () => ({
      state: { flowTabs, activeFlowTab, flow, status, selectedFile, viewMode, workspacePath },
      actions: { openAgentToolFlow, closeFlowTab, setSelectedFile, setViewMode },
      meta: { sessionId, sessionName, agentId, agentName, agentAvatar, modelFallback }
    }),
    [
      activeFlowTab,
      agentAvatar,
      agentId,
      agentName,
      closeFlowTab,
      flow,
      flowTabs,
      modelFallback,
      openAgentToolFlow,
      selectedFile,
      sessionId,
      sessionName,
      status,
      viewMode,
      workspacePath
    ]
  )

  return <AgentRightPaneContext value={value}>{children}</AgentRightPaneContext>
}

function AgentRightPaneProvider(props: AgentRightPaneProviderProps) {
  const { children, ...rest } = props
  return (
    <Shell defaultTab="files">
      <AgentRightPaneStateProvider {...rest}>{children}</AgentRightPaneStateProvider>
    </Shell>
  )
}

function AgentRightPaneFilesPanel() {
  const { state, actions } = useAgentRightPane()
  const shellState = useShellState()
  return (
    <ArtifactPane
      workspacePath={state.workspacePath}
      pdfLayoutPending={shellState.pdfLayoutPending}
      selectedFile={state.selectedFile}
      viewMode={state.viewMode}
      onSelectedFileChange={actions.setSelectedFile}
      onViewModeChange={actions.setViewMode}
      pdfLayoutRefreshKey={shellState.pdfLayoutRefreshKey}
    />
  )
}

function AgentToolFlowMessageList({
  messages,
  partsByMessageId
}: {
  messages: CherryUIMessage[]
  partsByMessageId: Record<string, CherryMessagePart[]>
}) {
  const { actions, meta } = useAgentRightPane()
  const [messageNavigation] = usePreference('chat.message.navigation_mode')
  const topic = useMemo<Topic>(
    () => ({
      id: meta.sessionId ? buildAgentSessionTopicId(meta.sessionId) : 'agent-session:tool-flow',
      type: TopicType.Session as TopicTypeEnum,
      assistantId: meta.agentId,
      name: meta.sessionName ?? meta.sessionId ?? 'agent-tool-flow',
      createdAt: FALLBACK_TIMESTAMP,
      updatedAt: FALLBACK_TIMESTAMP,
      messages: []
    }),
    [meta.agentId, meta.sessionId, meta.sessionName]
  )
  const providerValue = useAgentMessageListProviderValue({
    topic,
    messages,
    partsByMessageId,
    assistantProfile: meta.agentName
      ? {
          name: meta.agentName,
          avatar: meta.agentAvatar
        }
      : undefined,
    assistantId: meta.agentId,
    modelFallback: meta.modelFallback,
    isLoading: false,
    hasOlder: false,
    openAgentToolFlow: actions.openAgentToolFlow,
    messageNavigation
  })
  const flowProviderValue = useMemo(
    () => ({
      ...providerValue,
      state: {
        ...providerValue.state,
        selection: undefined,
        renderConfig: {
          ...providerValue.state.renderConfig,
          collapseCompletedToolHistory: false
        }
      }
    }),
    [providerValue]
  )

  return (
    <MessageListProvider value={flowProviderValue}>
      <div className="h-full min-h-0 [&_.MessageFooter]:hidden [&_.group-menu-bar]:hidden">
        <MessageList />
      </div>
    </MessageListProvider>
  )
}

function AgentRightPaneFlowPanel({ tab }: { tab: AgentFlowTab }) {
  const { state } = useAgentRightPane()
  const { activeTab } = useShellState()
  const { t } = useTranslation()

  // Only the active flow tab drives the projection, so skip stale siblings.
  if (activeTab !== getFlowTabValue(tab.toolCallId)) return null

  if (!state.flow.messages.length) {
    return (
      <EmptyState
        icon={GitBranch}
        title={tab.title || t('agent.right_pane.flow.no_messages.title')}
        description={t('agent.right_pane.flow.no_messages.description')}
      />
    )
  }

  return (
    <div className="h-full min-h-0 overflow-hidden">
      <AgentToolFlowMessageList messages={state.flow.messages} partsByMessageId={state.flow.partsByMessageId} />
    </div>
  )
}

function TaskStatusIcon({ status }: { status: AgentStatusTask['status'] }) {
  switch (status) {
    case 'completed':
      return <CheckCircle size={14} className="text-success" />
    case 'in_progress':
      return <Loader2 size={14} className="animate-spin text-info" />
    case 'error':
      return <Circle size={14} className="text-destructive" />
    case 'pending':
    default:
      return <Circle size={14} className="text-muted-foreground" />
  }
}

function StatusMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border-subtle px-3 py-2">
      <div className="text-muted-foreground">{label}</div>
      <div className="font-medium text-foreground text-lg leading-6">{value}</div>
    </div>
  )
}

function AgentAgentRightPaneStatusPanel() {
  const { state, meta } = useAgentRightPane()
  const { t } = useTranslation()
  const { status } = state

  return (
    <div className="space-y-4 p-3 text-sm">
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-medium text-foreground text-sm">{t('agent.right_pane.status.tasks')}</h3>
          <Badge variant="outline" className="text-[11px]">
            {t('agent.right_pane.status.task_count', {
              completed: status.completedTaskCount,
              total: status.totalTaskCount
            })}
          </Badge>
        </div>
        {status.tasks.length ? (
          <div className="space-y-1.5">
            {status.tasks.map((task) => (
              <div
                key={`${task.source}-${task.id}`}
                className="flex items-start gap-2 rounded-md border border-border-subtle bg-background-subtle px-2.5 py-2">
                <TaskStatusIcon status={task.status} />
                <div className="min-w-0 flex-1">
                  <div
                    className={cn(
                      'wrap-break-word text-foreground text-xs leading-5',
                      task.status === 'completed' && 'text-muted-foreground line-through'
                    )}>
                    {task.status === 'in_progress' && task.activeText ? task.activeText : task.title}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-md border border-border-subtle px-3 py-2 text-muted-foreground text-xs">
            {t('agent.right_pane.status.no_tasks')}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="font-medium text-foreground text-sm">{t('agent.right_pane.status.context')}</h3>
        <dl className="space-y-2 rounded-md border border-border-subtle px-3 py-2 text-xs">
          <div className="space-y-0.5">
            <dt className="text-muted-foreground">{t('agent.right_pane.status.workspace')}</dt>
            <dd className="break-all text-foreground">{state.workspacePath || t('common.none')}</dd>
          </div>
          <div className="space-y-0.5">
            <dt className="text-muted-foreground">{t('agent.right_pane.status.agent')}</dt>
            <dd className="break-all text-foreground">{meta.agentName || meta.agentId || t('common.none')}</dd>
          </div>
          <div className="space-y-0.5">
            <dt className="text-muted-foreground">{t('agent.right_pane.status.selected_tool')}</dt>
            <dd className="break-all text-foreground">
              {state.activeFlowTab?.title || state.flow.selectedTool?.toolName || t('common.none')}
            </dd>
          </div>
        </dl>
        {status.latestCompactSummary && (
          <div className="max-h-40 overflow-auto rounded-md border border-border-subtle px-3 py-2 text-foreground text-xs leading-5">
            {status.latestCompactSummary}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="font-medium text-foreground text-sm">{t('agent.right_pane.status.activity')}</h3>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <StatusMetric label={t('agent.right_pane.status.tools_total')} value={status.toolStats.total} />
          <StatusMetric label={t('agent.right_pane.status.tools_active')} value={status.toolStats.active} />
          <StatusMetric label={t('agent.right_pane.status.tools_done')} value={status.toolStats.completed} />
          <StatusMetric label={t('agent.right_pane.status.tools_failed')} value={status.toolStats.failed} />
        </div>
      </section>
    </div>
  )
}

function AgentRightPaneSurface() {
  const { state, actions } = useAgentRightPane()
  const { t } = useTranslation()
  const incompleteTasks = state.status.tasks.filter((task) => task.status !== 'completed').length

  return (
    <Shell.Tabs>
      <Shell.TabList>
        <Shell.Tab value="files" icon={<FolderOpen className="size-3.5" />}>
          {t('agent.right_pane.tabs.files')}
        </Shell.Tab>
        {state.flowTabs.map((flowTab) => (
          <Shell.Tab
            key={flowTab.toolCallId}
            value={getFlowTabValue(flowTab.toolCallId)}
            icon={<GitBranch className="size-3.5" />}
            onClose={() => actions.closeFlowTab(flowTab.toolCallId)}>
            {flowTab.title}
          </Shell.Tab>
        ))}
        <Shell.Tab
          value="status"
          icon={<Activity className="size-3.5" />}
          badge={
            incompleteTasks > 0 ? (
              <Badge variant="secondary" className="h-4 min-w-4 px-1 text-[10px] leading-3">
                {incompleteTasks}
              </Badge>
            ) : undefined
          }>
          {t('agent.right_pane.tabs.status')}
        </Shell.Tab>
      </Shell.TabList>
      <Shell.Panel value="files">
        <AgentRightPaneFilesPanel />
      </Shell.Panel>
      {state.flowTabs.map((flowTab) => (
        <Shell.Panel key={flowTab.toolCallId} value={getFlowTabValue(flowTab.toolCallId)}>
          <AgentRightPaneFlowPanel tab={flowTab} />
        </Shell.Panel>
      ))}
      <Shell.Panel value="status" className="overflow-auto">
        <AgentAgentRightPaneStatusPanel />
      </Shell.Panel>
    </Shell.Tabs>
  )
}

function AgentRightPaneHost() {
  return (
    <Shell.Host>
      <AgentRightPaneSurface />
    </Shell.Host>
  )
}

function AgentRightPaneMaximizedOverlay() {
  return (
    <Shell.MaximizedOverlay>
      <AgentRightPaneSurface />
    </Shell.MaximizedOverlay>
  )
}

function AgentRightPaneFilesToggle() {
  const { t } = useTranslation()
  return <Shell.Toggle tab="files" label={t('agent.right_pane.files_toggle')} />
}

// `AgentRightPane` is the provider itself, with the other parts attached as
// statics — used as `<AgentRightPane>` / `<AgentRightPane.Host>`.
export const AgentRightPane = Object.assign(AgentRightPaneProvider, {
  Host: AgentRightPaneHost,
  MaximizedOverlay: AgentRightPaneMaximizedOverlay,
  FilesToggle: AgentRightPaneFilesToggle
})

export type { AgentToolFlowOpenInput }
