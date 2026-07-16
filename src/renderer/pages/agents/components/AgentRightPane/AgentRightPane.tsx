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
  ResourcePanePanel,
  ResourcePaneProvider,
  ResourcePaneTab,
  Shell,
  useResourcePane,
  useShellActions,
  useShellState
} from '@renderer/components/chat/panes/Shell'
import {
  type ArtifactFileTreeModel,
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
import { useCommandHandler } from '@renderer/hooks/command'
import { useIsActiveTab } from '@renderer/hooks/tab'
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
import { createContext, use, useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  filesEnabled?: boolean
  statusEnabled?: boolean
}

interface AgentRightPaneState {
  flowTabs: AgentFlowTab[]
  previewFileSelection: ArtifactPaneFileSelection | null
  selectedFile: string | null
  fileTreeExpandedIds: ReadonlySet<string>
  fileTreeSearchKeyword: string
  workspaceId?: string
  workspacePath?: string
}

interface AgentRightPaneActions {
  openAgentToolFlow: (input: AgentToolFlowOpenInput) => void
  openArtifactFile: (path: string) => void
  closeFilePreview: () => void
  closeFlowTab: (toolCallId: string) => void
  setSelectedFile: (file: string | null) => void
  setFileTreeExpandedIds: (ids: ReadonlySet<string>) => void
  setFileTreeSearchKeyword: (keyword: string) => void
}

interface AgentRightPaneContextValue {
  state: AgentRightPaneState
  actions: AgentRightPaneActions
  meta: AgentRightPaneMeta
}

interface AgentRightPaneProviderProps extends AgentRightPaneMeta {
  children: ReactNode
  /** In classic layout the session list mounts as the first right-pane tab; null leaves files/status/flow. */
  resourcePane?: ResourcePaneConfig | null
  revealRequest?: ResourceListRevealRequest
  defaultOpen?: boolean
  /** Persist open state across the per-branch Shell remount (draft→persistent handoff). */
  onOpenChange?: (open: boolean) => void
  workspaceId?: string
  workspacePath?: string
  messages: CherryUIMessage[]
  partsByMessageId: Record<string, CherryMessagePart[]>
}

const AgentRightPaneContext = createContext<AgentRightPaneContextValue | null>(null)
const AgentRightPaneProjectionSourceContext = createContext<{
  messages: CherryUIMessage[]
  partsByMessageId: Record<string, CherryMessagePart[]>
} | null>(null)
const AgentRightPaneStatusContext = createContext<AgentRightPaneStatus | null>(null)
const EMPTY_AGENT_RIGHT_PANE_STATUS: AgentRightPaneStatus = {
  tasks: [],
  completedTaskCount: 0,
  totalTaskCount: 0,
  subagents: [],
  artifacts: []
}

function useAgentRightPane(): AgentRightPaneContextValue {
  const value = use(AgentRightPaneContext)
  if (!value) throw new Error('useAgentRightPane must be used within <AgentRightPane>')
  return value
}

function useAgentRightPaneProjectionSource() {
  const value = use(AgentRightPaneProjectionSourceContext)
  if (!value) throw new Error('useAgentRightPaneProjectionSource must be used within <AgentRightPane>')
  return value
}

function useAgentRightPaneStatus(): AgentRightPaneStatus {
  const value = use(AgentRightPaneStatusContext)
  if (!value) throw new Error('useAgentRightPaneStatus must be used within <AgentRightPaneStatusProjectionProvider>')
  return value
}

function AgentRightPaneStatusProjectionProvider({ children }: { children: ReactNode }) {
  const { messages, partsByMessageId } = useAgentRightPaneProjectionSource()
  const { meta } = useAgentRightPane()
  const status = useMemo(
    () =>
      meta.statusEnabled === false
        ? EMPTY_AGENT_RIGHT_PANE_STATUS
        : buildAgentRightPaneStatus(messages, partsByMessageId),
    [messages, meta.statusEnabled, partsByMessageId]
  )

  return <AgentRightPaneStatusContext value={status}>{children}</AgentRightPaneStatusContext>
}

// The workspace file-tree model lives in its own context so its frequent
// updates (every lazy-load tick produces a fresh `filteredTree`) only re-render
// the files panel, not the status/flow/info panels reading the main context.
const AgentFileTreeModelContext = createContext<ArtifactFileTreeModel | null>(null)

function useAgentFileTreeModel(): ArtifactFileTreeModel {
  const value = use(AgentFileTreeModelContext)
  if (!value) throw new Error('useAgentFileTreeModel must be used within <AgentRightPane>')
  return value
}

export function useAgentRightPaneActions(): AgentRightPaneActions {
  return useAgentRightPane().actions
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
  filesEnabled = true,
  statusEnabled = true
}: AgentRightPaneProviderProps) {
  const shellState = useShellState()
  const { activeTab } = shellState
  const { openTab } = useShellActions()
  const [flowTabs, setFlowTabs] = useState<AgentFlowTab[]>([])
  const [previewFileSelection, setPreviewFileSelection] = useState<ArtifactPaneFileSelection | null>(null)
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [fileTreeExpandedIds, setFileTreeExpandedIds] = useState<ReadonlySet<string>>(() => new Set())
  const [fileTreeSearchKeyword, setFileTreeSearchKeyword] = useState('')
  const workspaceKey = `${workspaceId ?? ''}\0${workspacePath ?? ''}`
  const previousWorkspaceKeyRef = useRef(workspaceKey)
  const lastSelectableFileRef = useRef<string | null>(null)
  const fileTreeModelOpen = filesEnabled !== false && shellState.open && activeTab === 'files'

  // Built once here (the provider survives the Host↔Overlay maximize swap), so
  // maximize/minimize no longer remounts + rematerializes the workspace tree.
  const fileTreeModel = useArtifactFileTreeModel({
    workspacePath,
    treeOpen: fileTreeModelOpen,
    expandedIds: fileTreeExpandedIds,
    searchKeyword: fileTreeSearchKeyword,
    enableFileSearch: true,
    selectedFile,
    onExpandedIdsChange: setFileTreeExpandedIds
  })
  // Stable callback for effect deps (the model object itself is new each render).
  const { resetLazyChildren: resetFileTreeLazyChildren } = fileTreeModel

  const openAgentToolFlow = useCallback(
    (input: AgentToolFlowOpenInput) => {
      const nextTab: AgentFlowTab = {
        toolCallId: input.toolCallId,
        toolName: input.toolName,
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
  const openArtifactFile = useCallback(
    (path: string) => {
      const selection = resolveArtifactPaneFileSelection(workspacePath, resolveInlineFilePath(path))
      if (!selection) return
      setPreviewFileSelection(selection)
      if (selection.workspacePath === workspacePath) {
        setSelectedFile(selection.filePath)
      } else {
        setSelectedFile(null)
      }
      openTab('files')
    },
    [openTab, workspacePath]
  )

  const selectFile = useCallback(
    (file: string | null) => {
      setPreviewFileSelection(file && workspacePath ? { workspacePath, filePath: file } : null)
      setSelectedFile(file)
    },
    [workspacePath]
  )

  useEffect(() => {
    if (previousWorkspaceKeyRef.current === workspaceKey) return
    previousWorkspaceKeyRef.current = workspaceKey
    setSelectedFile(null)
    setPreviewFileSelection(null)
    setFileTreeExpandedIds(new Set())
    setFileTreeSearchKeyword('')
    lastSelectableFileRef.current = null
    // The lazy-children map now lives in the surviving provider, so its reset on
    // workspace change must be explicit (previously it rode the pane remount).
    resetFileTreeLazyChildren()
  }, [resetFileTreeLazyChildren, workspaceKey])

  // Drop a selection that no longer resolves to a file in the loaded tree
  // (e.g. the watcher reported it removed).
  useEffect(() => {
    if (!selectedFile || !fileTreeModel.hasLoaded) {
      if (!selectedFile) lastSelectableFileRef.current = null
      return
    }
    if (isSelectableFileNode(fileTreeModel.nodeById, selectedFile)) {
      lastSelectableFileRef.current = selectedFile
      return
    }
    if (lastSelectableFileRef.current !== selectedFile) return
    if (
      previewFileSelection &&
      previewFileSelection.workspacePath === workspacePath &&
      previewFileSelection.filePath === selectedFile
    ) {
      setPreviewFileSelection(null)
    }
    lastSelectableFileRef.current = null
    setSelectedFile(null)
  }, [fileTreeModel.hasLoaded, fileTreeModel.nodeById, previewFileSelection, selectedFile, workspacePath])
  const closeFilePreview = useCallback(() => {
    setPreviewFileSelection(null)
    setSelectedFile(null)
  }, [])
  const closeFlowTab = useCallback(
    (toolCallId: string) => {
      setFlowTabs((currentTabs) => currentTabs.filter((tab) => tab.toolCallId !== toolCallId))
      if (getFlowToolCallId(activeTab) === toolCallId) openTab('files')
    },
    [activeTab, openTab]
  )

  const value = useMemo<AgentRightPaneContextValue>(
    () => ({
      state: {
        flowTabs,
        previewFileSelection,
        selectedFile,
        fileTreeExpandedIds,
        fileTreeSearchKeyword,
        workspaceId,
        workspacePath
      },
      actions: {
        openAgentToolFlow,
        openArtifactFile,
        closeFilePreview,
        closeFlowTab,
        setSelectedFile: selectFile,
        setFileTreeExpandedIds,
        setFileTreeSearchKeyword
      },
      meta: {
        sessionId,
        sessionName,
        traceId,
        agentId,
        agentName,
        agentAvatar,
        filesEnabled,
        statusEnabled
      }
    }),
    [
      agentAvatar,
      agentId,
      agentName,
      closeFilePreview,
      closeFlowTab,
      fileTreeExpandedIds,
      fileTreeSearchKeyword,
      filesEnabled,
      flowTabs,
      openArtifactFile,
      openAgentToolFlow,
      previewFileSelection,
      selectFile,
      selectedFile,
      sessionId,
      sessionName,
      statusEnabled,
      traceId,
      workspaceId,
      workspacePath
    ]
  )

  const projectionSource = useMemo(() => ({ messages, partsByMessageId }), [messages, partsByMessageId])

  return (
    <AgentRightPaneProjectionSourceContext value={projectionSource}>
      <AgentRightPaneContext value={value}>
        <AgentFileTreeModelContext value={fileTreeModel}>{children}</AgentFileTreeModelContext>
      </AgentRightPaneContext>
    </AgentRightPaneProjectionSourceContext>
  )
}

function AgentRightPaneProvider(props: AgentRightPaneProviderProps) {
  const { children, resourcePane, revealRequest, defaultOpen = false, onOpenChange, ...rest } = props
  const shellModeKey = resourcePane ? 'resource-pane' : 'files-pane'

  return (
    <Shell
      key={shellModeKey}
      defaultTab={resourcePane ? RESOURCE_PANE_TAB : 'files'}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}>
      <ResourcePaneProvider value={resourcePane ?? null}>
        <ResourcePaneLocateOpener revealRequest={revealRequest} />
        <AgentRightPaneStateProvider {...rest}>{children}</AgentRightPaneStateProvider>
      </ResourcePaneProvider>
    </Shell>
  )
}

function AgentRightPaneFilesPanel() {
  const { state, actions } = useAgentRightPane()
  const model = useAgentFileTreeModel()
  const shellState = useShellState()
  return (
    <ArtifactPaneView
      workspacePath={state.workspacePath}
      previewFileSelection={state.previewFileSelection}
      onPreviewClose={actions.closeFilePreview}
      pdfLayoutPending={shellState.pdfLayoutPending}
      pdfLayoutRefreshKey={shellState.pdfLayoutRefreshKey}
      enableFileSearch
      model={model}
      selectedFile={state.selectedFile}
      onSelectedFileChange={actions.setSelectedFile}
      searchKeyword={state.fileTreeSearchKeyword}
      onSearchKeywordChange={actions.setFileTreeSearchKeyword}
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
}

function ActiveAgentRightPaneFlowPanel({ tab }: { tab: AgentFlowTab }) {
  const { messages, partsByMessageId } = useAgentRightPaneProjectionSource()
  const { t } = useTranslation()
  const flow = useMemo(
    () => buildAgentToolFlowProjection(messages, partsByMessageId, tab.toolCallId),
    [messages, partsByMessageId, tab.toolCallId]
  )

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

function AgentRightPaneFlowPanel({ tab }: { tab: AgentFlowTab }) {
  const { activeTab } = useShellState()

  // Only the active flow tab drives the projection, so skip stale siblings.
  if (activeTab !== getFlowTabValue(tab.toolCallId)) return null

  return <ActiveAgentRightPaneFlowPanel tab={tab} />
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

function AgentAgentRightPaneStatusPanel() {
  const { meta } = useAgentRightPane()
  const { t } = useTranslation()
  const status = useAgentRightPaneStatus()
  const { usage, percentage } = useAgentSessionContextUsage(meta.sessionId)
  const compaction = useAgentSessionCompaction(meta.sessionId)
  const isCompacting = compaction.status === 'compacting'
  const contextUsageColor = percentage === null ? undefined : getAgentContextUsageColor(percentage)

  return (
    <div className="space-y-4 p-3 text-sm">
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
      <AgentRightPaneHighlights includeTasks={false} />
    </div>
  )
}

function AgentRightPaneSurface() {
  const { state, actions, meta } = useAgentRightPane()
  const status = useAgentRightPaneStatus()
  const { t } = useTranslation()
  const [enableDeveloperMode] = usePreference('app.developer_mode.enabled')
  const shellState = useShellState()
  const incompleteTasks = Math.max(0, status.totalTaskCount - status.completedTaskCount)
  const traceTopicId = meta.sessionId ? buildAgentSessionTopicId(meta.sessionId) : ''
  const hasFiles = meta.filesEnabled !== false
  const resourcePane = useResourcePane()
  const hasStatus = meta.statusEnabled !== false
  const hasTrace = enableDeveloperMode && !!traceTopicId
  const activeFlowTab = state.flowTabs.find((tab) => getFlowTabValue(tab.toolCallId) === shellState.activeTab)
  const activeTitle =
    shellState.activeTab === RESOURCE_PANE_TAB && resourcePane
      ? resourcePane.label
      : shellState.activeTab === 'files'
        ? t('agent.right_pane.tabs.files')
        : shellState.activeTab === 'status'
          ? t('agent.right_pane.tabs.status')
          : shellState.activeTab === 'trace'
            ? t('trace.label')
            : (activeFlowTab?.title ?? t('agent.right_pane.tabs.files'))

  return (
    <Shell.Tabs>
      <Shell.TabList title={activeTitle} showTabs={false}>
        <ResourcePaneTab />
        {hasFiles && (
          <Shell.Tab value="files" icon={<FolderOpen className="size-3.5" />}>
            {t('agent.right_pane.tabs.files')}
          </Shell.Tab>
        )}
        {state.flowTabs.map((flowTab) => (
          <Shell.Tab
            key={flowTab.toolCallId}
            value={getFlowTabValue(flowTab.toolCallId)}
            icon={<GitBranch className="size-3.5" />}
            onClose={() => actions.closeFlowTab(flowTab.toolCallId)}>
            {flowTab.title}
          </Shell.Tab>
        ))}
        {hasStatus && (
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
        )}
        {hasTrace && (
          <Shell.Tab value="trace" icon={<Waypoints className="size-3.5" />}>
            {t('trace.label')}
          </Shell.Tab>
        )}
      </Shell.TabList>
      <ResourcePanePanel />
      {hasFiles && (
        <Shell.Panel value="files" forceMount>
          <AgentRightPaneFilesPanel />
        </Shell.Panel>
      )}
      {state.flowTabs.map((flowTab) => (
        <Shell.Panel key={flowTab.toolCallId} value={getFlowTabValue(flowTab.toolCallId)}>
          <AgentRightPaneFlowPanel tab={flowTab} />
        </Shell.Panel>
      ))}
      {hasStatus && (
        <Shell.Panel value="status" className="overflow-auto">
          <AgentAgentRightPaneStatusPanel />
        </Shell.Panel>
      )}
      {hasTrace && (
        <Shell.Panel value="trace">
          <TracePane payload={{ topicId: traceTopicId, traceId: meta.traceId ?? '' }} />
        </Shell.Panel>
      )}
    </Shell.Tabs>
  )
}

function AgentRightPaneKeyboardShortcut() {
  const { meta } = useAgentRightPane()
  const resourcePane = useResourcePane()
  const { open } = useShellState()
  const actions = useShellActions()
  const isActiveTab = useIsActiveTab()
  const hasFiles = meta.filesEnabled !== false
  const targetTab = resourcePane ? RESOURCE_PANE_TAB : 'files'
  const enabled = isActiveTab && Boolean(resourcePane || hasFiles)
  const handleToggle = useCallback(() => {
    if (open) {
      actions.close()
      return
    }
    actions.openTab(targetTab)
  }, [actions, open, targetTab])

  useCommandHandler('topic.sidebar.toggle', handleToggle, { enabled })

  return null
}

function AgentRightPaneHost() {
  return (
    <>
      <AgentRightPaneKeyboardShortcut />
      <Shell.Host>
        <AgentRightPaneStatusProjectionProvider>
          <AgentRightPaneSurface />
        </AgentRightPaneStatusProjectionProvider>
      </Shell.Host>
    </>
  )
}

function AgentRightPaneMaximizedOverlay() {
  return (
    <Shell.MaximizedOverlay>
      <AgentRightPaneStatusProjectionProvider>
        <AgentRightPaneSurface />
      </AgentRightPaneStatusProjectionProvider>
    </Shell.MaximizedOverlay>
  )
}

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
  compact = false,
  includeTasks = true
}: {
  compact?: boolean
  includeTasks?: boolean
}) {
  const { actions } = useAgentRightPane()
  const status = useAgentRightPaneStatus()
  const { t } = useTranslation()
  const tasks = includeTasks ? status.tasks : []
  const hasHighlights = tasks.length > 0 || status.subagents.length > 0 || status.artifacts.length > 0

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

      {status.artifacts.length > 0 && (
        <AgentRightPaneHighlightSection
          title={t('agent.right_pane.info.artifacts')}
          icon={<Package size={14} className="text-muted-foreground" />}
          compact={compact}>
          <ul className="space-y-0.5">
            {status.artifacts.map((artifact) => (
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
  const { meta } = useAgentRightPane()
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
      <AgentRightPaneHighlights compact />
    </Scrollbar>
  )
}

function AgentRightPaneStatusShortcut({ disabled }: { disabled?: boolean }) {
  const shellState = useShellState()
  const { t } = useTranslation()
  if (disabled || shellState.maximized) return null

  const shortcut = (
    <Shell.TabShortcut
      tab="status"
      label={t('agent.right_pane.tabs.status')}
      icon={<Activity className="size-3.5" />}
      tooltip={false}
      openBehavior="toggle-active"
    />
  )

  if (shellState.open) return shortcut

  return (
    <HoverCard openDelay={150} closeDelay={100}>
      <HoverCardTrigger asChild>{shortcut}</HoverCardTrigger>
      <HoverCardContent align="end" sideOffset={8} className="w-80 overflow-hidden p-3">
        <AgentRightPaneStatusProjectionProvider>
          <AgentRightPaneStatusPreview />
        </AgentRightPaneStatusProjectionProvider>
      </HoverCardContent>
    </HoverCard>
  )
}

function AgentRightPaneShortcuts() {
  const { meta } = useAgentRightPane()
  const { t } = useTranslation()
  const [enableDeveloperMode] = usePreference('app.developer_mode.enabled')
  const hasFiles = meta.filesEnabled !== false
  const hasStatus = meta.statusEnabled !== false
  const traceTopicId = meta.sessionId ? buildAgentSessionTopicId(meta.sessionId) : ''
  const hasTrace = enableDeveloperMode && !!traceTopicId

  return (
    <>
      {hasFiles && (
        <Shell.TabShortcut
          tab="files"
          label={t('agent.right_pane.tabs.files')}
          icon={<FolderOpen className="size-3.5" />}
          openBehavior="toggle-active"
        />
      )}
      {hasStatus && <AgentRightPaneStatusShortcut />}
      {hasTrace && (
        <Shell.TabShortcut
          tab="trace"
          label={t('trace.label')}
          icon={<Waypoints className="size-3.5" />}
          openBehavior="toggle-active"
        />
      )}
    </>
  )
}

// `AgentRightPane` is the provider itself, with the other parts attached as
// statics — used as `<AgentRightPane>` / `<AgentRightPane.Host>`.
export const AgentRightPane = Object.assign(AgentRightPaneProvider, {
  Host: AgentRightPaneHost,
  MaximizedOverlay: AgentRightPaneMaximizedOverlay,
  Shortcuts: AgentRightPaneShortcuts
})

export type { AgentToolFlowOpenInput }
