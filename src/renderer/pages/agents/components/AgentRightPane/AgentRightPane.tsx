import { Badge, HoverCard, HoverCardContent, HoverCardTrigger } from '@cherrystudio/ui'
import { EmptyState } from '@renderer/components/chat'
import { ContextUsageSummary, getAgentContextUsageColor } from '@renderer/components/chat/agent/ContextUsageSummary'
import MessageList from '@renderer/components/chat/messages/MessageList'
import { MessageListProvider } from '@renderer/components/chat/messages/MessageListProvider'
import { resolveInlineFilePath } from '@renderer/components/chat/messages/utils/filePath'
import ArtifactPane, {
  ArtifactFilePreview,
  isOfficeDocumentFile,
  resolveArtifactPaneFileSelection
} from '@renderer/components/chat/panes/ArtifactPane'
import OpenExternalAppButton from '@renderer/components/chat/panes/OpenExternalAppButton'
import { Shell, useShellActions, useShellState } from '@renderer/components/chat/panes/Shell'
import { useWindowFrame } from '@renderer/components/chat/shell/WindowFrameContext'
import { TracePane } from '@renderer/components/chat/trace/TracePane'
import NavbarIcon from '@renderer/components/NavbarIcon'
import Scrollbar from '@renderer/components/Scrollbar'
import { useIsActiveTab } from '@renderer/context/TabIdContext'
import { usePreference } from '@renderer/data/hooks/usePreference'
import { useAgentSessionCompaction } from '@renderer/hooks/agents/useAgentSessionCompaction'
import { useAgentSessionContextUsage } from '@renderer/hooks/agents/useAgentSessionContextUsage'
import { useFileSize } from '@renderer/hooks/useFileSize'
import { useIsTextFile } from '@renderer/hooks/useIsTextFile'
import type { Topic, TopicType as TopicTypeEnum } from '@renderer/types'
import { TopicType } from '@renderer/types'
import { cn } from '@renderer/utils'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import type { CherryMessagePart, CherryUIMessage, ModelSnapshot } from '@shared/data/types/message'
import {
  Activity,
  Bot,
  CheckCircle,
  Circle,
  FileText,
  FolderOpen,
  GitBranch,
  Info,
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
const FILE_PREVIEW_TAB = 'file-preview'
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

function getFilePreviewTitle(filePath: string): string {
  const segments = filePath
    .trim()
    .split(/[/\\]+/)
    .filter(Boolean)
  return segments.at(-1) ?? filePath
}

function isFramedFilePreview(filePath: string): boolean {
  return /\.(html?|pdf)$/i.test(filePath)
}

interface AgentFlowTab {
  toolCallId: string
  toolName?: string
  title: string
}

interface AgentFilePreviewTab {
  workspacePath: string
  filePath: string
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
  modelFallback?: ModelSnapshot
}

interface AgentRightPaneState {
  flowTabs: AgentFlowTab[]
  activeFlowTab?: AgentFlowTab
  flow: ReturnType<typeof buildAgentToolFlowProjection>
  status: AgentRightPaneStatus
  filePreview: AgentFilePreviewTab | null
  selectedFile: string | null
  fileTreeOpen: boolean
  fileTreeExpandedIds: ReadonlySet<string>
  fileTreeSearchKeyword: string
  workspacePath?: string
}

interface AgentRightPaneActions {
  openAgentToolFlow: (input: AgentToolFlowOpenInput) => void
  openArtifactFile: (path: string) => void
  closeFilePreview: () => void
  closeFlowTab: (toolCallId: string) => void
  setSelectedFile: (file: string | null) => void
  setFileTreeOpen: (open: boolean) => void
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
  traceId,
  agentId,
  agentName,
  agentAvatar,
  modelFallback
}: AgentRightPaneProviderProps) {
  const { activeTab } = useShellState()
  const { openTab } = useShellActions()
  const [flowTabs, setFlowTabs] = useState<AgentFlowTab[]>([])
  const [filePreview, setFilePreview] = useState<AgentFilePreviewTab | null>(null)
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [fileTreeOpen, setFileTreeOpen] = useState(false)
  const [fileTreeExpandedIds, setFileTreeExpandedIds] = useState<ReadonlySet<string>>(() => new Set())
  const [fileTreeSearchKeyword, setFileTreeSearchKeyword] = useState('')
  const previousWorkspacePathRef = useRef(workspacePath)

  const activeFlowToolCallId = getFlowToolCallId(activeTab)
  const activeFlowTab = activeFlowToolCallId
    ? flowTabs.find((flowTab) => flowTab.toolCallId === activeFlowToolCallId)
    : undefined

  const flow = useMemo(
    () => buildAgentToolFlowProjection(messages, partsByMessageId, activeFlowTab?.toolCallId),
    [activeFlowTab?.toolCallId, messages, partsByMessageId]
  )
  const status = useMemo(() => buildAgentRightPaneStatus(messages, partsByMessageId), [messages, partsByMessageId])

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
      setFilePreview({
        ...selection,
        title: getFilePreviewTitle(selection.filePath)
      })
      openTab(FILE_PREVIEW_TAB)
    },
    [openTab, workspacePath]
  )

  useEffect(() => {
    if (previousWorkspacePathRef.current === workspacePath) return
    previousWorkspacePathRef.current = workspacePath
    setSelectedFile(null)
    setFilePreview(null)
    setFileTreeExpandedIds(new Set())
    setFileTreeSearchKeyword('')
    if (activeTab === FILE_PREVIEW_TAB) openTab('files')
  }, [activeTab, openTab, workspacePath])
  const closeFilePreview = useCallback(() => {
    if (activeTab === FILE_PREVIEW_TAB) openTab('files')
    setFilePreview(null)
  }, [activeTab, openTab])
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
        activeFlowTab,
        flow,
        status,
        filePreview,
        selectedFile,
        fileTreeOpen,
        fileTreeExpandedIds,
        fileTreeSearchKeyword,
        workspacePath
      },
      actions: {
        openAgentToolFlow,
        openArtifactFile,
        closeFilePreview,
        closeFlowTab,
        setSelectedFile,
        setFileTreeOpen,
        setFileTreeExpandedIds,
        setFileTreeSearchKeyword
      },
      meta: { sessionId, sessionName, traceId, agentId, agentName, agentAvatar, modelFallback }
    }),
    [
      activeFlowTab,
      agentAvatar,
      agentId,
      agentName,
      closeFilePreview,
      closeFlowTab,
      fileTreeExpandedIds,
      fileTreeOpen,
      fileTreeSearchKeyword,
      filePreview,
      flow,
      flowTabs,
      modelFallback,
      openArtifactFile,
      openAgentToolFlow,
      selectedFile,
      sessionId,
      sessionName,
      status,
      traceId,
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
      onSelectedFileChange={actions.setSelectedFile}
      fileTreeOpen={state.fileTreeOpen}
      onFileTreeOpenChange={actions.setFileTreeOpen}
      fileTreeExpandedIds={state.fileTreeExpandedIds}
      onFileTreeExpandedIdsChange={actions.setFileTreeExpandedIds}
      fileTreeSearchKeyword={state.fileTreeSearchKeyword}
      onFileTreeSearchKeywordChange={actions.setFileTreeSearchKeyword}
      pdfLayoutRefreshKey={shellState.pdfLayoutRefreshKey}
      enableFileSearch
    />
  )
}

function AgentFilePreviewPanel({ preview }: { preview: AgentFilePreviewTab }) {
  const shellState = useShellState()
  const isOfficeDocumentPreview = isOfficeDocumentFile(preview.filePath)
  const shouldSniffFile = !isOfficeDocumentPreview && !/\.pdf$/i.test(preview.filePath)
  const sniffedIsText = useIsTextFile(preview.workspacePath, preview.filePath, { enabled: shouldSniffFile })
  const isText = shouldSniffFile ? sniffedIsText : 'binary'
  const fileSize = useFileSize(preview.workspacePath, preview.filePath)

  return (
    <div
      className={cn(
        'h-full min-h-0 bg-card text-card-foreground',
        isFramedFilePreview(preview.filePath) ? 'overflow-hidden' : 'overflow-auto'
      )}>
      <ArtifactFilePreview
        workspacePath={preview.workspacePath}
        filePath={preview.filePath}
        isText={isText}
        fileSize={fileSize}
        officeActions={
          isOfficeDocumentPreview ? (
            <OpenExternalAppButton workdir={preview.workspacePath} filePath={preview.filePath} />
          ) : undefined
        }
        pdfLayoutPending={shellState.pdfLayoutPending}
        pdfLayoutRefreshKey={shellState.pdfLayoutRefreshKey}
      />
    </div>
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

function AgentAgentRightPaneStatusPanel() {
  const { state, meta } = useAgentRightPane()
  const { t } = useTranslation()
  const { status } = state
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
  const { t } = useTranslation()
  const [enableDeveloperMode] = usePreference('app.developer_mode.enabled')
  const { mode, chrome } = useWindowFrame()
  const isWindow = mode === 'window'
  const incompleteTasks = state.status.tasks.filter((task) => task.status !== 'completed').length
  const traceTopicId = meta.sessionId ? buildAgentSessionTopicId(meta.sessionId) : ''

  // Mirror TopicRightPaneSurface: while open, the pane absorbs the navbar's right cluster
  // (sub-window controls + pane toggle) so they don't overlap this header.
  const tabListTrailing = (
    <>
      {isWindow ? chrome?.titleTrailing : null}
      <AgentRightPaneFilesToggle />
    </>
  )

  return (
    <Shell.Tabs>
      <Shell.TabList extraTrailing={tabListTrailing}>
        <Shell.Tab
          value="files"
          icon={state.selectedFile ? <FileText className="size-3.5" /> : <FolderOpen className="size-3.5" />}>
          {state.selectedFile ? getFilePreviewTitle(state.selectedFile) : t('agent.right_pane.tabs.files')}
        </Shell.Tab>
        {state.filePreview && (
          <Shell.Tab
            value={FILE_PREVIEW_TAB}
            icon={<FileText className="size-3.5" />}
            onClose={actions.closeFilePreview}>
            {state.filePreview.title}
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
        {enableDeveloperMode && (
          <Shell.Tab value="trace" icon={<Waypoints className="size-3.5" />}>
            {t('trace.label')}
          </Shell.Tab>
        )}
      </Shell.TabList>
      <Shell.Panel value="files" forceMount>
        <AgentRightPaneFilesPanel />
      </Shell.Panel>
      {state.filePreview && (
        <Shell.Panel value={FILE_PREVIEW_TAB}>
          <AgentFilePreviewPanel preview={state.filePreview} />
        </Shell.Panel>
      )}
      {state.flowTabs.map((flowTab) => (
        <Shell.Panel key={flowTab.toolCallId} value={getFlowTabValue(flowTab.toolCallId)}>
          <AgentRightPaneFlowPanel tab={flowTab} />
        </Shell.Panel>
      ))}
      <Shell.Panel value="status" className="overflow-auto">
        <AgentAgentRightPaneStatusPanel />
      </Shell.Panel>
      {enableDeveloperMode && (
        <Shell.Panel value="trace">
          <TracePane payload={{ topicId: traceTopicId, traceId: meta.traceId ?? '' }} />
        </Shell.Panel>
      )}
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

function AgentRightPaneFilesToggle({ disabled }: { disabled?: boolean }) {
  const isActiveTab = useIsActiveTab()
  return <Shell.Toggle tab="files" command="topic.sidebar.toggle" commandEnabled={isActiveTab} disabled={disabled} />
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
  const { state, actions } = useAgentRightPane()
  const { t } = useTranslation()
  const tasks = includeTasks ? state.status.tasks : []
  const hasHighlights = tasks.length > 0 || state.status.subagents.length > 0 || state.status.artifacts.length > 0

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

      {state.status.subagents.length > 0 && (
        <AgentRightPaneHighlightSection
          title={t('agent.right_pane.info.subagents')}
          icon={<Bot size={14} className="text-muted-foreground" />}
          compact={compact}>
          <ul className="space-y-1">
            {state.status.subagents.map((subagent) => (
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

      {state.status.artifacts.length > 0 && (
        <AgentRightPaneHighlightSection
          title={t('agent.right_pane.info.artifacts')}
          icon={<Package size={14} className="text-muted-foreground" />}
          compact={compact}>
          <ul className="space-y-0.5">
            {state.status.artifacts.map((artifact) => (
              <li key={`${artifact.toolCallId}-${artifact.path}`}>
                <button
                  type="button"
                  onClick={() => actions.openArtifactFile(artifact.path)}
                  title={artifact.path}
                  className="flex w-full min-w-0 items-center gap-1.5 rounded-md px-1 py-1 text-left text-primary transition-colors hover:bg-foreground/5">
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
function AgentRightPaneInfoCardBody() {
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

// Shown only in the collapsed state (rendered into ConversationShell's topRightTool, which the shell
// suppresses while the pane is open/maximized). Hover previews the session; click expands to Status.
function AgentRightPaneInfoCard({ disabled }: { disabled?: boolean }) {
  const { openTab } = useShellActions()
  const { t } = useTranslation()
  if (disabled) return null
  return (
    <HoverCard openDelay={150} closeDelay={100}>
      <HoverCardTrigger asChild>
        <NavbarIcon tone="conversation" aria-label={t('agent.right_pane.info.label')} onClick={() => openTab('status')}>
          <Info />
        </NavbarIcon>
      </HoverCardTrigger>
      <HoverCardContent align="end" sideOffset={8} className="w-80 overflow-hidden p-3">
        <AgentRightPaneInfoCardBody />
      </HoverCardContent>
    </HoverCard>
  )
}

// `AgentRightPane` is the provider itself, with the other parts attached as
// statics — used as `<AgentRightPane>` / `<AgentRightPane.Host>`.
export const AgentRightPane = Object.assign(AgentRightPaneProvider, {
  Host: AgentRightPaneHost,
  MaximizedOverlay: AgentRightPaneMaximizedOverlay,
  FilesToggle: AgentRightPaneFilesToggle,
  InfoCard: AgentRightPaneInfoCard
})

export type { AgentToolFlowOpenInput }
