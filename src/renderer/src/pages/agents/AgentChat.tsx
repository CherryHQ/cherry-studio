import { ChatAppShell, type ChatPanePosition } from '@renderer/components/chat'
import CitationsPanel from '@renderer/components/chat/citations/CitationsPanel'
import { ComposerContextProvider } from '@renderer/components/chat/composer/ComposerContext'
import ComposerCore from '@renderer/components/chat/composer/ComposerCore'
import ComposerDockTransitionFrame from '@renderer/components/chat/composer/ComposerDockTransitionFrame'
import { useToolApprovalComposerOverrides } from '@renderer/components/chat/composer/useToolApprovalComposerOverrides'
import AgentComposer, { AgentHomeComposer } from '@renderer/components/chat/composer/variants/AgentComposer'
import { MessageListInitialLoading } from '@renderer/components/chat/messages/layout/MessageListLoading'
import type { MessageToolApprovalInput } from '@renderer/components/chat/messages/types'
import { useShellState } from '@renderer/components/chat/panes/Shell'
import { QuickPanelProvider } from '@renderer/components/QuickPanel'
import { useCache } from '@renderer/data/hooks/useCache'
import { useAgent } from '@renderer/hooks/agents/useAgent'
import { useActiveSession } from '@renderer/hooks/agents/useSession'
import { useAgentSessionParts } from '@renderer/hooks/useAgentSessionParts'
import { useChatWithHistory } from '@renderer/hooks/useChatWithHistory'
import {
  type ConversationHistoryAdapter,
  useConversationTurnController
} from '@renderer/hooks/useConversationTurnController'
import { useExecutionOverlay } from '@renderer/hooks/useExecutionOverlay'
import { useSettings } from '@renderer/hooks/useSettings'
import type { TemporaryConversation, TemporaryConversationDefaults } from '@renderer/hooks/useTemporaryConversation'
import { useTopicStreamStatus } from '@renderer/hooks/useTopicStreamStatus'
import type { Citation, GetAgentResponse } from '@renderer/types'
import { cn } from '@renderer/utils'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import type { AgentSessionEntity } from '@shared/data/api/schemas/sessions'
import type { CherryMessagePart, CherryUIMessage, ModelSnapshot } from '@shared/data/types/message'
import { isUniqueModelId, parseUniqueModelId } from '@shared/data/types/model'
import type { ComponentProps, PropsWithChildren, ReactNode } from 'react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import AgentChatNavbar from './components/AgentChatNavbar'
import { AgentRightPane, useAgentRightPaneActions } from './components/AgentRightPane'
import AgentSessionMessages from './components/AgentSessionMessages'
import { locateAgentMessageInList } from './messages/agentMessageListAdapter'

const EMPTY_MESSAGES: CherryUIMessage[] = []
const EMPTY_PARTS: Record<string, CherryMessagePart[]> = {}

type AgentSendOptions = { body?: Record<string, unknown> }
interface AgentTurnInput {
  text: string
  options?: AgentSendOptions
}

function getAgentTurnParts(input: AgentTurnInput): CherryMessagePart[] {
  const parts = input.options?.body?.userMessageParts as CherryMessagePart[] | undefined
  return parts ?? (input.text ? [{ type: 'text', text: input.text }] : [])
}

interface AgentChatProps {
  pane?: ReactNode
  paneOpen?: boolean
  panePosition?: ChatPanePosition
  pendingSession?: AgentSessionEntity | null
  temporaryConversation?: TemporaryConversation | null
  onStartTemporarySession?: (defaults: TemporaryConversationDefaults) => void | Promise<void>
  onPersistTemporarySession?: (initialName?: string) => Promise<TemporaryConversation | null>
  onDraftAgentChange?: (agentId: string | null) => void | Promise<void>
  onDraftWorkspaceChange?: (workspaceId: string) => void | Promise<void>
  onVisibleAgentChange?: (agentId: string) => void
  onVisibleWorkspaceChange?: (workspaceId: string) => void
  locateMessageId?: string
  onLocateMessageHandled?: () => void
  replacingTemporaryAgent?: boolean
  replacingTemporaryWorkspace?: boolean
}

const AgentChat = ({
  pane,
  paneOpen,
  panePosition,
  pendingSession,
  temporaryConversation,
  onStartTemporarySession,
  onPersistTemporarySession,
  onDraftAgentChange,
  onDraftWorkspaceChange,
  onVisibleAgentChange,
  onVisibleWorkspaceChange,
  locateMessageId,
  onLocateMessageHandled,
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
  const temporarySeedSessionIdRef = useRef<string | null>(null)

  const temporaryAgentConversation = temporaryConversation?.type === 'agent' ? temporaryConversation : null
  const { session: visibleSession, isLoading: isSessionLoading } = useActiveSession({
    pendingSession
  })
  const visibleAgentId = visibleSession?.agentId ?? temporaryAgentConversation?.agentId ?? null
  const visibleWorkspaceId = visibleSession?.workspaceId ?? temporaryAgentConversation?.session.workspaceId ?? null
  const { agent: activeAgent, isLoading: isAgentLoading } = useAgent(
    visibleSession?.agentId ?? temporaryAgentConversation?.agentId ?? null
  )

  useEffect(() => {
    if (visibleAgentId) onVisibleAgentChange?.(visibleAgentId)
  }, [onVisibleAgentChange, visibleAgentId])
  useEffect(() => {
    if (visibleWorkspaceId) onVisibleWorkspaceChange?.(visibleWorkspaceId)
  }, [onVisibleWorkspaceChange, visibleWorkspaceId])

  const temporaryHistoryAdapter = useMemo<ConversationHistoryAdapter>(
    () => ({
      seedReservedMessages: (messages) => {
        const sessionId = temporarySeedSessionIdRef.current
        if (!sessionId) return
        setReservedSessionSeed({ sessionId, messages })
      },
      refresh: () => undefined,
      rollback: () => {
        setReservedSessionSeed(null)
      }
    }),
    []
  )

  const temporaryTurnController = useConversationTurnController<AgentTurnInput, { topicId: string; sessionId: string }>(
    {
      scopeKey: temporaryAgentConversation?.id ?? visibleSession?.id ?? 'none',
      historyAdapter: temporaryHistoryAdapter,
      ensureConversation: async ({ text }) => {
        if (!temporaryAgentConversation || !onPersistTemporarySession) return null
        const persisted = await onPersistTemporarySession(text)
        if (persisted?.type !== 'agent') return null
        temporarySeedSessionIdRef.current = persisted.sessionId
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
    async (message?: { text: string }, options?: { body?: Record<string, unknown> }) => {
      await temporaryTurnController.send({ text: message?.text ?? '', options })
    },
    [temporaryTurnController]
  )

  const handleOpenCitationsPanel = useCallback(({ citations }: { citations: Citation[] }) => {
    setCitationPanelCitations(citations)
  }, [])

  const isInitializing = !visibleSession && (temporaryAgentConversation ? isAgentLoading : isSessionLoading)
  const citationsPanelOpen = citationPanelCitations !== null

  if (isInitializing) {
    return (
      <AgentRightPane
        workspacePath={temporaryAgentConversation?.session.workspace?.path}
        messages={EMPTY_MESSAGES}
        partsByMessageId={EMPTY_PARTS}>
        <AgentChatFrame
          className={messageStyle}
          pane={pane}
          paneOpen={paneOpen}
          panePosition={panePosition}
          main={<MessageListInitialLoading />}
          rightPane={<AgentRightPane.Host />}
        />
      </AgentRightPane>
    )
  }

  if (!visibleSession) {
    if (!temporaryAgentConversation) {
      return (
        <AgentChatFrame
          className={messageStyle}
          pane={pane}
          paneOpen={paneOpen}
          panePosition={panePosition}
          main={<div />}
        />
      )
    }

    const homeComposer = !isMultiSelectMode ? (
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
        showWorkspaceSelector={temporaryTurnController.layout === 'draft'}
        onNewSessionDraft={() =>
          onStartTemporarySession?.({
            agentId: temporaryAgentConversation.agentId,
            workspaceId: temporaryAgentConversation.session.workspaceId ?? undefined,
            name: t('common.unnamed')
          })
        }
      />
    ) : null

    return (
      <AgentRightPane
        workspacePath={temporaryAgentConversation.session.workspace?.path}
        messages={EMPTY_MESSAGES}
        partsByMessageId={EMPTY_PARTS}
        sessionId={temporaryAgentConversation.sessionId}
        sessionName={temporaryAgentConversation.session.name}
        agentId={temporaryAgentConversation.agentId}
        agentName={activeAgent?.name}
        agentAvatar={activeAgent?.configuration?.avatar}>
        <AgentChatFrame
          className={messageStyle}
          pane={pane}
          paneOpen={paneOpen}
          panePosition={panePosition}
          topBar={
            <div className="flex h-fit w-full min-w-0">
              <AgentChatNavbar
                className="min-w-0"
                activeAgent={activeAgent ?? null}
                tools={<AgentRightPane.FilesToggle />}
              />
            </div>
          }
          main={
            <AgentComposerDock
              placement={temporaryTurnController.layout === 'draft' ? 'home' : 'docked'}
              main={<div className="h-full min-h-0 flex-1" />}
              composer={homeComposer}
              mainVisible={temporaryTurnController.layout !== 'draft'}
            />
          }
          sidePanel={
            <CitationsPanel
              open={citationsPanelOpen}
              onClose={() => setCitationPanelCitations(null)}
              citations={citationPanelCitations ?? []}
            />
          }
          centerOverlay={<AgentRightPane.MaximizedOverlay />}
          rightPane={<AgentRightPane.Host />}
        />
      </AgentRightPane>
    )
  }

  const sendableAgentId = activeAgent ? (visibleSession.agentId ?? undefined) : undefined

  return (
    <AgentChatSessionFrame
      className={cn(messageStyle, { 'multi-select-mode': isMultiSelectMode })}
      pane={pane}
      paneOpen={paneOpen}
      panePosition={panePosition}
      visibleSession={visibleSession}
      agentId={sendableAgentId}
      activeAgent={activeAgent}
      isMultiSelectMode={isMultiSelectMode}
      reservedMessages={
        reservedSessionSeed?.sessionId === visibleSession.id ? reservedSessionSeed.messages : EMPTY_MESSAGES
      }
      onOpenCitationsPanel={handleOpenCitationsPanel}
      locateMessageId={locateMessageId}
      onLocateMessageHandled={onLocateMessageHandled}
      onNewSessionDraft={
        sendableAgentId
          ? () =>
              onStartTemporarySession?.({
                agentId: sendableAgentId,
                workspaceId: visibleSession.workspaceId ?? undefined,
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

// ── Inner: session-scoped history; agentId is present only while the session is sendable ──

type VisibleAgentSession = NonNullable<ReturnType<typeof useActiveSession>['session']>

interface AgentChatSessionFrameProps {
  className?: string
  pane?: ReactNode
  paneOpen?: boolean
  panePosition?: ChatPanePosition
  sidePanel?: ReactNode
  visibleSession: VisibleAgentSession
  agentId?: string
  activeAgent: GetAgentResponse | undefined
  isMultiSelectMode: boolean
  reservedMessages?: CherryUIMessage[]
  onOpenCitationsPanel: (payload: { citations: Citation[] }) => void
  locateMessageId?: string
  onLocateMessageHandled?: () => void
  onNewSessionDraft?: () => void | Promise<void>
}

const AgentChatSessionFrame = ({
  className,
  pane,
  paneOpen,
  panePosition,
  sidePanel,
  visibleSession,
  agentId,
  activeAgent,
  isMultiSelectMode,
  reservedMessages = EMPTY_MESSAGES,
  onOpenCitationsPanel,
  locateMessageId,
  onLocateMessageHandled,
  onNewSessionDraft
}: AgentChatSessionFrameProps) => {
  const sessionId = visibleSession.id
  const locateLoadRequestRef = useRef<string | undefined>(undefined)
  const sessionTopicId = useMemo(() => buildAgentSessionTopicId(sessionId), [sessionId])
  const {
    messages: uiMessages,
    isLoading,
    hasOlder,
    loadOlder,
    refresh,
    seedReservedMessages,
    deleteMessage: deleteSessionMessage
  } = useAgentSessionParts(sessionId)

  useLayoutEffect(() => {
    if (reservedMessages.length === 0) return
    void seedReservedMessages(reservedMessages)
  }, [reservedMessages, seedReservedMessages])
  const chat = useChatWithHistory(sessionTopicId, uiMessages, refresh)
  const historyAdapter = useMemo<ConversationHistoryAdapter>(
    () => ({
      seedReservedMessages,
      refresh,
      rollback: refresh
    }),
    [refresh, seedReservedMessages]
  )
  const turnController = useConversationTurnController<AgentTurnInput, { topicId: string }>({
    scopeKey: sessionTopicId,
    historyAdapter,
    ensureConversation: () => ({ topicId: sessionTopicId }),
    buildStreamRequest: (input, conversation) => ({
      trigger: 'submit-message',
      topicId: conversation.topicId,
      userMessageParts: getAgentTurnParts(input)
    })
  })
  const sendMessage = useCallback(
    async (message?: { text: string }, options?: AgentSendOptions) => {
      await turnController.send({ text: message?.text ?? '', options })
    },
    [turnController]
  )
  const deleteMessage = useCallback(
    async (messageId: string) => {
      await deleteSessionMessage(messageId)
      chat.setMessages((current) => current.filter((message) => message.id !== messageId))
    },
    [chat, deleteSessionMessage]
  )

  const fallbackSnapshot = useMemo<ModelSnapshot | undefined>(() => {
    const modelString = activeAgent?.model
    if (!isUniqueModelId(modelString)) return undefined
    const { providerId, modelId } = parseUniqueModelId(modelString)
    if (!providerId || !modelId) return undefined
    return { id: modelId, name: activeAgent?.modelName ?? modelId, provider: providerId }
  }, [activeAgent?.model, activeAgent?.modelName])

  const basePartsMap = useMemo<Record<string, CherryMessagePart[]>>(() => {
    const next: Record<string, CherryMessagePart[]> = {}
    for (const message of uiMessages) {
      next[message.id] = (message.parts ?? []) as CherryMessagePart[]
    }
    return next
  }, [uiMessages])

  const { overlay } = useExecutionOverlay(sessionTopicId, chat.activeExecutions, uiMessages)

  useEffect(() => {
    if (!locateMessageId) {
      locateLoadRequestRef.current = undefined
      return
    }

    if (uiMessages.some((message) => message.id === locateMessageId)) {
      locateLoadRequestRef.current = undefined
      window.requestAnimationFrame(() => {
        locateAgentMessageInList(sessionTopicId, locateMessageId, true)
      })
      onLocateMessageHandled?.()
      return
    }

    if (hasOlder && !isLoading) {
      const requestKey = `${locateMessageId}:${uiMessages.length}`
      if (locateLoadRequestRef.current !== requestKey) {
        locateLoadRequestRef.current = requestKey
        loadOlder?.()
      }
      return
    }

    if (!hasOlder && !isLoading) {
      locateLoadRequestRef.current = undefined
      onLocateMessageHandled?.()
    }
  }, [hasOlder, isLoading, loadOlder, locateMessageId, onLocateMessageHandled, sessionTopicId, uiMessages])

  const partsByMessageId = useMemo<Record<string, CherryMessagePart[]>>(() => {
    const next = { ...basePartsMap }
    for (const [messageId, parts] of Object.entries(overlay)) {
      if (parts.length) next[messageId] = parts
    }
    return next
  }, [basePartsMap, overlay])

  const handleToolApprovalRespond = useCallback(
    async ({ match, approved, reason, updatedInput }: MessageToolApprovalInput) => {
      const approvalId = match.approvalId

      const result = await window.api.ai.toolApproval.respond({
        approvalId,
        approved,
        reason,
        updatedInput,
        topicId: sessionTopicId,
        anchorId: match.messageId
      })

      if (!result.ok) throw new Error('Tool approval response was not accepted')
      await refresh()
    },
    [refresh, sessionTopicId]
  )
  const toolApprovalComposerOverrides = useToolApprovalComposerOverrides({
    partsByMessageId,
    onRespond: handleToolApprovalRespond
  })
  const { isPending } = useTopicStreamStatus(sessionTopicId)

  const composerContext = useMemo(
    () => ({
      overrides: toolApprovalComposerOverrides
    }),
    [toolApprovalComposerOverrides]
  )

  const bottomComposer = useMemo(() => {
    if (isMultiSelectMode || !agentId) return undefined

    return (
      <ComposerContextProvider value={composerContext}>
        <ComposerCore
          fallback={
            <AgentComposer
              agentId={agentId}
              sessionId={sessionId}
              sendMessage={sendMessage}
              stop={chat.stop}
              isStreaming={isPending}
              onNewSessionDraft={onNewSessionDraft}
            />
          }
        />
      </ComposerContextProvider>
    )
  }, [agentId, chat.stop, composerContext, isMultiSelectMode, isPending, onNewSessionDraft, sendMessage, sessionId])

  const main = (
    <div className="translate-z-0 relative flex min-h-0 w-full flex-1 flex-col overflow-hidden">
      <div className="min-h-0 flex-1">
        <AgentSessionMessagesWithAgentRightPaneAction
          agentId={agentId}
          sessionId={sessionId}
          messages={uiMessages}
          activeAgent={activeAgent}
          partsByMessageId={partsByMessageId}
          modelFallback={fallbackSnapshot}
          isLoading={isLoading}
          hasOlder={hasOlder}
          loadOlder={loadOlder}
          onOpenCitationsPanel={onOpenCitationsPanel}
          deleteMessage={agentId ? deleteMessage : undefined}
          respondToolApproval={agentId ? handleToolApprovalRespond : undefined}
        />
      </div>
    </div>
  )

  return (
    <AgentRightPane
      workspacePath={visibleSession.workspace?.path}
      messages={uiMessages}
      partsByMessageId={partsByMessageId}
      sessionId={sessionId}
      sessionName={visibleSession.name}
      agentId={agentId ?? visibleSession.agentId ?? undefined}
      agentName={activeAgent?.name}
      agentAvatar={activeAgent?.configuration?.avatar}
      modelFallback={fallbackSnapshot}>
      <AgentChatFrame
        className={className}
        pane={pane}
        paneOpen={paneOpen}
        panePosition={panePosition}
        topBar={
          <div className="flex h-fit w-full min-w-0">
            <AgentChatNavbar
              className="min-w-0"
              activeAgent={activeAgent ?? null}
              tools={<AgentRightPane.FilesToggle />}
            />
          </div>
        }
        centerContent={<AgentComposerDock placement="docked" main={main} composer={bottomComposer} mainVisible />}
        sidePanel={sidePanel}
        centerOverlay={<AgentRightPane.MaximizedOverlay />}
        rightPane={<AgentRightPane.Host />}
      />
    </AgentRightPane>
  )
}

const AgentSessionMessagesWithAgentRightPaneAction = (props: ComponentProps<typeof AgentSessionMessages>) => {
  const { openAgentToolFlow } = useAgentRightPaneActions()
  return <AgentSessionMessages {...props} openAgentToolFlow={openAgentToolFlow} />
}

// Lifts the composer above the maximized right-pane overlay so it stays usable while maximized.
const AgentComposerDock = (props: ComponentProps<typeof ComposerDockTransitionFrame>) => {
  const { maximized } = useShellState()
  return <ComposerDockTransitionFrame {...props} composerElevated={maximized} />
}

interface AgentChatFrameBaseProps {
  pane?: ReactNode
  paneOpen?: boolean
  panePosition?: ChatPanePosition
  topBar?: ReactNode
  sidePanel?: ReactNode
  overlay?: ReactNode
  centerOverlay?: ReactNode
  rightPane?: ReactNode
  className?: string
}

type AgentChatFrameMainProps = AgentChatFrameBaseProps & {
  main: ReactNode
  bottomComposer?: ReactNode
  centerContent?: never
}

type AgentChatFrameCenterContentProps = AgentChatFrameBaseProps & {
  centerContent: ReactNode
  main?: never
  bottomComposer?: never
}

type AgentChatFrameProps = AgentChatFrameMainProps | AgentChatFrameCenterContentProps

const AgentChatFrame = ({
  pane,
  paneOpen,
  panePosition,
  topBar,
  main,
  centerContent,
  bottomComposer,
  sidePanel,
  overlay,
  centerOverlay,
  rightPane,
  className
}: AgentChatFrameProps) => {
  const shell =
    centerContent !== undefined ? (
      <ChatAppShell
        pane={pane}
        paneOpen={paneOpen}
        panePosition={panePosition}
        topBar={topBar}
        centerContent={centerContent}
        sidePanel={sidePanel}
        centerOverlay={centerOverlay}
        overlay={overlay}
      />
    ) : (
      <ChatAppShell
        pane={pane}
        paneOpen={paneOpen}
        panePosition={panePosition}
        topBar={topBar}
        main={main ?? null}
        bottomComposer={bottomComposer}
        sidePanel={sidePanel}
        centerOverlay={centerOverlay}
        overlay={overlay}
      />
    )

  return (
    <Container className={className}>
      <QuickPanelProvider>{shell}</QuickPanelProvider>
      {rightPane}
    </Container>
  )
}

const Container = ({ children, className }: PropsWithChildren<{ className?: string }>) => {
  return (
    <div
      className={cn(
        'flex h-[calc(100vh-var(--navbar-height)-6px)] flex-1 overflow-hidden rounded-tl-[10px] rounded-bl-[10px] bg-background',
        className
      )}>
      {children}
    </div>
  )
}

export default AgentChat
