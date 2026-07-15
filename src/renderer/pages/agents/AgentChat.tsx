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
import ConversationShell, { type ConversationCenterSurface } from '@renderer/components/chat/shell/ConversationShell'
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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import AgentChatMain from './AgentChatMain'
import AgentComposerSlot from './AgentComposerSlot'
import { AgentChatNavbar } from './components/AgentChatNavbar'
import { AgentRightPane } from './components/AgentRightPane'
import { locateAgentMessageInList } from './messages/agentMessageListAdapter'
import type { CreateAgentSessionDefaults } from './types'
import { useAgentChatRuntimeState } from './useAgentChatRuntimeState'

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
  centerSurface?: ConversationCenterSurface | null
}

const AgentChat = ({
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
  onSessionPaneOpenChange,
  centerSurface
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
  const resourcePaneTopRightTool = resourcePane ? (
    <>
      {resourcePaneCount && <ResourcePaneCountButton {...resourcePaneCount} openBehavior="toggle-active" />}
      <AgentRightPane.Shortcuts />
    </>
  ) : undefined

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

  if (isInitializing) {
    return (
      <AgentRightPane
        filesEnabled={false}
        statusEnabled={false}
        workspaceId={visibleWorkspaceId ?? undefined}
        workspacePath={visibleWorkspace?.path}
        messages={EMPTY_MESSAGES}
        partsByMessageId={EMPTY_PARTS}
        defaultOpen={sessionPaneOpen}
        onOpenChange={onSessionPaneOpenChange}
        resourcePane={resourcePane}
        revealRequest={resourcePaneRevealRequest}>
        <ConversationShell
          className={messageStyle}
          pane={pane}
          paneOpen={paneOpen}
          panePosition={panePosition}
          centerSurface={centerSurface}
          onPaneCollapse={onPaneCollapse}
          onPaneAutoCollapseChange={onPaneAutoCollapseChange}
          topRightTool={resourcePaneTopRightTool}
          showTopRightToolWhenPaneOpen
          center={<ConversationCenterState state="loading" />}
          centerOverlay={resourcePane ? <AgentRightPane.MaximizedOverlay /> : undefined}
          rightPane={<AgentRightPane.Host />}
        />
      </AgentRightPane>
    )
  }

  if (!sessionSnapshot) {
    if (hasLockedSession) {
      return (
        <ConversationShell
          className={messageStyle}
          pane={pane}
          paneOpen={paneOpen}
          panePosition={panePosition}
          centerSurface={centerSurface}
          onPaneCollapse={onPaneCollapse}
          onPaneAutoCollapseChange={onPaneAutoCollapseChange}
          center={<EmptyState compact className="h-full" title={t('agent.session.get.error.not_found')} />}
        />
      )
    }
    if (missingAgentSelection) {
      const composer = !isMultiSelectMode ? (
        <MissingAgentHomeComposer
          onAgentChange={onMissingAgentSelectionAgentChange}
          agentChanging={selectingMissingAgent}
        />
      ) : undefined

      const shell = (
        <ConversationShell
          className={messageStyle}
          pane={pane}
          paneOpen={paneOpen}
          panePosition={panePosition}
          centerSurface={centerSurface}
          onPaneCollapse={onPaneCollapse}
          onPaneAutoCollapseChange={onPaneAutoCollapseChange}
          topBar={
            <AgentChatNavbar
              activeAgent={null}
              showSidebarControls={showResourceListControls}
              sidebarOpen={sidebarOpen}
              onSidebarToggle={onSidebarToggle}
            />
          }
          topRightTool={resourcePaneTopRightTool}
          showTopRightToolWhenPaneOpen
          center={<ConversationStageCenter placement="docked" main={null} composer={composer} />}
          centerOverlay={resourcePane ? <AgentRightPane.MaximizedOverlay /> : undefined}
          rightPane={resourcePane ? <AgentRightPane.Host /> : undefined}
        />
      )
      if (!resourcePane) return shell
      return (
        <AgentRightPane
          filesEnabled={false}
          statusEnabled={false}
          messages={EMPTY_MESSAGES}
          partsByMessageId={EMPTY_PARTS}
          defaultOpen={sessionPaneOpen}
          onOpenChange={onSessionPaneOpenChange}
          resourcePane={resourcePane}
          revealRequest={resourcePaneRevealRequest}>
          {shell}
        </AgentRightPane>
      )
    }
    const shell = (
      <ConversationShell
        className={messageStyle}
        pane={pane}
        paneOpen={paneOpen}
        panePosition={panePosition}
        centerSurface={centerSurface}
        onPaneCollapse={onPaneCollapse}
        onPaneAutoCollapseChange={onPaneAutoCollapseChange}
        topRightTool={resourcePaneTopRightTool}
        showTopRightToolWhenPaneOpen
        center={<ConversationCenterState state="empty" />}
        centerOverlay={resourcePane ? <AgentRightPane.MaximizedOverlay /> : undefined}
        rightPane={resourcePane ? <AgentRightPane.Host /> : undefined}
      />
    )
    if (!resourcePane) return shell
    return (
      <AgentRightPane
        filesEnabled={false}
        statusEnabled={false}
        messages={EMPTY_MESSAGES}
        partsByMessageId={EMPTY_PARTS}
        defaultOpen={sessionPaneOpen}
        onOpenChange={onSessionPaneOpenChange}
        resourcePane={resourcePane}
        revealRequest={resourcePaneRevealRequest}>
        {shell}
      </AgentRightPane>
    )
  }

  const sessionAgentId = sessionSnapshot.agentId ?? null
  const sendableAgentId = activeAgent && sessionAgentId ? sessionAgentId : undefined
  const shouldFetchSessionHistoryOnMount =
    activeSessionSource === 'query' ||
    activeSessionSource === 'pending' ||
    (!!activeSession && activeSessionSource === 'none')
  const sessionMessagesEnabled = !!activeSession && activeSession.id === sessionSnapshot.id
  return (
    <AgentChatSessionFrame
      className={cn(messageStyle, { 'multi-select-mode': isMultiSelectMode })}
      pane={pane}
      paneOpen={paneOpen}
      panePosition={panePosition}
      centerSurface={centerSurface}
      showResourceListControls={showResourceListControls}
      sidebarOpen={sidebarOpen}
      onSidebarToggle={onSidebarToggle}
      session={sessionSnapshot}
      homeWelcomeText={t('agent.home.welcome_title')}
      agentId={sendableAgentId}
      activeAgent={activeAgent}
      isMultiSelectMode={isMultiSelectMode}
      sessionMessagesEnabled={sessionMessagesEnabled}
      sessionHistoryFetchOnMount={shouldFetchSessionHistoryOnMount}
      onOpenCitationsPanel={handleOpenCitationsPanel}
      locateMessageId={locateMessageId}
      onLocateMessageHandled={onLocateMessageHandled}
      onPaneCollapse={onPaneCollapse}
      onPaneAutoCollapseChange={onPaneAutoCollapseChange}
      resourcePane={resourcePane}
      resourcePaneCount={resourcePaneCount}
      resourcePaneRevealRequest={resourcePaneRevealRequest}
      sessionPaneOpen={sessionPaneOpen}
      onSessionPaneOpenChange={onSessionPaneOpenChange}
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
      sidePanel={
        <CitationsPanel
          open={citationsPanelOpen}
          onClose={() => setCitationPanelCitations(null)}
          citations={citationPanelCitations ?? []}
        />
      }
    />
  )
}

// ── Inner: mounted only when agentId + sessionId are resolved ──

interface AgentChatSessionFrameProps {
  className?: string
  pane?: ReactNode
  paneOpen?: boolean
  panePosition?: ChatPanePosition
  showResourceListControls?: boolean
  sidebarOpen?: boolean
  onSidebarToggle?: () => void
  sidePanel?: ReactNode
  session: AgentSessionEntity
  homeWelcomeText?: string
  agentId?: string
  activeAgent: GetAgentResponse | undefined
  isMultiSelectMode: boolean
  sessionMessagesEnabled: boolean
  sessionHistoryFetchOnMount?: boolean
  onOpenCitationsPanel: (payload: { citations: Citation[] }) => void
  locateMessageId?: string
  onLocateMessageHandled?: () => void
  onPaneCollapse?: () => void
  onPaneAutoCollapseChange?: (collapsed: boolean) => void
  onCreateEmptySession?: () => void | Promise<unknown>
  onWorkspaceChange?: (workspaceId: string | null) => void | Promise<void>
  workspaceChanging?: boolean
  resourcePane?: ResourcePaneConfig | null
  resourcePaneCount?: ResourcePaneCountButtonProps
  resourcePaneRevealRequest?: ResourceListRevealRequest
  sessionPaneOpen?: boolean
  onSessionPaneOpenChange?: (open: boolean) => void
  centerSurface?: ConversationCenterSurface | null
}

const AgentChatSessionFrame = ({
  className,
  pane,
  paneOpen,
  panePosition,
  showResourceListControls = true,
  sidebarOpen,
  onSidebarToggle,
  sidePanel,
  session,
  homeWelcomeText,
  agentId,
  activeAgent,
  isMultiSelectMode,
  sessionMessagesEnabled,
  sessionHistoryFetchOnMount,
  onOpenCitationsPanel,
  locateMessageId,
  onLocateMessageHandled,
  onPaneCollapse,
  onPaneAutoCollapseChange,
  onCreateEmptySession,
  onWorkspaceChange,
  workspaceChanging,
  resourcePane,
  resourcePaneCount,
  resourcePaneRevealRequest,
  sessionPaneOpen,
  onSessionPaneOpenChange,
  centerSurface
}: AgentChatSessionFrameProps) => {
  const runtime = useAgentChatRuntimeState({
    session,
    sessionMessagesEnabled,
    sessionHistoryFetchOnMount,
    reservedMessages: EMPTY_MESSAGES
  })
  const sessionTopicId = useMemo(() => buildAgentSessionTopicId(runtime.sessionId), [runtime.sessionId])
  const locateLoadRequestRef = useRef<string | undefined>(undefined)
  // `sessionMessagesEnabled` guards the locked/active session transition window,
  // where messages are force-disabled (empty + not loading) and would otherwise
  // read as an empty conversation.
  const isEmptyConversation =
    sessionMessagesEnabled &&
    !runtime.isLoading &&
    !runtime.isPending &&
    !runtime.hasOlder &&
    runtime.uiMessages.length === 0
  const canChangeWorkspace = Boolean(onWorkspaceChange && isEmptyConversation)

  useEffect(() => {
    if (!locateMessageId) {
      locateLoadRequestRef.current = undefined
      return
    }

    if (runtime.uiMessages.some((message) => message.id === locateMessageId)) {
      locateLoadRequestRef.current = undefined
      window.requestAnimationFrame(() => {
        locateAgentMessageInList(sessionTopicId, locateMessageId, true)
      })
      onLocateMessageHandled?.()
      return
    }

    if (runtime.hasOlder && !runtime.isLoading) {
      const requestKey = `${locateMessageId}:${runtime.uiMessages.length}`
      if (locateLoadRequestRef.current !== requestKey) {
        locateLoadRequestRef.current = requestKey
        runtime.loadOlder?.()
      }
      return
    }

    if (!runtime.hasOlder && !runtime.isLoading) {
      locateLoadRequestRef.current = undefined
      onLocateMessageHandled?.()
    }
  }, [
    locateMessageId,
    onLocateMessageHandled,
    runtime.hasOlder,
    runtime.isLoading,
    runtime.loadOlder,
    runtime.uiMessages,
    sessionTopicId
  ])

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

  return (
    <AgentRightPane
      workspaceId={session.workspaceId}
      workspacePath={session.workspace?.path}
      messages={runtime.uiMessages}
      partsByMessageId={runtime.partsByMessageId}
      sessionId={runtime.sessionId}
      sessionName={session.name}
      traceId={session.traceId ?? undefined}
      agentId={agentId ?? session.agentId ?? undefined}
      agentName={activeAgent?.name}
      agentAvatar={activeAgent ? getAgentAvatarFromConfiguration(activeAgent.configuration) : undefined}
      defaultOpen={sessionPaneOpen}
      onOpenChange={onSessionPaneOpenChange}
      resourcePane={resourcePane}
      revealRequest={resourcePaneRevealRequest}>
      <ConversationShell
        className={className}
        pane={pane}
        paneOpen={paneOpen}
        panePosition={panePosition}
        centerSurface={centerSurface}
        onPaneCollapse={onPaneCollapse}
        onPaneAutoCollapseChange={onPaneAutoCollapseChange}
        topBar={
          <AgentChatNavbar
            className="min-w-0"
            activeAgent={activeAgent ?? null}
            showSidebarControls={showResourceListControls}
            sidebarOpen={sidebarOpen}
            onSidebarToggle={onSidebarToggle}
          />
        }
        topRightTool={
          <>
            {resourcePaneCount && <ResourcePaneCountButton {...resourcePaneCount} openBehavior="toggle-active" />}
            <AgentRightPane.Shortcuts />
          </>
        }
        showTopRightToolWhenPaneOpen
        center={<ConversationStageCenter placement="docked" main={main} composer={composer} />}
        sidePanel={sidePanel}
        centerOverlay={<AgentRightPane.MaximizedOverlay />}
        rightPane={<AgentRightPane.Host />}
        centerClassName="transform-[translateZ(0)] relative justify-between"
      />
    </AgentRightPane>
  )
}

export default AgentChat
