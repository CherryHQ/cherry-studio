import { Badge, HoverCard, HoverCardContent, HoverCardTrigger } from '@cherrystudio/ui'
import { ContextUsageSummary, getAgentContextUsageColor } from '@renderer/components/chat/agent/ContextUsageSummary'
import MessageList from '@renderer/components/chat/messages/MessageList'
import { MessageListProvider } from '@renderer/components/chat/messages/MessageListProvider'
import {
  type ArtifactPaneFileSelection,
  ArtifactPaneView,
  resolveArtifactPaneFileSelection
} from '@renderer/components/chat/panes/ArtifactPane'
import {
  RESOURCE_PANE_TAB,
  type ResourcePaneConfig,
  ResourcePaneLocateOpener,
  ResourcePaneProvider,
  RightPanel,
  type RightPanelCapability,
  type RightPanelComponentProps,
  RightPanelProvider,
  type RightPanelReadiness,
  RightPanelShortcut,
  RightPanelViewport,
  useRightPanelActions,
  useRightPanelState
} from '@renderer/components/chat/panes/Shell'
import {
  isSelectableFileNode,
  useArtifactFileTreeModel
} from '@renderer/components/chat/panes/useArtifactFileTreeModel'
import { EmptyState } from '@renderer/components/chat/primitives'
import type { ResourceListRevealRequest } from '@renderer/components/chat/resourceList/base'
import { TracePane } from '@renderer/components/chat/trace/TracePane'
import Scrollbar from '@renderer/components/Scrollbar'
import { usePreference } from '@renderer/data/hooks/usePreference'
import { useAgentSessionCompaction } from '@renderer/hooks/agent/useAgentSessionCompaction'
import { useAgentSessionContextUsage } from '@renderer/hooks/agent/useAgentSessionContextUsage'
import { type Topic, TopicType, type TopicType as TopicTypeEnum } from '@renderer/types/topic'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import { resolveInlineFilePath } from '@renderer/utils/filePath'
import { cn } from '@renderer/utils/style'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import {
  Activity,
  Bot,
  CheckCircle,
  Circle,
  FileText,
  FolderOpen,
  GitBranch,
  Loader2,
  Package,
  Waypoints
} from 'lucide-react'
import type { ReactNode } from 'react'
import { createContext, memo, use, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAgentMessageListProviderValue } from '../../messages/agentMessageListAdapter'
import {
  type AgentRightPaneStatus,
  type AgentStatusTask,
  type AgentSubagent,
  type AgentToolFlowOpenInput,
  buildAgentRightPaneStatus,
  buildAgentToolFlowProjection
} from './agentRightPaneProjection'

// ── Agent-specific composition over the generic right panel ─────────────────

const FLOW_TAB_PREFIX = 'flow:'
const MAX_FLOW_TAB_TITLE_LENGTH = 32
const FALLBACK_TIMESTAMP = '1970-01-01T00:00:00.000Z'

function getFlowTabValue(toolCallId: string): string {
  return `${FLOW_TAB_PREFIX}${toolCallId}`
}

function getFlowTabTitle(input: AgentToolFlowOpenInput): string {
  const title = input.title?.trim() || input.toolName?.trim() || input.toolCallId
  return title.length > MAX_FLOW_TAB_TITLE_LENGTH ? `${title.slice(0, MAX_FLOW_TAB_TITLE_LENGTH - 3)}...` : title
}

interface AgentFlowTab {
  toolCallId: string
  toolName?: string
  title: string
}

interface AgentRightPaneMeta {
  sessionId?: string
  sessionName?: string
  /** Container-level trace id for the session. When developer mode is on, the Trace tab renders this trace tree. */
  traceId?: string
  agentId?: string
  agentName?: string
  agentAvatar?: string
  conversationState: AgentConversationState
  workspaceId?: string
  workspacePath?: string
}

interface AgentRightPaneRuntime {
  messages: CherryUIMessage[]
  partsByMessageId: Record<string, CherryMessagePart[]>
}

interface AgentRightPaneFileState {
  previewFileSelection: ArtifactPaneFileSelection | null
  selectedFile: string | null
  fileTreeExpandedIds: ReadonlySet<string>
  fileTreeSearchKeyword: string
}

interface AgentRightPaneActions {
  canOpenAgentToolFlow: boolean
  canOpenArtifactFile: boolean
  openAgentToolFlow: (input: AgentToolFlowOpenInput) => void
  openArtifactFile: (path: string) => void
  closeFilePreview: () => void
  setSelectedFile: (file: string | null) => void
  setFileTreeExpandedIds: (ids: ReadonlySet<string>) => void
  setFileTreeSearchKeyword: (keyword: string) => void
}

interface AgentRightPanelScope {
  developerMode: boolean
  filesTitle: string
  flowTab: AgentFlowTab | null
  meta: AgentRightPaneMeta
  resourcePane: ResourcePaneConfig | null
  statusTitle: string
  traceTitle: string
}

type AgentConversationState = 'pending' | 'ready' | 'unavailable'

interface AgentRightPaneScopeProps extends Omit<AgentRightPaneMeta, 'conversationState'> {
  children: ReactNode
  conversationState?: AgentConversationState
  /** Controls effective presentation without clearing panel intent. */
  present?: boolean
  resourcePane?: ResourcePaneConfig | null
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  revealRequest?: ResourceListRevealRequest
  messages: CherryUIMessage[]
  partsByMessageId: Record<string, CherryMessagePart[]>
}

const AgentRightPaneMetaContext = createContext<AgentRightPaneMeta | null>(null)
const AgentRightPaneRuntimeContext = createContext<AgentRightPaneRuntime | null>(null)
const AgentRightPaneFileStateContext = createContext<AgentRightPaneFileState | null>(null)
const AgentRightPaneActionsContext = createContext<AgentRightPaneActions | null>(null)

function useAgentRightPaneMeta(): AgentRightPaneMeta {
  const value = use(AgentRightPaneMetaContext)
  if (!value) throw new Error('useAgentRightPaneMeta must be used within <AgentRightPane.Scope>')
  return value
}

function useAgentRightPaneRuntime(): AgentRightPaneRuntime {
  const value = use(AgentRightPaneRuntimeContext)
  if (!value) throw new Error('useAgentRightPaneRuntime must be used within <AgentRightPane.Scope>')
  return value
}

function useAgentRightPaneFileState(): AgentRightPaneFileState {
  const value = use(AgentRightPaneFileStateContext)
  if (!value) throw new Error('useAgentRightPaneFileState must be used within <AgentRightPane.Scope>')
  return value
}

export function useAgentRightPaneActions(): AgentRightPaneActions {
  const value = use(AgentRightPaneActionsContext)
  if (!value) throw new Error('useAgentRightPaneActions must be used within <AgentRightPane.Scope>')
  return value
}

interface AgentRightPaneActionsProviderProps {
  children: ReactNode
  conversationState: AgentConversationState
  sessionId?: string
  workspacePath?: string
  replaceFlowTab: (input: AgentToolFlowOpenInput) => void
  closeFilePreview: () => void
  selectFile: (file: string | null) => void
  setPreviewFileSelection: (selection: ArtifactPaneFileSelection | null) => void
  setSelectedFile: (file: string | null) => void
  setFileTreeExpandedIds: (ids: ReadonlySet<string>) => void
  setFileTreeSearchKeyword: (keyword: string) => void
}

function AgentRightPaneActionsProvider({
  children,
  conversationState,
  sessionId,
  workspacePath,
  replaceFlowTab,
  closeFilePreview,
  selectFile,
  setPreviewFileSelection,
  setSelectedFile,
  setFileTreeExpandedIds,
  setFileTreeSearchKeyword
}: AgentRightPaneActionsProviderProps) {
  const panelActions = useRightPanelActions()
  const canOpenAgentToolFlow = conversationState === 'ready' && Boolean(sessionId)
  const canOpenArtifactFile = Boolean(workspacePath) && panelActions.canOpen('files')
  const openAgentToolFlow = useCallback(
    (input: AgentToolFlowOpenInput) => {
      if (!canOpenAgentToolFlow) return
      replaceFlowTab(input)
      panelActions.requestOpen(getFlowTabValue(input.toolCallId))
    },
    [canOpenAgentToolFlow, panelActions, replaceFlowTab]
  )
  const openArtifactFile = useCallback(
    (path: string) => {
      if (!canOpenArtifactFile) return
      const selection = resolveArtifactPaneFileSelection(workspacePath, resolveInlineFilePath(path))
      if (!selection) return
      setPreviewFileSelection(selection)
      setSelectedFile(selection.workspacePath === workspacePath ? selection.filePath : null)
      panelActions.tryOpen('files')
    },
    [canOpenArtifactFile, panelActions, setPreviewFileSelection, setSelectedFile, workspacePath]
  )
  const actions = useMemo<AgentRightPaneActions>(
    () => ({
      canOpenAgentToolFlow,
      canOpenArtifactFile,
      openAgentToolFlow,
      openArtifactFile,
      closeFilePreview,
      setSelectedFile: selectFile,
      setFileTreeExpandedIds,
      setFileTreeSearchKeyword
    }),
    [
      canOpenAgentToolFlow,
      canOpenArtifactFile,
      closeFilePreview,
      openAgentToolFlow,
      openArtifactFile,
      selectFile,
      setFileTreeExpandedIds,
      setFileTreeSearchKeyword
    ]
  )

  return <AgentRightPaneActionsContext value={actions}>{children}</AgentRightPaneActionsContext>
}

function AgentRightPaneStateProvider({
  children,
  workspaceId,
  workspacePath,
  messages,
  partsByMessageId,
  sessionId,
  sessionName,
  traceId,
  agentId,
  agentName,
  agentAvatar,
  conversationState = 'ready',
  present = true,
  resourcePane = null,
  defaultOpen = false,
  onOpenChange,
  revealRequest
}: AgentRightPaneScopeProps) {
  const { t } = useTranslation()
  const [enableDeveloperMode] = usePreference('app.developer_mode.enabled')
  const [flowTabState, setFlowTabState] = useState<{ sessionId?: string; tab: AgentFlowTab | null }>(() => ({
    sessionId,
    tab: null
  }))
  const [previewFileSelection, setPreviewFileSelection] = useState<ArtifactPaneFileSelection | null>(null)
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [fileTreeExpandedIds, setFileTreeExpandedIds] = useState<ReadonlySet<string>>(() => new Set())
  const [fileTreeSearchKeyword, setFileTreeSearchKeyword] = useState('')
  const workspaceKey = `${workspaceId ?? ''}\0${workspacePath ?? ''}`
  const previousWorkspaceKeyRef = useRef(workspaceKey)
  const flowTab = flowTabState.sessionId === sessionId ? flowTabState.tab : null
  const runtime = useMemo<AgentRightPaneRuntime>(() => ({ messages, partsByMessageId }), [messages, partsByMessageId])

  useEffect(() => {
    setFlowTabState((current) => (current.sessionId === sessionId ? current : { sessionId, tab: null }))
  }, [sessionId])

  const replaceFlowTab = useCallback(
    (input: AgentToolFlowOpenInput) => {
      const nextTab: AgentFlowTab = {
        toolCallId: input.toolCallId,
        toolName: input.toolName,
        title: getFlowTabTitle(input)
      }
      setFlowTabState({ sessionId, tab: nextTab })
    },
    [sessionId]
  )

  const selectFile = useCallback(
    (file: string | null) => {
      setPreviewFileSelection(file && workspacePath ? { workspacePath, filePath: file } : null)
      setSelectedFile(file)
    },
    [workspacePath]
  )

  useLayoutEffect(() => {
    if (previousWorkspaceKeyRef.current === workspaceKey) return
    previousWorkspaceKeyRef.current = workspaceKey
    setSelectedFile(null)
    setPreviewFileSelection(null)
    setFileTreeExpandedIds(new Set())
    setFileTreeSearchKeyword('')
  }, [workspaceKey])

  const closeFilePreview = useCallback(() => {
    setPreviewFileSelection(null)
    setSelectedFile(null)
  }, [])

  const fileState = useMemo<AgentRightPaneFileState>(
    () => ({
      previewFileSelection,
      selectedFile,
      fileTreeExpandedIds,
      fileTreeSearchKeyword
    }),
    [fileTreeExpandedIds, fileTreeSearchKeyword, previewFileSelection, selectedFile]
  )
  const meta = useMemo<AgentRightPaneMeta>(
    () => ({
      sessionId,
      sessionName,
      traceId,
      agentId,
      agentName,
      agentAvatar,
      conversationState,
      workspaceId,
      workspacePath
    }),
    [agentAvatar, agentId, agentName, conversationState, sessionId, sessionName, traceId, workspaceId, workspacePath]
  )
  const scope = useMemo<AgentRightPanelScope>(
    () => ({
      developerMode: enableDeveloperMode,
      filesTitle: t('agent.right_pane.tabs.files'),
      flowTab,
      meta,
      resourcePane,
      statusTitle: t('agent.right_pane.tabs.status'),
      traceTitle: t('trace.label')
    }),
    [enableDeveloperMode, flowTab, meta, resourcePane, t]
  )

  return (
    <ResourcePaneProvider value={resourcePane}>
      <AgentRightPaneMetaContext value={meta}>
        <AgentRightPaneFileStateContext value={fileState}>
          <AgentRightPaneRuntimeContext value={runtime}>
            <RightPanelProvider
              capabilities={AGENT_RIGHT_PANEL_CAPABILITIES}
              scope={scope}
              defaultPanelId={RESOURCE_PANE_TAB}
              defaultOpen={defaultOpen}
              onOpenChange={onOpenChange}
              present={present}>
              <ResourcePaneLocateOpener revealRequest={revealRequest} />
              <AgentRightPaneActionsProvider
                conversationState={conversationState}
                sessionId={sessionId}
                workspacePath={workspacePath}
                replaceFlowTab={replaceFlowTab}
                closeFilePreview={closeFilePreview}
                selectFile={selectFile}
                setPreviewFileSelection={setPreviewFileSelection}
                setSelectedFile={setSelectedFile}
                setFileTreeExpandedIds={setFileTreeExpandedIds}
                setFileTreeSearchKeyword={setFileTreeSearchKeyword}>
                {children}
              </AgentRightPaneActionsProvider>
            </RightPanelProvider>
          </AgentRightPaneRuntimeContext>
        </AgentRightPaneFileStateContext>
      </AgentRightPaneMetaContext>
    </ResourcePaneProvider>
  )
}

function AgentResourceRightPanel({ scope }: RightPanelComponentProps<AgentRightPanelScope>) {
  return scope.resourcePane?.node ?? null
}

function AgentRightPaneFilesPanel({ active }: RightPanelComponentProps<AgentRightPanelScope>) {
  const state = useAgentRightPaneFileState()
  const actions = useAgentRightPaneActions()
  const meta = useAgentRightPaneMeta()
  const panelState = useRightPanelState()
  const lastSelectableFileRef = useRef<string | null>(null)
  const model = useArtifactFileTreeModel({
    workspacePath: meta.workspacePath,
    treeOpen: meta.conversationState === 'ready' && active,
    expandedIds: state.fileTreeExpandedIds,
    searchKeyword: state.fileTreeSearchKeyword,
    enableFileSearch: true,
    selectedFile: state.selectedFile,
    onExpandedIdsChange: actions.setFileTreeExpandedIds
  })

  // This subscription belongs to the files capability: message/status updates
  // cannot reach it, and filesystem updates cannot reach the other panels.
  useEffect(() => {
    if (!state.selectedFile || !model.hasLoaded) {
      if (!state.selectedFile) lastSelectableFileRef.current = null
      return
    }
    if (isSelectableFileNode(model.nodeById, state.selectedFile)) {
      lastSelectableFileRef.current = state.selectedFile
      return
    }
    if (lastSelectableFileRef.current !== state.selectedFile) return
    if (
      state.previewFileSelection &&
      state.previewFileSelection.workspacePath === meta.workspacePath &&
      state.previewFileSelection.filePath === state.selectedFile
    ) {
      actions.closeFilePreview()
      return
    }
    lastSelectableFileRef.current = null
    actions.setSelectedFile(null)
  }, [actions, meta.workspacePath, model.hasLoaded, model.nodeById, state.previewFileSelection, state.selectedFile])

  return (
    <ArtifactPaneView
      workspacePath={meta.workspacePath}
      previewFileSelection={state.previewFileSelection}
      onPreviewClose={actions.closeFilePreview}
      pdfLayoutPending={panelState.pdfLayoutPending}
      pdfLayoutRefreshKey={panelState.pdfLayoutRefreshKey}
      enableFileSearch
      model={model}
      selectedFile={state.selectedFile}
      onSelectedFileChange={actions.setSelectedFile}
      searchKeyword={state.fileTreeSearchKeyword}
      onSearchKeywordChange={actions.setFileTreeSearchKeyword}
    />
  )
}

const AgentToolFlowMessageList = memo(function AgentToolFlowMessageList({
  messages,
  partsByMessageId
}: {
  messages: CherryUIMessage[]
  partsByMessageId: Record<string, CherryMessagePart[]>
}) {
  const actions = useAgentRightPaneActions()
  const meta = useAgentRightPaneMeta()
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
    isLoading: false,
    hasOlder: false,
    openAgentToolFlow: actions.openAgentToolFlow,
    openArtifactFile: actions.openArtifactFile,
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
})

function AgentFlowRightPanel({ active, panelId, scope }: RightPanelComponentProps<AgentRightPanelScope>) {
  const runtime = useAgentRightPaneRuntime()
  const { t } = useTranslation()
  const tab = scope.flowTab && getFlowTabValue(scope.flowTab.toolCallId) === panelId ? scope.flowTab : null
  const retainedFlowRef = useRef<ReturnType<typeof buildAgentToolFlowProjection> | null>(null)
  const flow = useMemo(
    () =>
      !active && retainedFlowRef.current
        ? retainedFlowRef.current
        : buildAgentToolFlowProjection(runtime.messages, runtime.partsByMessageId, tab?.toolCallId),
    [active, runtime.messages, runtime.partsByMessageId, tab?.toolCallId]
  )
  useLayoutEffect(() => {
    if (active) retainedFlowRef.current = flow
  }, [active, flow])

  if (!tab) return null

  if (!flow.messages.length) {
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
      <AgentToolFlowMessageList messages={flow.messages} partsByMessageId={flow.partsByMessageId} />
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

function useAgentRightPaneStatus(active = true): AgentRightPaneStatus {
  const runtime = useAgentRightPaneRuntime()
  const retainedStatusRef = useRef<AgentRightPaneStatus | null>(null)
  const status = useMemo(
    () =>
      !active && retainedStatusRef.current
        ? retainedStatusRef.current
        : buildAgentRightPaneStatus(runtime.messages, runtime.partsByMessageId),
    [active, runtime.messages, runtime.partsByMessageId]
  )
  useLayoutEffect(() => {
    if (active) retainedStatusRef.current = status
  }, [active, status])
  return status
}

function AgentStatusRightPanel({ active }: RightPanelComponentProps<AgentRightPanelScope>) {
  const meta = useAgentRightPaneMeta()
  const { t } = useTranslation()
  const status = useAgentRightPaneStatus(active)
  const { usage, percentage } = useAgentSessionContextUsage(meta.sessionId)
  const compaction = useAgentSessionCompaction(meta.sessionId)
  const isCompacting = compaction.status === 'compacting'
  const contextUsageColor = percentage === null ? undefined : getAgentContextUsageColor(percentage)

  return (
    <div className="h-full space-y-4 overflow-auto p-3 text-sm">
      {status.tasks.length > 0 && (
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
          <div className="space-y-1.5">
            {status.tasks.map((task) => (
              <div
                key={task.id}
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
        </section>
      )}

      <ContextUsageSummary
        usage={usage}
        percentage={percentage}
        color={contextUsageColor}
        isCompacting={isCompacting}
        className="rounded-md border border-border-subtle px-3 py-2"
      />
      <AgentRightPaneHighlights status={status} includeTasks={false} />
    </div>
  )
}

function AgentTraceRightPanel({ scope }: RightPanelComponentProps<AgentRightPanelScope>) {
  const traceTopicId = scope.meta.sessionId ? buildAgentSessionTopicId(scope.meta.sessionId) : ''
  return <TracePane payload={{ topicId: traceTopicId, traceId: scope.meta.traceId ?? '' }} />
}

function resolveAgentFilesReadiness(scope: AgentRightPanelScope): RightPanelReadiness {
  if (scope.meta.conversationState !== 'ready') return scope.meta.conversationState
  return scope.meta.workspacePath ? 'ready' : 'unavailable'
}

function resolveAgentTraceReadiness(scope: AgentRightPanelScope): RightPanelReadiness {
  if (!scope.developerMode || scope.meta.conversationState === 'unavailable') return 'unavailable'
  if (scope.meta.conversationState === 'pending') return 'pending'
  return scope.meta.sessionId ? 'ready' : 'unavailable'
}

/** Stable capability registry; runtime messages are intentionally absent. */
const AGENT_RIGHT_PANEL_CAPABILITIES = [
  {
    component: AgentResourceRightPanel,
    resolve: (scope) => ({
      id: RESOURCE_PANE_TAB,
      instanceKey: 'agent-resources',
      title: scope.resourcePane?.label,
      readiness: scope.resourcePane ? 'ready' : 'unavailable'
    })
  },
  {
    component: AgentRightPaneFilesPanel,
    resolve: (scope) => ({
      id: 'files',
      instanceKey: `workspace:${scope.meta.workspaceId ?? ''}\0${scope.meta.workspacePath ?? ''}`,
      title: scope.filesTitle,
      readiness: resolveAgentFilesReadiness(scope),
      canMaximize: true
    })
  },
  {
    component: AgentStatusRightPanel,
    resolve: (scope) => ({
      id: 'status',
      instanceKey: `session:${scope.meta.sessionId ?? ''}`,
      title: scope.statusTitle,
      readiness: scope.meta.conversationState
    })
  },
  {
    component: AgentTraceRightPanel,
    resolve: (scope) => ({
      id: 'trace',
      instanceKey: `session:${scope.meta.sessionId ?? ''}:trace:${scope.meta.traceId ?? ''}`,
      title: scope.traceTitle,
      readiness: resolveAgentTraceReadiness(scope)
    })
  },
  {
    component: AgentFlowRightPanel,
    resolve: (scope) => {
      const tab = scope.flowTab
      if (!tab) return null
      return {
        id: getFlowTabValue(tab.toolCallId),
        instanceKey: `session:${scope.meta.sessionId ?? ''}:flow:${tab.toolCallId}`,
        title: tab.title,
        readiness: scope.meta.conversationState
      }
    }
  }
] satisfies readonly RightPanelCapability<AgentRightPanelScope>[]

const AgentRightPaneViewport = memo(function AgentRightPaneViewport() {
  return (
    <RightPanelViewport>
      <RightPanel />
    </RightPanelViewport>
  )
})

function SubagentStatusIcon({ status }: { status: AgentSubagent['status'] }) {
  switch (status) {
    case 'done':
      return <CheckCircle size={14} className="text-success" />
    case 'error':
      return <Circle size={14} className="text-destructive" />
    case 'running':
    default:
      return <Loader2 size={14} className="animate-spin text-info" />
  }
}

function AgentRightPaneHighlightSection({
  title,
  icon,
  compact,
  children
}: {
  title: string
  icon: ReactNode
  compact: boolean
  children: ReactNode
}) {
  return (
    <section
      className={cn(
        'space-y-1.5',
        compact
          ? 'border-border-subtle border-t pt-2.5 first:border-t-0 first:pt-0'
          : 'rounded-md border border-border-subtle px-3 py-2'
      )}>
      <h3 className="flex items-center gap-1.5 font-medium text-foreground text-xs">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  )
}

function AgentRightPaneHighlights({
  status,
  compact = false,
  includeTasks = true
}: {
  status: AgentRightPaneStatus
  compact?: boolean
  includeTasks?: boolean
}) {
  const actions = useAgentRightPaneActions()
  const { t } = useTranslation()
  const tasks = includeTasks ? status.tasks : []
  const artifacts = actions.canOpenArtifactFile ? status.artifacts : []
  const hasHighlights = tasks.length > 0 || status.subagents.length > 0 || artifacts.length > 0

  if (!hasHighlights) return null

  return (
    <div className={cn('space-y-2.5', compact ? 'text-xs' : 'text-sm')}>
      {tasks.length > 0 && (
        <AgentRightPaneHighlightSection
          title={t('agent.right_pane.status.tasks')}
          icon={<Activity size={14} className="text-muted-foreground" />}
          compact={compact}>
          <ul className="space-y-1">
            {tasks.map((task) => (
              <li key={task.id} className="flex min-w-0 items-start gap-2">
                <TaskStatusIcon status={task.status} />
                <span
                  className={cn(
                    'wrap-break-word min-w-0 flex-1 text-xs leading-5',
                    task.status === 'completed' ? 'text-muted-foreground line-through' : 'text-foreground-secondary'
                  )}>
                  {task.status === 'in_progress' && task.activeText ? task.activeText : task.title}
                </span>
              </li>
            ))}
          </ul>
        </AgentRightPaneHighlightSection>
      )}

      {status.subagents.length > 0 && (
        <AgentRightPaneHighlightSection
          title={t('agent.right_pane.info.subagents')}
          icon={<Bot size={14} className="text-muted-foreground" />}
          compact={compact}>
          <ul className="space-y-1">
            {status.subagents.map((subagent) => (
              <li key={subagent.toolCallId} className="flex min-w-0 items-start gap-2">
                <SubagentStatusIcon status={subagent.status} />
                <span className="wrap-break-word min-w-0 flex-1 text-foreground-secondary text-xs leading-5">
                  {subagent.name}
                </span>
              </li>
            ))}
          </ul>
        </AgentRightPaneHighlightSection>
      )}

      {artifacts.length > 0 && (
        <AgentRightPaneHighlightSection
          title={t('agent.right_pane.info.artifacts')}
          icon={<Package size={14} className="text-muted-foreground" />}
          compact={compact}>
          <ul className="space-y-0.5">
            {artifacts.map((artifact) => (
              <li key={`${artifact.toolCallId}-${artifact.path}`}>
                <button
                  type="button"
                  onClick={() => actions.openArtifactFile(artifact.path)}
                  title={artifact.path}
                  className="flex w-full min-w-0 items-center gap-1.5 rounded-md px-1 py-1 text-left text-foreground-secondary transition-colors hover:bg-foreground/5 hover:text-foreground">
                  <FileText size={14} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate text-xs">{artifact.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </AgentRightPaneHighlightSection>
      )}
    </div>
  )
}

// Hover-card preview body. Lives inside HoverCardContent so it mounts only when the card opens.
// Reads the same persisted usage data the Status tab renders.
function AgentRightPaneStatusPreview() {
  const meta = useAgentRightPaneMeta()
  const status = useAgentRightPaneStatus()
  const { usage, percentage } = useAgentSessionContextUsage(meta.sessionId)
  const compaction = useAgentSessionCompaction(meta.sessionId)
  const isCompacting = compaction.status === 'compacting'
  const contextUsageColor = percentage === null ? undefined : getAgentContextUsageColor(percentage)

  return (
    <Scrollbar className="-mr-2 max-h-[calc(70vh-1.5rem)] space-y-3 overflow-x-hidden pr-3">
      <ContextUsageSummary
        usage={usage}
        percentage={percentage}
        color={contextUsageColor}
        isCompacting={isCompacting}
      />
      <AgentRightPaneHighlights status={status} compact />
    </Scrollbar>
  )
}

function AgentRightPaneStatusShortcut({ disabled }: { disabled?: boolean }) {
  const panelState = useRightPanelState()
  const panelActions = useRightPanelActions()
  const { t } = useTranslation()
  if (disabled || panelState.presentationMaximized || !panelActions.canOpen('status')) return null

  const shortcut = (
    <RightPanelShortcut
      tab="status"
      label={t('agent.right_pane.tabs.status')}
      icon={<Activity className="size-3.5" />}
      tooltip={false}
    />
  )

  if (panelState.presentationOpen) return shortcut

  return (
    <HoverCard openDelay={150} closeDelay={100}>
      <HoverCardTrigger asChild>{shortcut}</HoverCardTrigger>
      <HoverCardContent align="end" sideOffset={8} className="w-80 overflow-hidden p-3">
        <AgentRightPaneStatusPreview />
      </HoverCardContent>
    </HoverCard>
  )
}

const AgentRightPaneShortcuts = memo(function AgentRightPaneShortcuts() {
  const { t } = useTranslation()

  return (
    <>
      <RightPanelShortcut
        tab="files"
        label={t('agent.right_pane.tabs.files')}
        icon={<FolderOpen className="size-3.5" />}
      />
      <AgentRightPaneStatusShortcut />
      <RightPanelShortcut tab="trace" label={t('trace.label')} icon={<Waypoints className="size-3.5" />} />
    </>
  )
})

export const AgentRightPane = {
  Scope: AgentRightPaneStateProvider,
  Viewport: AgentRightPaneViewport,
  Shortcuts: AgentRightPaneShortcuts
}

export type { AgentToolFlowOpenInput }
