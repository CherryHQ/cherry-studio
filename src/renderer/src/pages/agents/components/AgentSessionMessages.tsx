import { loggerService } from '@logger'
import { useAgentMessageListProviderValue } from '@renderer/components/chat/messages/adapters/agentMessageListAdapter'
import { PartsProvider } from '@renderer/components/chat/messages/blocks'
import MessageList from '@renderer/components/chat/messages/MessageList'
import { MessageListProvider } from '@renderer/components/chat/messages/MessageListProvider'
import { usePreference } from '@renderer/data/hooks/usePreference'
import { useSession } from '@renderer/hooks/agents/useSessionDataApi'
import { ChatContextProvider, useChatContextProvider } from '@renderer/hooks/useChatContext'
import type { GetAgentResponse, Topic, TopicType as TopicTypeEnum } from '@renderer/types'
import { TopicType } from '@renderer/types'
import type { Message } from '@renderer/types/newMessage'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import type { CherryMessagePart } from '@shared/data/types/message'
import type { PropsWithChildren } from 'react'
import { memo, useMemo } from 'react'

const logger = loggerService.withContext('AgentSessionMessages')

type Props = {
  agentId: string
  sessionId: string
  adaptedMessages: Message[]
  activeAgent?: GetAgentResponse
  partsMap: Record<string, CherryMessagePart[]>
  isLoading: boolean
  /** Whether more older messages remain on the server (cursor pagination). */
  hasOlder?: boolean
  /** Trigger fetching the next older page. */
  loadOlder?: () => void
}

const AgentSessionMessages = ({
  agentId,
  sessionId,
  adaptedMessages,
  activeAgent,
  partsMap,
  isLoading,
  hasOlder = false,
  loadOlder
}: Props) => {
  const { session } = useSession(sessionId)
  const sessionTopicId = useMemo(() => buildAgentSessionTopicId(sessionId), [sessionId])
  const [messageNavigation] = usePreference('chat.message.navigation_mode')

  const sessionAssistantId = session?.agentId ?? agentId
  const sessionName = session?.name ?? sessionId
  const sessionCreatedAt = session?.createdAt ?? session?.updatedAt ?? FALLBACK_TIMESTAMP
  const sessionUpdatedAt = session?.updatedAt ?? session?.createdAt ?? FALLBACK_TIMESTAMP

  const derivedTopic = useMemo<Topic>(
    () => ({
      id: sessionTopicId,
      type: TopicType.Session as TopicTypeEnum,
      assistantId: sessionAssistantId,
      name: sessionName,
      createdAt: sessionCreatedAt,
      updatedAt: sessionUpdatedAt,
      messages: []
    }),
    [sessionTopicId, sessionAssistantId, sessionName, sessionCreatedAt, sessionUpdatedAt]
  )

  const messageList = useAgentMessageListProviderValue({
    topic: derivedTopic,
    messages: adaptedMessages,
    assistantProfile: activeAgent
      ? {
          name: activeAgent.name,
          avatar: activeAgent.configuration?.avatar
        }
      : undefined,
    isLoading,
    hasOlder,
    loadOlder,
    messageNavigation,
    partsMap
  })

  logger.silly('Rendering agent session messages', {
    sessionId,
    messageCount: adaptedMessages.length,
    hasOlder
  })

  return (
    <PartsProvider value={partsMap}>
      <AgentSessionChatContextBridge topic={derivedTopic}>
        <MessageListProvider value={messageList}>
          <MessageList />
        </MessageListProvider>
      </AgentSessionChatContextBridge>
    </PartsProvider>
  )
}

const AgentSessionChatContextBridge = ({ topic, children }: PropsWithChildren<{ topic: Topic }>) => {
  const chatContextValue = useChatContextProvider(topic)
  return <ChatContextProvider value={chatContextValue}>{children}</ChatContextProvider>
}

const FALLBACK_TIMESTAMP = '1970-01-01T00:00:00.000Z'

export default memo(AgentSessionMessages)
