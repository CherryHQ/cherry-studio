import {
  type ChatPanePosition,
  ConversationCenterState,
  ConversationShell,
  EmptyState
} from '@renderer/components/chat'
import CitationsPanel from '@renderer/components/chat/citations/CitationsPanel'
import type { ConversationComposerPlacement } from '@renderer/components/chat/composer'
import { AgentHomeComposer, MissingAgentHomeComposer } from '@renderer/components/chat/composer/variants/AgentComposer'
import { useShellActions } from '@renderer/components/chat/panes/Shell'
import ConversationStageCenter from '@renderer/components/chat/shell/ConversationStageCenter'
import { useCache } from '@renderer/data/hooks/useCache'
import { useAgent } from '@renderer/hooks/agents/useAgent'
import type { AgentSessionSource } from '@renderer/hooks/agents/useSession'
import {
  type ConversationHistoryAdapter,
  useConversationTurnController
} from '@renderer/hooks/useConversationTurnController'
import { useSettings } from '@renderer/hooks/useSettings'
import type { TemporaryConversation, TemporaryConversationDefaults } from '@renderer/hooks/useTemporaryConversation'
import type { Citation, GetAgentResponse } from '@renderer/types'
import { cn } from '@renderer/utils'
import { getAgentAvatarFromConfiguration } from '@renderer/utils/agent'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import type { AgentSessionEntity } from '@shared/data/api/schemas/sessions'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import AgentChatMain from './AgentChatMain'
import AgentComposerSlot from './AgentComposerSlot'
import AgentChatNavbar from './components/AgentChatNavbar'
import { AgentRightPane } from './components/AgentRightPane'
import { locateAgentMessageInList } from './messages/agentMessageListAdapter'
import {
  type AgentSendOptions,
  type AgentTurnInput,
  getAgentTurnParts,
  useAgentChatRuntimeState
} from './useAgentChatRuntimeState'

const EMPTY_MESSAGES: CherryUIMessage[] = []
const EMPTY_PARTS: Record<string, CherryMessagePart[]> = {}

function getNewSessionWorkspaceDefaults(
  session: AgentSessionEntity
): Pick<TemporaryConversationDefaults, 'workspaceId' | 'workspaceMode'> {
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
  temporaryConversation?: TemporaryConversation | null
  missingAgentDraft?: boolean
  onStartTemporarySession?: (defaults: TemporaryConversationDefaults) => void | Promise<void>
  onMissingAgentDraftAgentChange?: (agentId: string | null) => void | Promise<void>
  onPersistTemporarySession?: (initialName?: string) => Promise<TemporaryConversation | null>
  onDraftAgentChange?: (agentId: string | null) => void | Promise<void>
  onDraftWorkspaceChange?: (workspaceId: string | null) => void | Promise<void>
  onVisibleAgentChange?: (agentId: string) => void
  onVisibleWorkspaceChange?: (workspaceId: string) => void
  replacingTemporaryAgent?: boolean
  replacingTemporaryWorkspace?: boolean
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
  temporaryConversation,
  missingAgentDraft = false,
  onStartTemporarySession,
  onMissingAgentDraftAgentChange,
  onPersistTemporarySession,
  onDraftAgentChange,
  onDraftWorkspaceChange,
  onVisibleAgentChange,
  onVisibleWorkspaceChange,
  replacingTemporaryAgent,
  replacingTemporaryWorkspace
}: AgentChatProps) => {
  const { t } = useTranslation()
  const { messageStyle } = useSettings()
  const [isMultiSelectMode] = useCache('chat.multi_select_mode')
  const [citationPanelCitations, setCitationPanelCitations] = useState<Citation[] | null>(null)
  const [reservedSessionSeed, setReservedSessionSeed] = useState<{
    sessionId: string
    messages: CherryUIMessage[]
  } | null>(null)
  const [temporaryHandoffSessionId, setTemporaryHandoffSessionId] = useState<string | null>(null)
  const temporarySeedSessionIdRef = useRef<string | null>(null)
  const lastTemporaryConversationIdRef = useRef<string | null>(null)

  const temporaryAgentConversation = temporaryConversation?.type === 'agent' ? temporaryConversation : null
  const hasLockedSession = lockedSession !== undefined
  const sessionSnapshot = hasLockedSession
    ? (lockedSession ?? null)
    : (temporaryAgentConversation?.session ?? activeSession ?? null)
  const visibleAgentId = sessionSnapshot?.agentId ?? temporaryAgentConversation?.agentId ?? null
  const visibleWorkspaceId = sessionSnapshot?.workspaceId ?? null
  const visibleWorkspace = sessionSnapshot?.workspace ?? null
  const { agent: activeAgent } = useAgent(visibleAgentId)

  useEffect(() => {
    const conversationId = temporaryAgentConversation?.id ?? null
    if (conversationId && conversationId !== lastTemporaryConversationIdRef.current) {
      temporarySeedSessionIdRef.current = null
      setReservedSessionSeed(null)
      setTemporaryHandoffSessionId(null)
    }
    if (conversationId) lastTemporaryConversationIdRef.current = conversationId
  }, [temporaryAgentConversation?.id])

  useEffect(() => {
    if (visibleAgentId) onVisibleAgentChange?.(visibleAgentId)
  }, [onVisibleAgentChange, visibleAgentId])
  useEffect(() => {
    if (visibleWorkspaceId && visibleWorkspace?.type !== 'system') onVisibleWorkspaceChange?.(visibleWorkspaceId)
  }, [onVisibleWorkspaceChange, visibleWorkspace, visibleWorkspaceId])

  const temporaryHistoryAdapter = useMemo<ConversationHistoryAdapter>(
    () => ({
      seedReservedMessages: (messages) => {
        const sessionId = temporarySeedSessionIdRef.current
        if (!sessionId) return
        setReservedSessionSeed({ sessionId, messages })
      },
      refresh: () => undefined,
      rollback: () => {
        temporarySeedSessionIdRef.current = null
        setReservedSessionSeed(null)
        setTemporaryHandoffSessionId(null)
      }
    }),
    []
  )

  const temporaryTurnController = useConversationTurnController<AgentTurnInput, { topicId: string; sessionId: string }>(
    {
      scopeKey: temporaryAgentConversation?.id ?? activeSession?.id ?? 'none',
      historyAdapter: temporaryHistoryAdapter,
      ensureConversation: async ({ text }) => {
        if (!temporaryAgentConversation || !onPersistTemporarySession) return null
        const persisted = await onPersistTemporarySession(text)
        if (persisted?.type !== 'agent') return null
        temporarySeedSessionIdRef.current = persisted.sessionId
        setTemporaryHandoffSessionId(persisted.sessionId)
        return { topicId: persisted.topicId, sessionId: persisted.sessionId }
      },
      buildStreamRequest: (input, conversation) => ({
        trigger: 'submit-message',
        topicId: conversation.topicId,
        userMessageParts: getAgentTurnParts(input)
      })
    }
  )
  const sendTemporaryMessage = useCallback(
    async (message?: { text: string }, options?: AgentSendOptions) => {
      await temporaryTurnController.send({ text: message?.text ?? '', options })
    },
    [temporaryTurnController]
  )

  const handleOpenCitationsPanel = useCallback(({ citations }: { citations: Citation[] }) => {
    setCitationPanelCitations(citations)
  }, [])

  const isInitializing = !sessionSnapshot && (hasLockedSession ? lockedSessionLoading : activeSessionLoading)
  const citationsPanelOpen = citationPanelCitations !== null

  if (isInitializing) {
    return (
      <AgentRightPane
        workspacePath={temporaryAgentConversation?.session.workspace?.path}
        messages={EMPTY_MESSAGES}
        partsByMessageId={EMPTY_PARTS}>
        <ConversationShell
          className={messageStyle}
          pane={pane}
          paneOpen={paneOpen}
          panePosition={panePosition}
          onPaneCollapse={onPaneCollapse}
          center={<ConversationCenterState state="loading" />}
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
          onPaneCollapse={onPaneCollapse}
          center={<EmptyState compact className="h-full" title={t('agent.session.get.error.not_found')} />}
        />
      )
    }
    if (missingAgentDraft) {
      const composer = !isMultiSelectMode ? (
        <MissingAgentHomeComposer
          onAgentChange={onMissingAgentDraftAgentChange}
          agentChanging={replacingTemporaryAgent}
        />
      ) : undefined

      return (
        <ConversationShell
          className={messageStyle}
          pane={pane}
          paneOpen={paneOpen}
          panePosition={panePosition}
          onPaneCollapse={onPaneCollapse}
          topBar={
            <AgentChatNavbar
              activeAgent={null}
              showSidebarControls={showResourceListControls}
              sidebarOpen={sidebarOpen}
              onSidebarToggle={onSidebarToggle}
            />
          }
          center={
            <ConversationStageCenter
              placement="home"
              main={null}
              composer={composer}
              homeWelcomeText={t('agent.home.welcome_title')}
            />
          }
        />
      )
    }
    return (
      <ConversationShell
        className={messageStyle}
        pane={pane}
        paneOpen={paneOpen}
        panePosition={panePosition}
        onPaneCollapse={onPaneCollapse}
        center={<ConversationCenterState state="empty" />}
      />
    )
  }

  const sessionAgentId = sessionSnapshot.agentId ?? temporaryAgentConversation?.agentId ?? null
  const sendableAgentId = activeAgent && sessionAgentId ? sessionAgentId : undefined
  const isDraftTemporarySession = !!temporaryAgentConversation && temporaryTurnController.layout === 'draft'
  const reservedMessages =
    reservedSessionSeed?.sessionId === sessionSnapshot.id ? reservedSessionSeed.messages : EMPTY_MESSAGES
  const isTemporaryTurnInProgress =
    temporaryTurnController.phase !== 'draft' && temporaryTurnController.phase !== 'ready'
  const isPendingTemporarySession =
    !!activeSession &&
    activeSession.id === sessionSnapshot.id &&
    (temporaryHandoffSessionId === sessionSnapshot.id || isTemporaryTurnInProgress)
  const shouldFetchSessionHistoryOnMount =
    activeSessionSource === 'query' ||
    activeSessionSource === 'pending' ||
    (!!activeSession && activeSessionSource === 'none' && !temporaryAgentConversation)
  const isWaitingForReservedMessages =
    isPendingTemporarySession && reservedMessages.length === 0 && temporaryTurnController.phase !== 'ready'
  const isTemporaryHandoff = (!!temporaryAgentConversation && !isDraftTemporarySession) || isWaitingForReservedMessages
  const sessionMessagesEnabled =
    !!activeSession && activeSession.id === sessionSnapshot.id && !isWaitingForReservedMessages
  const sessionHistoryFetchOnMount = isPendingTemporarySession
    ? temporaryTurnController.phase === 'ready'
    : shouldFetchSessionHistoryOnMount
  const homeComposer =
    isDraftTemporarySession && !isMultiSelectMode && temporaryAgentConversation ? (
      <AgentHomeComposer
        agentId={temporaryAgentConversation.agentId}
        sessionId={temporaryAgentConversation.sessionId}
        sessionOverride={temporaryAgentConversation.session}
        sendMessage={sendTemporaryMessage}
        stop={async () => undefined}
        isStreaming={false}
        onAgentChange={onDraftAgentChange}
        agentChanging={replacingTemporaryAgent}
        workspaceId={temporaryAgentConversation.session.workspaceId}
        onWorkspaceChange={onDraftWorkspaceChange}
        workspaceChanging={replacingTemporaryWorkspace}
        showWorkspaceSelector
        onNewSessionDraft={() =>
          onStartTemporarySession?.({
            agentId: temporaryAgentConversation.agentId,
            ...getNewSessionWorkspaceDefaults(temporaryAgentConversation.session),
            name: t('common.unnamed')
          })
        }
      />
    ) : undefined

  return (
    <AgentChatSessionFrame
      className={cn(messageStyle, { 'multi-select-mode': isMultiSelectMode })}
      pane={pane}
      paneOpen={paneOpen}
      panePosition={panePosition}
      showResourceListControls={showResourceListControls}
      sidebarOpen={sidebarOpen}
      onSidebarToggle={onSidebarToggle}
      session={sessionSnapshot}
      placement={isDraftTemporarySession ? 'home' : 'docked'}
      homeComposer={homeComposer}
      homeWelcomeText={t('agent.home.welcome_title')}
      agentId={sendableAgentId}
      activeAgent={activeAgent}
      isMultiSelectMode={isMultiSelectMode}
      sessionMessagesEnabled={sessionMessagesEnabled}
      sessionHistoryFetchOnMount={sessionHistoryFetchOnMount}
      dockedSendDisabled={isTemporaryHandoff}
      dockedStreaming={isTemporaryHandoff}
      reservedMessages={reservedMessages}
      onOpenCitationsPanel={handleOpenCitationsPanel}
      locateMessageId={locateMessageId}
      onLocateMessageHandled={onLocateMessageHandled}
      onPaneCollapse={onPaneCollapse}
      onNewSessionDraft={
        sessionAgentId && onStartTemporarySession
          ? () =>
              onStartTemporarySession({
                agentId: sessionAgentId,
                ...getNewSessionWorkspaceDefaults(sessionSnapshot),
                name: t('common.unnamed')
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
  placement: ConversationComposerPlacement
  homeComposer?: ReactNode
  homeWelcomeText?: string
  agentId?: string
  activeAgent: GetAgentResponse | undefined
  isMultiSelectMode: boolean
  sessionMessagesEnabled: boolean
  sessionHistoryFetchOnMount?: boolean
  dockedSendDisabled?: boolean
  dockedStreaming?: boolean
  reservedMessages?: CherryUIMessage[]
  onOpenCitationsPanel: (payload: { citations: Citation[] }) => void
  locateMessageId?: string
  onLocateMessageHandled?: () => void
  onPaneCollapse?: () => void
  onNewSessionDraft?: () => void | Promise<void>
}

const AgentRightPaneDisabledReset = ({ disabled }: { disabled: boolean }) => {
  const actions = useShellActions()
  const previousDisabledRef = useRef(disabled)

  useEffect(() => {
    if (disabled && !previousDisabledRef.current) {
      actions.close()
    }
    previousDisabledRef.current = disabled
  }, [actions, disabled])

  return null
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
  placement,
  homeComposer,
  homeWelcomeText,
  agentId,
  activeAgent,
  isMultiSelectMode,
  sessionMessagesEnabled,
  sessionHistoryFetchOnMount,
  dockedSendDisabled = false,
  dockedStreaming = false,
  reservedMessages = EMPTY_MESSAGES,
  onOpenCitationsPanel,
  locateMessageId,
  onLocateMessageHandled,
  onPaneCollapse,
  onNewSessionDraft
}: AgentChatSessionFrameProps) => {
  const runtime = useAgentChatRuntimeState({
    session,
    activeAgent,
    sessionMessagesEnabled,
    sessionHistoryFetchOnMount,
    reservedMessages
  })
  const sessionTopicId = useMemo(() => buildAgentSessionTopicId(runtime.sessionId), [runtime.sessionId])
  const locateLoadRequestRef = useRef<string | undefined>(undefined)

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
      placement={placement}
      homeComposer={homeComposer}
      agentId={agentId}
      isMultiSelectMode={isMultiSelectMode}
      session={session}
      sessionId={runtime.sessionId}
      sendMessage={runtime.sendMessage}
      stop={runtime.stop}
      isStreaming={dockedStreaming || runtime.isPending}
      sendDisabled={dockedSendDisabled}
      onNewSessionDraft={onNewSessionDraft}
      composerContext={runtime.composerContext}
    />
  )
  const main = (
    <AgentChatMain
      placement={placement}
      sessionMessagesEnabled={sessionMessagesEnabled}
      agentId={agentId}
      sessionId={runtime.sessionId}
      messages={runtime.uiMessages}
      activeAgent={activeAgent}
      partsByMessageId={runtime.partsByMessageId}
      modelFallback={runtime.fallbackSnapshot}
      isLoading={runtime.isLoading}
      hasOlder={runtime.hasOlder}
      loadOlder={runtime.loadOlder}
      onOpenCitationsPanel={onOpenCitationsPanel}
      deleteMessage={runtime.deleteMessage}
      respondToolApproval={runtime.respondToolApproval}
    />
  )
  const rightPaneDisabled = placement === 'home'

  return (
    <AgentRightPane
      workspacePath={session.workspace?.path}
      messages={runtime.uiMessages}
      partsByMessageId={runtime.partsByMessageId}
      sessionId={runtime.sessionId}
      sessionName={session.name}
      agentId={agentId ?? session.agentId ?? undefined}
      agentName={activeAgent?.name}
      agentAvatar={activeAgent ? getAgentAvatarFromConfiguration(activeAgent.configuration) : undefined}
      modelFallback={runtime.fallbackSnapshot}>
      <AgentRightPaneDisabledReset disabled={rightPaneDisabled} />
      <ConversationShell
        className={className}
        pane={pane}
        paneOpen={paneOpen}
        panePosition={panePosition}
        onPaneCollapse={onPaneCollapse}
        topBar={
          <AgentChatNavbar
            className="min-w-0"
            activeAgent={activeAgent ?? null}
            showSidebarControls={showResourceListControls}
            sidebarOpen={sidebarOpen}
            onSidebarToggle={onSidebarToggle}
          />
        }
        topRightTool={<AgentRightPane.FilesToggle disabled={rightPaneDisabled} />}
        center={
          <ConversationStageCenter
            placement={placement}
            main={main}
            composer={composer}
            homeWelcomeText={homeWelcomeText}
          />
        }
        sidePanel={sidePanel}
        centerOverlay={rightPaneDisabled ? undefined : <AgentRightPane.MaximizedOverlay />}
        rightPane={rightPaneDisabled ? undefined : <AgentRightPane.Host />}
        centerClassName="transform-[translateZ(0)] relative justify-between"
      />
    </AgentRightPane>
  )
}

export default AgentChat
