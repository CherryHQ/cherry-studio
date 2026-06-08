import { usePreference } from '@data/hooks/usePreference'
import { useCache } from '@renderer/data/hooks/useCache'
import { useAgent, useAgents } from '@renderer/hooks/agents/useAgent'
import { useActiveSession } from '@renderer/hooks/agents/useSession'
import { useAgentSessionParts } from '@renderer/hooks/useAgentSessionParts'
import { useChatWithHistory } from '@renderer/hooks/useChatWithHistory'
import { useExecutionOverlay } from '@renderer/hooks/useExecutionOverlay'
import { useNavbarPosition } from '@renderer/hooks/useNavbar'
import { useSettings } from '@renderer/hooks/useSettings'
import { useTopicStreamStatus } from '@renderer/hooks/useTopicStreamStatus'
import type { Message } from '@renderer/types/newMessage'
import { cn } from '@renderer/utils'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import type { AgentEntity } from '@shared/data/types/agent'
import type { CherryMessagePart, ModelSnapshot } from '@shared/data/types/message'
import { isUniqueModelId, parseUniqueModelId } from '@shared/data/types/model'
import type { PropsWithChildren } from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { uiToMessage } from '../home/uiToMessage'
import AgentChatNavbar from './components/AgentChatNavbar'

const AgentChat = () => {
  const { t } = useTranslation()
  const { messageNavigation, messageStyle, topicPosition } = useSettings()
  const [showTopics] = usePreference('topic.tab.show')
  const [isMultiSelectMode] = useCache('chat.multi_select_mode')

  const { session: activeSession, isLoading: isSessionLoading } = useActiveSession()
  const { agent: activeAgent, isLoading: isAgentLoading } = useAgent(activeSession?.agentId ?? null)
  const { isLoading: isAgentsLoading, agents } = useAgents()

  const isInitializing = isAgentsLoading || isSessionLoading || (activeSession && isAgentLoading) || !agents

  const showRightSessions = topicPosition === 'right' && showTopics && !!activeSession

  if (isInitializing) {
    return (
      <AgentRightPane
        workspacePath={temporaryAgentConversation?.session.workspace?.path}
        traceId={temporaryAgentConversation?.session.traceId ?? undefined}
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

  if (!activeSession) {
    return (
      <Container className="flex flex-1 flex-col justify-between">
        <div className="flex h-full w-full items-center justify-center">
          <WarningAlert message={t('chat.alerts.create_session')} />
        </div>
      </Container>
    )
  }

  // Orphan session — its agent was deleted. Show a read-only placeholder; user
  // must reattach to another agent (UX TBD) or delete the session.
  if (!activeSession.agentId) {
    return (
      <Container className="flex flex-1 flex-col justify-between">
        <div className="flex h-full w-full items-center justify-center">
          <WarningAlert message={t('agent.session.orphan.message', 'This session’s agent has been deleted')} />
        </div>
      </Container>
    )
  }

  return (
    <AgentChatInner
      agentId={activeSession.agentId}
      sessionId={activeSession.id}
      activeAgent={activeAgent}
      showRightSessions={showRightSessions}
      messageNavigation={messageNavigation}
      messageStyle={messageStyle}
      isMultiSelectMode={isMultiSelectMode}
    />
  )
}

// ── Inner: mounted only when agentId + sessionId are resolved ──

interface InnerProps {
  agentId: string
  sessionId: string
  activeAgent: AgentEntity | undefined
  showRightSessions: boolean
  messageNavigation: string
  messageStyle: string
  isMultiSelectMode: boolean
}

const AgentChatInner = ({
  agentId,
  sessionId,
  activeAgent,
  showRightSessions,
  messageNavigation,
  messageStyle,
  isMultiSelectMode
}: InnerProps) => {
  const sessionTopicId = useMemo(() => buildAgentSessionTopicId(sessionId), [sessionId])
  const { messages: uiMessages, isLoading, hasOlder, loadOlder, refresh } = useAgentSessionParts(agentId, sessionId)
  const chat = useChatWithHistory(sessionTopicId, uiMessages, refresh)

  // ── Rendering pipeline ────────────────────────────────────────────
  const snapshot = useMemo<ModelSnapshot | undefined>(() => {
    if (!isUniqueModelId(activeAgent?.model)) return undefined
    const { providerId, modelId } = parseUniqueModelId(activeAgent.model)
    return { id: modelId, name: modelId, provider: providerId }
  }, [activeAgent?.model])

  const projectedMessages = useMemo<Message[]>(
    () =>
      uiMessages.map((m) =>
        uiToMessage(m, {
          assistantId: agentId,
          topicId: sessionTopicId,
          modelFallback: snapshot
        })
      ),
    [uiMessages, agentId, sessionTopicId, snapshot]
  )

  const basePartsMap = useMemo<Record<string, CherryMessagePart[]>>(() => {
    const map: Record<string, CherryMessagePart[]> = {}
    for (const m of uiMessages) map[m.id] = (m.parts ?? []) as CherryMessagePart[]
    return map
  }, [uiMessages])

  const { overlay } = useExecutionOverlay(sessionTopicId, chat.activeExecutions, uiMessages)

  const mergedPartsMap = useMemo<Record<string, CherryMessagePart[]>>(() => {
    const next = { ...basePartsMap }
    for (const [messageId, parts] of Object.entries(overlay)) {
      if (parts.length) next[messageId] = parts
    }
    return next
  }, [basePartsMap, overlay])

  const { isPending } = useTopicStreamStatus(sessionTopicId)

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
        topRightTool={
          <>
            <AgentRightPane.InfoCard disabled={rightPaneDisabled} />
            <AgentRightPane.FilesToggle disabled={rightPaneDisabled} />
          </>
        }
        topRightToolReserve="double"
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

const Container = ({ children, className }: PropsWithChildren<{ className?: string }>) => {
  const { isTopNavbar } = useNavbarPosition()

  return (
    <div
      className={cn(
        'flex flex-1 overflow-hidden',
        isTopNavbar && 'rounded-tl-[10px] rounded-bl-[10px] bg-(--color-background)',
        className
      )}>
      {children}
    </div>
  )
}

// Lightweight warning banner — replaces antd `<Alert type="warning">`.
// Mirrors the inline pattern in `MessageErrorBoundary.tsx`.
const WarningAlert = ({ message }: { message: string }) => (
  <div
    role="alert"
    className="mx-4 my-1 rounded-md border border-(--color-warning) bg-(--color-warning)/10 px-3 py-2 text-sm">
    {message}
  </div>
)

export default AgentChat
