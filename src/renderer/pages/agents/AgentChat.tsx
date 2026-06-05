import { usePreference } from '@data/hooks/usePreference'
import { QuickPanelProvider } from '@renderer/components/QuickPanel'
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
import { Loader2 } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import type { PropsWithChildren } from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { PinnedTodoPanel } from '../home/Inputbar/components/PinnedTodoPanel'
import ChatNavigation from '../home/Messages/ChatNavigation'
import NarrowLayout from '../home/Messages/NarrowLayout'
import { uiToMessage } from '../home/uiToMessage'
import AgentChatNavbar from './components/AgentChatNavbar'
import AgentSessionInputbar from './components/AgentSessionInputbar'
import AgentSessionMessages from './components/AgentSessionMessages'
import Sessions from './components/Sessions'

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
      <Container className="flex flex-1 flex-col items-center justify-center">
        <Loader2 className="size-6 animate-spin text-(--color-text-3)" />
      </Container>
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
    <Container className={cn(messageStyle, { 'multi-select-mode': isMultiSelectMode })}>
      <QuickPanelProvider>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-fit w-full min-w-0">
            {activeAgent && <AgentChatNavbar className="min-w-0" activeAgent={activeAgent} />}
          </div>

          <div className="translate-z-0 relative flex w-full flex-1 flex-col justify-between overflow-y-auto overflow-x-hidden">
            <AgentSessionMessages
              agentId={agentId}
              sessionId={sessionId}
              adaptedMessages={projectedMessages}
              partsMap={mergedPartsMap}
              isLoading={isLoading}
              hasOlder={hasOlder}
              loadOlder={loadOlder}
            />
            <div className="mt-auto px-4.5 pb-2">
              <NarrowLayout>
                <PinnedTodoPanel messages={projectedMessages} partsMap={mergedPartsMap} />
              </NarrowLayout>
            </div>
            {messageNavigation === 'buttons' && <ChatNavigation containerId="messages" />}
          </div>

          <AgentSessionInputbar
            agentId={agentId}
            sessionId={sessionId}
            sendMessage={chat.sendMessage}
            stop={chat.stop}
            isStreaming={isPending}
          />
        </div>
      </QuickPanelProvider>

      <AnimatePresence initial={false}>
        {showRightSessions && (
          <motion.div
            key="right-sessions"
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 'var(--assistants-width)', opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
            className="overflow-hidden">
            <div className="flex h-full w-(--assistants-width) flex-col overflow-hidden">
              <Sessions />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Container>
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
