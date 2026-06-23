import {
  type ChatPanePosition,
  ConversationCenterState,
  ConversationShell,
  EmptyState
} from '@renderer/components/chat'
import CitationsPanel from '@renderer/components/chat/citations/CitationsPanel'
import { AgentHomeComposer, MissingAgentHomeComposer } from '@renderer/components/chat/composer/variants/AgentComposer'
import ConversationStageCenter from '@renderer/components/chat/shell/ConversationStageCenter'
import { useCache } from '@renderer/data/hooks/useCache'
import { useAgent } from '@renderer/hooks/agents/useAgent'
import type { AgentSessionSource } from '@renderer/hooks/agents/useSession'
import {
  type ConversationHistoryAdapter,
  useConversationTurnController
} from '@renderer/hooks/useConversationTurnController'
import { useSettings } from '@renderer/hooks/useSettings'
import type { Citation, GetAgentResponse } from '@renderer/types'
import { cn } from '@renderer/utils'
import { getAgentAvatarFromConfiguration } from '@renderer/utils/agent'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import AgentChatMain from './AgentChatMain'
import AgentComposerSlot from './AgentComposerSlot'
import AgentChatNavbar from './components/AgentChatNavbar'
import { AgentRightPane } from './components/AgentRightPane'
import { locateAgentMessageInList } from './messages/agentMessageListAdapter'
import type { DraftAgentSession, DraftAgentSessionDefaults, EnsurePersistentSession } from './types'
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
): Pick<DraftAgentSessionDefaults, 'workspaceId' | 'workspaceMode'> {
  if (session.workspace?.type === 'system') {
    return { workspaceMode: 'system' }
  }
  return session.workspaceId ? { workspaceId: session.workspaceId } : {}
}

function getDraftConversationKey(draft: DraftAgentSession): string {
  return draft.workspaceSource.type === 'user'
    ? `agent-draft:${draft.agentId}:workspace:${draft.workspaceSource.workspaceId}`
    : `agent-draft:${draft.agentId}:system`
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
  draftConversation?: DraftAgentSession | null
  missingAgentDraft?: boolean
  onStartDraftSession?: (defaults: DraftAgentSessionDefaults) => void | Promise<void>
  onMissingAgentDraftAgentChange?: (agentId: string | null) => void | Promise<void>
  onEnsurePersistentSession?: EnsurePersistentSession
  onDraftAgentChange?: (agentId: string | null) => void | Promise<void>
  onDraftWorkspaceChange?: (workspaceId: string | null) => void | Promise<void>
  onVisibleAgentChange?: (agentId: string) => void
  onVisibleWorkspaceChange?: (workspaceId: string) => void
  replacingDraftAgent?: boolean
  replacingDraftWorkspace?: boolean
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
  draftConversation,
  missingAgentDraft = false,
  onStartDraftSession,
  onMissingAgentDraftAgentChange,
  onEnsurePersistentSession,
  onDraftAgentChange,
  onDraftWorkspaceChange,
  onVisibleAgentChange,
  onVisibleWorkspaceChange,
  replacingDraftAgent,
  replacingDraftWorkspace
}: AgentChatProps) => {
  const { t } = useTranslation()
  const { messageStyle } = useSettings()
  const [isMultiSelectMode] = useCache('chat.multi_select_mode')
  const [citationPanelCitations, setCitationPanelCitations] = useState<Citation[] | null>(null)
  const [reservedSessionSeed, setReservedSessionSeed] = useState<{
    sessionId: string
    messages: CherryUIMessage[]
  } | null>(null)
  const [draftHandoffSessionId, setDraftHandoffSessionId] = useState<string | null>(null)
  const draftSeedSessionIdRef = useRef<string | null>(null)
  const lastDraftConversationIdRef = useRef<string | null>(null)

  const draftAgentConversation = draftConversation ?? null
  const hasLockedSession = lockedSession !== undefined
  const activeSessionIsDraftHandoff =
    !!draftAgentConversation && !!draftHandoffSessionId && activeSession?.id === draftHandoffSessionId
  const shouldPreferDraftConversation = !!draftAgentConversation && !hasLockedSession && !activeSessionIsDraftHandoff
  const sessionSnapshot = shouldPreferDraftConversation
    ? null
    : hasLockedSession
      ? (lockedSession ?? null)
      : (activeSession ?? null)
  const visibleAgentId = sessionSnapshot?.agentId ?? draftAgentConversation?.agentId ?? null
  const visibleWorkspaceId =
    sessionSnapshot?.workspaceId ??
    (draftAgentConversation?.workspaceSource.type === 'user'
      ? draftAgentConversation.workspaceSource.workspaceId
      : null)
  const visibleWorkspace = sessionSnapshot?.workspace ?? draftAgentConversation?.workspace ?? null
  const { agent: activeAgent } = useAgent(visibleAgentId)
  const draftConversationKey = draftAgentConversation ? getDraftConversationKey(draftAgentConversation) : null

  useEffect(() => {
    const conversationId = draftConversationKey
    if (conversationId && conversationId !== lastDraftConversationIdRef.current) {
      draftSeedSessionIdRef.current = null
      setReservedSessionSeed(null)
      setDraftHandoffSessionId(null)
    }
    if (conversationId) lastDraftConversationIdRef.current = conversationId
  }, [draftConversationKey])

  useEffect(() => {
    if (visibleAgentId) onVisibleAgentChange?.(visibleAgentId)
  }, [onVisibleAgentChange, visibleAgentId])
  useEffect(() => {
    if (visibleWorkspaceId && visibleWorkspace?.type !== 'system') onVisibleWorkspaceChange?.(visibleWorkspaceId)
  }, [onVisibleWorkspaceChange, visibleWorkspace, visibleWorkspaceId])

  const draftHistoryAdapter = useMemo<ConversationHistoryAdapter>(
    () => ({
      seedReservedMessages: (messages) => {
        const sessionId = draftSeedSessionIdRef.current
        if (!sessionId) return
        setReservedSessionSeed({ sessionId, messages })
      },
      refresh: () => undefined,
      rollback: () => {
        draftSeedSessionIdRef.current = null
        setReservedSessionSeed(null)
        setDraftHandoffSessionId(null)
      }
    }),
    []
  )

  const draftTurnController = useConversationTurnController<AgentTurnInput, { topicId: string; sessionId: string }>({
    scopeKey: draftConversationKey ?? activeSession?.id ?? 'none',
    historyAdapter: draftHistoryAdapter,
    ensureConversation: async ({ text }) => {
      if (!draftAgentConversation || !onEnsurePersistentSession) return null
      const persisted = await onEnsurePersistentSession(text)
      if (!persisted) return null
      draftSeedSessionIdRef.current = persisted.sessionId
      setDraftHandoffSessionId(persisted.sessionId)
      return { topicId: persisted.topicId, sessionId: persisted.sessionId }
    },
    buildStreamRequest: (input, conversation) => ({
      trigger: 'submit-message',
      topicId: conversation.topicId,
      userMessageParts: getAgentTurnParts(input)
    })
  })
  const sendDraftMessage = useCallback(
    async (message?: { text: string }, options?: AgentSendOptions) => {
      await draftTurnController.send({ text: message?.text ?? '', options })
    },
    [draftTurnController]
  )

  const handleOpenCitationsPanel = useCallback(({ citations }: { citations: Citation[] }) => {
    setCitationPanelCitations(citations)
  }, [])

  const isInitializing = !sessionSnapshot && (hasLockedSession ? lockedSessionLoading : activeSessionLoading)
  const citationsPanelOpen = citationPanelCitations !== null

  if (isInitializing) {
    return (
      <AgentRightPane
        workspacePath={draftAgentConversation?.workspace?.path}
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
    if (draftAgentConversation) {
      if (draftTurnController.layout !== 'draft') {
        return (
          <ConversationShell
            className={messageStyle}
            pane={pane}
            paneOpen={paneOpen}
            panePosition={panePosition}
            onPaneCollapse={onPaneCollapse}
            topBar={
              <AgentChatNavbar
                activeAgent={activeAgent ?? null}
                showSidebarControls={showResourceListControls}
                sidebarOpen={sidebarOpen}
                onSidebarToggle={onSidebarToggle}
              />
            }
            center={<ConversationCenterState state="loading" />}
          />
        )
      }

      const draftSessionKey = getDraftConversationKey(draftAgentConversation)
      const draftWorkspaceId =
        draftAgentConversation.workspaceSource.type === 'user'
          ? draftAgentConversation.workspaceSource.workspaceId
          : null
      const composer = !isMultiSelectMode ? (
        <AgentHomeComposer
          agentId={draftAgentConversation.agentId}
          sessionId={draftSessionKey}
          sessionOverride={{
            workspace: draftAgentConversation.workspace ?? null,
            workspaceId: draftWorkspaceId
          }}
          sendMessage={sendDraftMessage}
          stop={async () => undefined}
          isStreaming={false}
          onAgentChange={onDraftAgentChange}
          agentChanging={replacingDraftAgent}
          workspaceId={draftWorkspaceId}
          onWorkspaceChange={onDraftWorkspaceChange}
          workspaceChanging={replacingDraftWorkspace}
          showWorkspaceSelector
          onNewSessionDraft={() =>
            onStartDraftSession?.({
              agentId: draftAgentConversation.agentId,
              workspace: draftAgentConversation.workspaceSource
            })
          }
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
              activeAgent={activeAgent ?? null}
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
    if (missingAgentDraft) {
      const composer = !isMultiSelectMode ? (
        <MissingAgentHomeComposer onAgentChange={onMissingAgentDraftAgentChange} agentChanging={replacingDraftAgent} />
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

  const sessionAgentId = sessionSnapshot.agentId ?? draftAgentConversation?.agentId ?? null
  const sendableAgentId = activeAgent && sessionAgentId ? sessionAgentId : undefined
  const reservedMessages =
    reservedSessionSeed?.sessionId === sessionSnapshot.id ? reservedSessionSeed.messages : EMPTY_MESSAGES
  const isDraftTurnInProgress = draftTurnController.phase !== 'draft' && draftTurnController.phase !== 'ready'
  const isPendingDraftSession =
    !!activeSession &&
    activeSession.id === sessionSnapshot.id &&
    (draftHandoffSessionId === sessionSnapshot.id || isDraftTurnInProgress)
  const shouldFetchSessionHistoryOnMount =
    activeSessionSource === 'query' ||
    activeSessionSource === 'pending' ||
    (!!activeSession && activeSessionSource === 'none')
  const isWaitingForReservedMessages =
    isPendingDraftSession && reservedMessages.length === 0 && draftTurnController.phase !== 'ready'
  const isDraftHandoff = isWaitingForReservedMessages
  const sessionMessagesEnabled =
    !!activeSession && activeSession.id === sessionSnapshot.id && !isWaitingForReservedMessages
  const sessionHistoryFetchOnMount = isPendingDraftSession
    ? draftTurnController.phase === 'ready'
    : shouldFetchSessionHistoryOnMount
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
      homeWelcomeText={t('agent.home.welcome_title')}
      agentId={sendableAgentId}
      activeAgent={activeAgent}
      isMultiSelectMode={isMultiSelectMode}
      sessionMessagesEnabled={sessionMessagesEnabled}
      sessionHistoryFetchOnMount={sessionHistoryFetchOnMount}
      dockedSendDisabled={isDraftHandoff}
      dockedStreaming={isDraftHandoff}
      reservedMessages={reservedMessages}
      onOpenCitationsPanel={handleOpenCitationsPanel}
      locateMessageId={locateMessageId}
      onLocateMessageHandled={onLocateMessageHandled}
      onPaneCollapse={onPaneCollapse}
      onNewSessionDraft={
        sessionAgentId && onStartDraftSession
          ? () =>
              onStartDraftSession({
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
  dockedSendDisabled?: boolean
  dockedStreaming?: boolean
  reservedMessages?: CherryUIMessage[]
  onOpenCitationsPanel: (payload: { citations: Citation[] }) => void
  locateMessageId?: string
  onLocateMessageHandled?: () => void
  onPaneCollapse?: () => void
  onNewSessionDraft?: () => void | Promise<void>
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
      placement="docked"
      sessionMessagesEnabled={sessionMessagesEnabled}
      agentId={agentId}
      sessionId={runtime.sessionId}
      messages={runtime.uiMessages}
      activeAgent={activeAgent}
      partsByMessageId={runtime.partsByMessageId}
      optimisticAskUserQuestionInputsByToolCallId={runtime.optimisticAskUserQuestionInputsByToolCallId}
      modelFallback={runtime.fallbackSnapshot}
      isLoading={runtime.isLoading}
      hasOlder={runtime.hasOlder}
      loadOlder={runtime.loadOlder}
      onOpenCitationsPanel={onOpenCitationsPanel}
      deleteMessage={runtime.deleteMessage}
      respondToolApproval={runtime.respondToolApproval}
    />
  )

  return (
    <AgentRightPane
      workspacePath={session.workspace?.path}
      messages={runtime.uiMessages}
      partsByMessageId={runtime.partsByMessageId}
      sessionId={runtime.sessionId}
      sessionName={session.name}
      traceId={session.traceId ?? undefined}
      agentId={agentId ?? session.agentId ?? undefined}
      agentName={activeAgent?.name}
      agentAvatar={activeAgent ? getAgentAvatarFromConfiguration(activeAgent.configuration) : undefined}
      modelFallback={runtime.fallbackSnapshot}>
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
        topRightTool={
          <>
            <AgentRightPane.InfoCard />
            <AgentRightPane.FilesToggle />
          </>
        }
        topRightToolReserve="double"
        center={
          <ConversationStageCenter
            placement="docked"
            main={main}
            composer={composer}
            homeWelcomeText={homeWelcomeText}
          />
        }
        sidePanel={sidePanel}
        centerOverlay={<AgentRightPane.MaximizedOverlay />}
        rightPane={<AgentRightPane.Host />}
        centerClassName="transform-[translateZ(0)] relative justify-between"
      />
    </AgentRightPane>
  )
}

export default AgentChat
