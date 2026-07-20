import { usePreference } from '@data/hooks/usePreference'
import CitationsPanel from '@renderer/components/chat/citations/CitationsPanel'
import {
  type ResourcePaneConfig,
  ResourcePaneCountButton,
  type ResourcePaneCountButtonProps
} from '@renderer/components/chat/panes/Shell'
import { EmptyState } from '@renderer/components/chat/primitives'
import type { ResourceListRevealRequest } from '@renderer/components/chat/resourceList/base'
import ConversationCenterState from '@renderer/components/chat/shell/ConversationCenterState'
import { ConversationGreeting } from '@renderer/components/chat/shell/ConversationGreeting'
import type { ConversationCenterSlot } from '@renderer/components/chat/shell/ConversationPageShell'
import ConversationShell from '@renderer/components/chat/shell/ConversationShell'
import ConversationStageCenter from '@renderer/components/chat/shell/ConversationStageCenter'
import type { ChatPanePosition } from '@renderer/components/chat/shell/paneLayout'
import { MissingAgentHomeComposer } from '@renderer/components/composer/variants/AgentComposer'
import { useCache } from '@renderer/data/hooks/useCache'
import { useAgent } from '@renderer/hooks/agent/useAgent'
import type { AgentSessionSource } from '@renderer/hooks/agent/useSession'
import type { GetAgentResponse } from '@renderer/types/agent'
import type { Citation } from '@renderer/types/message'
import { getAgentAvatarFromConfiguration } from '@renderer/utils/agent'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import { cn } from '@renderer/utils/style'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import AgentChatMain from './AgentChatMain'
import AgentComposerSlot from './AgentComposerSlot'
import { AgentChatNavbar } from './components/AgentChatNavbar'
import { AgentRightPane } from './components/AgentRightPane'
import { locateAgentMessageInList } from './messages/agentMessageListAdapter'
import type { CreateAgentSessionDefaults } from './types'
import { type AgentChatRuntimeState, useAgentChatRuntimeState } from './useAgentChatRuntimeState'

const EMPTY_MESSAGES: CherryUIMessage[] = []
const EMPTY_PARTS: Record<string, CherryMessagePart[]> = {}

function getNewSessionWorkspaceDefaults(
  session: AgentSessionEntity
): Pick<CreateAgentSessionDefaults, 'workspaceId' | 'workspaceMode'> {
  if (session.workspace?.type === 'system') {
    return { workspaceMode: 'system' }
  }
  return session.workspaceId ? { workspaceId: session.workspaceId } : {}
}

interface AgentChatProps {
  centerSurface?: ConversationCenterSlot | null
  pane?: ReactNode
  paneOpen?: boolean
  panePosition?: ChatPanePosition
  activeSession?: AgentSessionEntity | null
  activeSessionLoading?: boolean
  activeSessionSource?: AgentSessionSource
  lockedSession?: AgentSessionEntity | null
  lockedSessionLoading?: boolean
  showResourceListControls?: boolean
  sidebarOpen?: boolean
  onSidebarToggle?: () => void
  locateMessageId?: string
  onLocateMessageHandled?: () => void
  onPaneCollapse?: () => void
  onPaneAutoCollapseChange?: (collapsed: boolean) => void
  missingAgentSelection?: boolean
  onCreateEmptySession?: (defaults?: CreateAgentSessionDefaults) => void | Promise<unknown>
  onMissingAgentSelectionAgentChange?: (agentId: string | null) => void | Promise<void>
  onSessionWorkspaceChange?: (workspaceId: string | null) => void | Promise<void>
  onVisibleAgentChange?: (agentId: string) => void
  onVisibleWorkspaceChange?: (workspaceId: string) => void
  selectingMissingAgent?: boolean
  replacingSessionWorkspace?: boolean
  resourcePane?: ResourcePaneConfig | null
  resourcePaneCount?: ResourcePaneCountButtonProps
  resourcePaneRevealRequest?: ResourceListRevealRequest
  sessionPaneOpen?: boolean
  onSessionPaneOpenChange?: (open: boolean) => void
}

interface AgentChatLayoutProps {
  activeAgent?: GetAgentResponse
  center?: ReactNode
  centerClassName?: string
  centerSurface?: ConversationCenterSlot | null
  className?: string
  conversationState: 'pending' | 'ready' | 'unavailable'
  messages: CherryUIMessage[]
  onPaneAutoCollapseChange?: (collapsed: boolean) => void
  onPaneCollapse?: () => void
  pane?: ReactNode
  paneOpen?: boolean
  panePosition?: ChatPanePosition
  partsByMessageId: Record<string, CherryMessagePart[]>
  resourcePane?: ResourcePaneConfig | null
  resourcePaneRevealRequest?: ResourceListRevealRequest
  rightPanelDefaultOpen?: boolean
  onRightPanelOpenChange?: (open: boolean) => void
  sessionSnapshot: AgentSessionEntity | null
  sidePanel?: ReactNode
  topBar?: ReactNode
  topRightTool?: ReactNode
}

const AgentChat = ({
  centerSurface,
  pane,
  paneOpen,
  panePosition,
  activeSession,
  activeSessionLoading = false,
  activeSessionSource = 'none',
  lockedSession,
  lockedSessionLoading = false,
  showResourceListControls = true,
  sidebarOpen,
  onSidebarToggle,
  locateMessageId,
  onLocateMessageHandled,
  onPaneCollapse,
  onPaneAutoCollapseChange,
  missingAgentSelection = false,
  onCreateEmptySession,
  onMissingAgentSelectionAgentChange,
  onSessionWorkspaceChange,
  onVisibleAgentChange,
  onVisibleWorkspaceChange,
  selectingMissingAgent,
  replacingSessionWorkspace,
  resourcePane,
  resourcePaneCount,
  resourcePaneRevealRequest,
  sessionPaneOpen,
  onSessionPaneOpenChange
}: AgentChatProps) => {
  const { t } = useTranslation()
  const [messageStyle] = usePreference('chat.message.style')
  const [isMultiSelectMode] = useCache('chat.multi_select_mode')
  const [citationPanelCitations, setCitationPanelCitations] = useState<Citation[] | null>(null)

  const hasLockedSession = lockedSession !== undefined
  const sessionSnapshot = hasLockedSession ? (lockedSession ?? null) : (activeSession ?? null)
  const visibleAgentId = sessionSnapshot?.agentId ?? null
  const visibleWorkspaceId = sessionSnapshot?.workspaceId ?? null
  const visibleWorkspace = sessionSnapshot?.workspace ?? null
  const { agent: activeAgent } = useAgent(visibleAgentId)

  useEffect(() => {
    if (visibleAgentId) onVisibleAgentChange?.(visibleAgentId)
  }, [onVisibleAgentChange, visibleAgentId])
  useEffect(() => {
    if (visibleWorkspaceId && visibleWorkspace?.type !== 'system') onVisibleWorkspaceChange?.(visibleWorkspaceId)
  }, [onVisibleWorkspaceChange, visibleWorkspace, visibleWorkspaceId])

  const handleOpenCitationsPanel = useCallback(({ citations }: { citations: Citation[] }) => {
    setCitationPanelCitations(citations)
  }, [])

  const isInitializing = !sessionSnapshot && (hasLockedSession ? lockedSessionLoading : activeSessionLoading)
  const citationsPanelOpen = citationPanelCitations !== null
  const conversationState = sessionSnapshot ? 'ready' : isInitializing ? 'pending' : 'unavailable'
  const sessionAgentId = sessionSnapshot?.agentId ?? null
  const sendableAgentId = activeAgent && sessionAgentId ? sessionAgentId : undefined
  const shouldFetchSessionHistoryOnMount = Boolean(
    sessionSnapshot &&
      (activeSessionSource === 'query' ||
        activeSessionSource === 'pending' ||
        (!!activeSession && activeSessionSource === 'none'))
  )
  const sessionMessagesEnabled = Boolean(sessionSnapshot && activeSession && activeSession.id === sessionSnapshot.id)
  const runtime = useAgentChatRuntimeState({
    sessionId: sessionSnapshot?.id ?? '',
    sessionMessagesEnabled,
    sessionHistoryFetchOnMount: shouldFetchSessionHistoryOnMount,
    reservedMessages: EMPTY_MESSAGES
  })
  const {
    hasOlder: runtimeHasOlder,
    isLoading: runtimeIsLoading,
    loadOlder: runtimeLoadOlder,
    sessionId: runtimeSessionId,
    uiMessages: runtimeUiMessages
  } = runtime
  const locateLoadRequestRef = useRef<string | undefined>(undefined)
  const sessionTopicId = runtimeSessionId ? buildAgentSessionTopicId(runtimeSessionId) : ''

  useEffect(() => {
    if (!runtimeSessionId || !locateMessageId) {
      locateLoadRequestRef.current = undefined
      return
    }

    if (runtimeUiMessages.some((message) => message.id === locateMessageId)) {
      locateLoadRequestRef.current = undefined
      window.requestAnimationFrame(() => {
        locateAgentMessageInList(sessionTopicId, locateMessageId, true)
      })
      onLocateMessageHandled?.()
      return
    }

    if (runtimeHasOlder && !runtimeIsLoading) {
      const requestKey = `${runtimeSessionId}:${locateMessageId}:${runtimeUiMessages.length}`
      if (locateLoadRequestRef.current !== requestKey) {
        locateLoadRequestRef.current = requestKey
        runtimeLoadOlder?.()
      }
      return
    }

    if (!runtimeHasOlder && !runtimeIsLoading) {
      locateLoadRequestRef.current = undefined
      onLocateMessageHandled?.()
    }
  }, [
    locateMessageId,
    onLocateMessageHandled,
    runtimeHasOlder,
    runtimeIsLoading,
    runtimeLoadOlder,
    runtimeSessionId,
    runtimeUiMessages,
    sessionTopicId
  ])
  const rightPaneTools =
    !centerSurface && (sessionSnapshot || resourcePane) ? (
      <>
        {resourcePaneCount && <ResourcePaneCountButton {...resourcePaneCount} />}
        <AgentRightPane.Shortcuts />
      </>
    ) : undefined
  let topBar: ReactNode
  let center: ReactNode
  let sidePanel: ReactNode
  let centerClassName = centerSurface?.className

  if (centerSurface) {
    center = centerSurface.content
  } else if (isInitializing) {
    center = <ConversationCenterState state="loading" />
  } else if (!sessionSnapshot && hasLockedSession) {
    center = <EmptyState compact className="h-full" title={t('agent.session.get.error.not_found')} />
  } else if (!sessionSnapshot && missingAgentSelection) {
    const composer = !isMultiSelectMode ? (
      <MissingAgentHomeComposer
        onAgentChange={onMissingAgentSelectionAgentChange}
        agentChanging={selectingMissingAgent}
      />
    ) : undefined
    topBar = (
      <AgentChatNavbar
        activeAgent={null}
        showSidebarControls={showResourceListControls}
        sidebarOpen={sidebarOpen}
        onSidebarToggle={onSidebarToggle}
      />
    )
    center = <ConversationStageCenter placement="docked" main={null} composer={composer} />
  } else if (!sessionSnapshot) {
    center = <ConversationCenterState state="empty" />
  } else {
    topBar = (
      <AgentChatNavbar
        className="min-w-0"
        activeAgent={activeAgent ?? null}
        showSidebarControls={showResourceListControls}
        sidebarOpen={sidebarOpen}
        onSidebarToggle={onSidebarToggle}
      />
    )
    sidePanel = (
      <CitationsPanel
        open={citationsPanelOpen}
        onClose={() => setCitationPanelCitations(null)}
        citations={citationPanelCitations ?? []}
      />
    )
    centerClassName = 'transform-[translateZ(0)] relative justify-between'
    center = (
      <AgentChatSessionCenter
        key={sessionSnapshot.id}
        session={sessionSnapshot}
        runtime={runtime}
        homeWelcomeText={t('agent.home.welcome_title')}
        agentId={sendableAgentId}
        activeAgent={activeAgent}
        isMultiSelectMode={isMultiSelectMode}
        sessionMessagesEnabled={sessionMessagesEnabled}
        onOpenCitationsPanel={handleOpenCitationsPanel}
        onWorkspaceChange={onSessionWorkspaceChange}
        workspaceChanging={replacingSessionWorkspace}
        onCreateEmptySession={
          sessionAgentId && onCreateEmptySession
            ? () =>
                onCreateEmptySession({
                  agentId: sessionAgentId,
                  ...getNewSessionWorkspaceDefaults(sessionSnapshot)
                })
            : undefined
        }
      />
    )
  }

  const layoutProps: AgentChatLayoutProps = {
    activeAgent,
    center,
    centerClassName,
    centerSurface,
    className: cn(messageStyle, {
      'multi-select-mode': Boolean(!centerSurface && sessionSnapshot && isMultiSelectMode)
    }),
    conversationState,
    messages: sessionSnapshot ? runtime.uiMessages : EMPTY_MESSAGES,
    onPaneAutoCollapseChange,
    onPaneCollapse,
    pane,
    paneOpen,
    panePosition,
    partsByMessageId: sessionSnapshot ? runtime.partsByMessageId : EMPTY_PARTS,
    resourcePane,
    resourcePaneRevealRequest,
    rightPanelDefaultOpen: sessionPaneOpen,
    onRightPanelOpenChange: onSessionPaneOpenChange,
    sessionSnapshot,
    sidePanel,
    topBar,
    topRightTool: rightPaneTools
  }

  return <AgentChatLayout {...layoutProps} />
}

interface AgentChatSessionCenterProps {
  session: AgentSessionEntity
  runtime: AgentChatRuntimeState
  homeWelcomeText?: string
  agentId?: string
  activeAgent: GetAgentResponse | undefined
  isMultiSelectMode: boolean
  sessionMessagesEnabled: boolean
  onOpenCitationsPanel: (payload: { citations: Citation[] }) => void
  onCreateEmptySession?: () => void | Promise<unknown>
  onWorkspaceChange?: (workspaceId: string | null) => void | Promise<void>
  workspaceChanging?: boolean
}

const AgentChatSessionCenter = ({
  session,
  runtime,
  homeWelcomeText,
  agentId,
  activeAgent,
  isMultiSelectMode,
  sessionMessagesEnabled,
  onOpenCitationsPanel,
  onCreateEmptySession,
  onWorkspaceChange,
  workspaceChanging
}: AgentChatSessionCenterProps) => {
  const { hasOlder, isLoading, uiMessages } = runtime
  // `sessionMessagesEnabled` guards the locked/active session transition window,
  // where messages are force-disabled (empty + not loading) and would otherwise
  // read as an empty conversation.
  const isEmptyConversation =
    sessionMessagesEnabled && !isLoading && !runtime.isPending && !hasOlder && uiMessages.length === 0
  const canChangeWorkspace = Boolean(onWorkspaceChange && isEmptyConversation)

  const composer = (
    <AgentComposerSlot
      agentId={agentId}
      isMultiSelectMode={isMultiSelectMode}
      session={session}
      sessionId={runtime.sessionId}
      sendMessage={runtime.sendMessage}
      stop={runtime.stop}
      isStreaming={runtime.isPending}
      sendDisabled={false}
      onCreateEmptySession={onCreateEmptySession}
      canChangeAgent={isEmptyConversation}
      workspaceId={session.workspace?.type === 'system' ? null : session.workspaceId}
      onWorkspaceChange={canChangeWorkspace ? onWorkspaceChange : undefined}
      workspaceChanging={workspaceChanging}
      composerContext={runtime.composerContext}
    />
  )
  const main = (
    <div className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      {isEmptyConversation && (
        <div className="pointer-events-none absolute inset-0 z-10">
          <ConversationGreeting
            avatar={activeAgent ? getAgentAvatarFromConfiguration(activeAgent.configuration) : undefined}
            title={homeWelcomeText ?? ''}
          />
        </div>
      )}
      <AgentChatMain
        placement="docked"
        sessionMessagesEnabled={sessionMessagesEnabled}
        agentId={agentId}
        sessionId={runtime.sessionId}
        messages={runtime.uiMessages}
        activeAgent={activeAgent}
        partsByMessageId={runtime.partsByMessageId}
        streamingLayers={runtime.streamingLayers}
        optimisticAskUserQuestionInputsByToolCallId={runtime.optimisticAskUserQuestionInputsByToolCallId}
        isLoading={runtime.isLoading}
        hasOlder={runtime.hasOlder}
        loadOlder={runtime.loadOlder}
        onOpenCitationsPanel={onOpenCitationsPanel}
        deleteMessage={runtime.deleteMessage}
        respondToolApproval={runtime.respondToolApproval}
      />
    </div>
  )

  return <ConversationStageCenter placement="docked" main={main} composer={composer} />
}

function AgentChatLayout({
  activeAgent,
  center,
  centerClassName,
  centerSurface,
  className,
  conversationState,
  messages,
  onPaneAutoCollapseChange,
  onPaneCollapse,
  pane,
  paneOpen,
  panePosition,
  partsByMessageId,
  resourcePane,
  resourcePaneRevealRequest,
  rightPanelDefaultOpen,
  onRightPanelOpenChange,
  sessionSnapshot,
  sidePanel,
  topBar,
  topRightTool
}: AgentChatLayoutProps) {
  return (
    <AgentRightPane.Scope
      conversationState={conversationState}
      workspaceId={sessionSnapshot?.workspaceId}
      workspacePath={sessionSnapshot?.workspace?.path}
      messages={messages}
      partsByMessageId={partsByMessageId}
      resourcePane={resourcePane}
      defaultOpen={rightPanelDefaultOpen}
      onOpenChange={onRightPanelOpenChange}
      sessionId={sessionSnapshot?.id}
      sessionName={sessionSnapshot?.name}
      traceId={sessionSnapshot?.traceId ?? undefined}
      agentId={sessionSnapshot?.agentId ?? undefined}
      agentName={activeAgent?.name}
      agentAvatar={activeAgent ? getAgentAvatarFromConfiguration(activeAgent.configuration) : undefined}
      present={!centerSurface}
      revealRequest={resourcePaneRevealRequest}>
      <ConversationShell
        className={className}
        pane={pane}
        paneOpen={paneOpen}
        panePosition={panePosition}
        onPaneCollapse={onPaneCollapse}
        onPaneAutoCollapseChange={onPaneAutoCollapseChange}
        topBar={topBar}
        topRightTool={topRightTool}
        showTopRightToolWhenPaneOpen
        center={center}
        sidePanel={sidePanel}
        rightPane={<AgentRightPane.Viewport />}
        centerId={centerSurface?.id}
        centerRef={centerSurface?.ref}
        centerClassName={centerClassName}
      />
    </AgentRightPane.Scope>
  )
}

export default AgentChat
