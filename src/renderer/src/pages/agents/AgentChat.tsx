import { usePreference } from '@data/hooks/usePreference'
import { QuickPanelProvider } from '@renderer/components/QuickPanel'
import { useCache } from '@renderer/data/hooks/useCache'
import { useActiveAgent } from '@renderer/hooks/agents/useActiveAgent'
import { useAgents } from '@renderer/hooks/agents/useAgentDataApi'
import { useCreateDefaultSession } from '@renderer/hooks/agents/useCreateDefaultSession'
import { useAgentSessionParts } from '@renderer/hooks/useAgentSessionParts'
import { useChatWithHistory } from '@renderer/hooks/useChatWithHistory'
import { useExecutionChats } from '@renderer/hooks/useExecutionChats'
import { useExecutionMessages } from '@renderer/hooks/useExecutionMessages'
import { useNavbarPosition } from '@renderer/hooks/useNavbar'
import { useSettings } from '@renderer/hooks/useSettings'
import { useShortcut } from '@renderer/hooks/useShortcuts'
import { useTopicStreamStatus } from '@renderer/hooks/useTopicStreamStatus'
import type { Message } from '@renderer/types/newMessage'
import { cn } from '@renderer/utils'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import type { CherryMessagePart, ModelSnapshot } from '@shared/data/types/message'
import { Alert, Spin } from 'antd'
import { AnimatePresence, motion } from 'motion/react'
import type { PropsWithChildren } from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { PinnedTodoPanel } from '../home/Inputbar/components/PinnedTodoPanel'
import ChatNavigation from '../home/Messages/ChatNavigation'
import ExecutionStreamCollector from '../home/Messages/ExecutionStreamCollector'
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
  const [activeAgentId] = useCache('agent.active_id')
  const [activeSessionIdMap] = useCache('agent.session.active_id_map')
  const [isMultiSelectMode] = useCache('chat.multi_select_mode')

  const activeSessionId = activeAgentId ? activeSessionIdMap[activeAgentId] : null
  // undefined = session not yet initialized, null = initialized but no sessions
  const isSessionInitialized = !activeAgentId || activeAgentId in activeSessionIdMap
  const { agent: activeAgent, isLoading: isAgentLoading } = useActiveAgent()
  const { isLoading: isAgentsLoading, agents } = useAgents()
  const { createDefaultSession } = useCreateDefaultSession(activeAgentId)

  // Don't show select/create alerts while data is still loading
  // apiServerRunning is guaranteed by AgentPage guard
  const isInitializing =
    isAgentsLoading || isAgentLoading || !isSessionInitialized || !agents || (!activeAgentId && agents.length > 0)

  const showRightSessions = topicPosition === 'right' && showTopics && !!activeAgentId

  useShortcut(
    'topic.new',
    () => {
      void createDefaultSession()
    },
    {
      enabled: true,
      preventDefault: true,
      enableOnFormTags: true
    }
  )

  if (isInitializing) {
    return (
      <Container className="flex flex-1 flex-col items-center justify-center">
        <Spin />
      </Container>
    )
  }

  // Initialized — agents.length === 0 is handled by AgentPage
  if (!activeAgentId) {
    return (
      <Container className="flex flex-1 flex-col justify-between">
        <div className="flex h-full w-full items-center justify-center">
          <Alert type="info" message={t('chat.alerts.select_agent')} style={{ margin: '5px 16px' }} />
        </div>
      </Container>
    )
  }

  if (!activeSessionId) {
    return (
      <Container className="flex flex-1 flex-col justify-between">
        <div className="flex h-full w-full items-center justify-center">
          <Alert type="warning" message={t('chat.alerts.create_session')} style={{ margin: '5px 16px' }} />
        </div>
      </Container>
    )
  }

  return (
    <AgentChatInner
      agentId={activeAgentId}
      sessionId={activeSessionId}
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
  activeAgent: ReturnType<typeof useActiveAgent>['agent']
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
  const { messages: uiMessages, isLoading, refresh } = useAgentSessionParts(agentId, sessionId)
  const chat = useChatWithHistory(sessionTopicId, uiMessages, refresh)

  // ── Rendering pipeline ────────────────────────────────────────────
  //
  // Mirrors V2ChatContent: uiMessages (agents.db snapshot) projected
  // into renderer Messages; streaming parts overlaid via per-execution
  // collectors. Main always tags chunks with the execution's modelId so
  // the collector's useChat receives them; primary useChat here is a
  // trigger-only wrapper (sendMessage/stop) and its `state.messages`
  // does not drive the visible list.
  const fallbackSnapshot = useMemo<ModelSnapshot | undefined>(() => {
    const modelString = activeAgent?.model
    if (!modelString) return undefined
    const [provider, id] = modelString.split(':')
    if (!provider || !id) return undefined
    return { id, name: id, provider }
  }, [activeAgent?.model])

  const projectedMessages = useMemo<Message[]>(
    () =>
      uiMessages.map((m) =>
        uiToMessage(m, {
          assistantId: agentId,
          topicId: sessionTopicId,
          modelFallback: fallbackSnapshot
        })
      ),
    [uiMessages, agentId, sessionTopicId, fallbackSnapshot]
  )

  const basePartsMap = useMemo<Record<string, CherryMessagePart[]>>(() => {
    const map: Record<string, CherryMessagePart[]> = {}
    for (const m of uiMessages) map[m.id] = (m.parts ?? []) as CherryMessagePart[]
    return map
  }, [uiMessages])

  const { executionMessagesById, handleExecutionMessagesChange, handleExecutionDispose } = useExecutionMessages()

  const executionChats = useExecutionChats(sessionTopicId, chat.activeExecutions)

  const mergedPartsMap = useMemo<Record<string, CherryMessagePart[]>>(() => {
    const next = { ...basePartsMap }
    for (const execMessages of Object.values(executionMessagesById)) {
      for (const uiMessage of execMessages) {
        if (uiMessage.role === 'assistant' && uiMessage.parts?.length) {
          next[uiMessage.id] = uiMessage.parts as CherryMessagePart[]
        }
      }
    }
    return next
  }, [basePartsMap, executionMessagesById])

  const { isPending } = useTopicStreamStatus(sessionTopicId)

  return (
    <Container className={cn(messageStyle, { 'multi-select-mode': isMultiSelectMode })}>
      <QuickPanelProvider>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-fit w-full min-w-0">
            {activeAgent && <AgentChatNavbar className="min-w-0" activeAgent={activeAgent} />}
          </div>

          <div className="translate-z-0 relative flex w-full flex-1 flex-col justify-between overflow-y-auto overflow-x-hidden">
            {chat.activeExecutions.map(({ executionId }) => {
              const execChat = executionChats.get(executionId)
              if (!execChat) return null
              return (
                <ExecutionStreamCollector
                  key={executionId}
                  executionId={executionId}
                  chat={execChat}
                  onMessagesChange={handleExecutionMessagesChange}
                  onDispose={handleExecutionDispose}
                />
              )
            })}

            <AgentSessionMessages
              agentId={agentId}
              sessionId={sessionId}
              adaptedMessages={projectedMessages}
              partsMap={mergedPartsMap}
              isLoading={isLoading}
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
              <Sessions agentId={agentId} />
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

export default AgentChat
