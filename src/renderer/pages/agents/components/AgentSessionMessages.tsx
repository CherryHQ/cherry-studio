import { loggerService } from '@logger'
import MessageList from '@renderer/components/chat/messages/MessageList'
import { MessageListProvider } from '@renderer/components/chat/messages/MessageListProvider'
import { AskUserQuestionOptimisticInputProvider } from '@renderer/components/chat/messages/tools/agent/AskUserQuestionOptimisticContext'
import type { MessageListActions } from '@renderer/components/chat/messages/types'
import { usePreference } from '@renderer/data/hooks/usePreference'
import { useSession } from '@renderer/hooks/agents/useSession'
import type { GetAgentResponse, Topic, TopicType as TopicTypeEnum } from '@renderer/types'
import { TopicType } from '@renderer/types'
import { getAgentAvatarFromConfiguration } from '@renderer/utils/agent'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import type { CherryMessagePart, CherryUIMessage, ModelSnapshot } from '@shared/data/types/message'
import { memo, useEffect, useMemo } from 'react'

import { useAgentMessageListProviderValue } from '../messages/agentMessageListAdapter'

const logger = loggerService.withContext('AgentSessionMessages')

type Props = {
  agentId?: string
  sessionId: string
  messages: CherryUIMessage[]
  activeAgent?: GetAgentResponse
  partsByMessageId: Record<string, CherryMessagePart[]>
  optimisticAskUserQuestionInputsByToolCallId?: Record<string, unknown>
  modelFallback?: ModelSnapshot
  isLoading: boolean
  /** Whether more older messages remain on the server (cursor pagination). */
  hasOlder?: boolean
  /** Trigger fetching the next older page. */
  loadOlder?: () => void
  onOpenCitationsPanel?: MessageListActions['openCitationsPanel']
  openAgentToolFlow?: MessageListActions['openAgentToolFlow']
  openArtifactFile?: MessageListActions['openArtifactFile']
  deleteMessage?: MessageListActions['deleteMessage']
  respondToolApproval?: MessageListActions['respondToolApproval']
}

const AgentSessionMessages = ({
  agentId,
  sessionId,
  messages,
  activeAgent,
  partsByMessageId,
  optimisticAskUserQuestionInputsByToolCallId = {},
  modelFallback,
  isLoading,
  hasOlder = false,
  loadOlder,
  onOpenCitationsPanel,
  openAgentToolFlow,
  openArtifactFile,
  deleteMessage,
  respondToolApproval
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
    messages,
    partsByMessageId,
    assistantProfile: activeAgent
      ? {
          name: activeAgent.name,
          avatar: getAgentAvatarFromConfiguration(activeAgent.configuration)
        }
      : undefined,
    assistantId: agentId,
    modelFallback,
    isLoading,
    hasOlder,
    loadOlder,
    openCitationsPanel: onOpenCitationsPanel,
    openAgentToolFlow,
    openArtifactFile,
    deleteMessage,
    respondToolApproval,
    messageNavigation,
    workspacePath: session?.workspace?.path
  })

  useEffect(() => {
    void window.api.ai.prewarmAgentSession({ sessionId }).catch((error) => {
      logger.warn('Failed to prewarm agent session', error as Error)
    })
    return () => {
      void window.api.ai.closeAgentSessionWarm({ sessionId }).catch((error) => {
        logger.warn('Failed to close agent session warm query', error as Error)
      })
    }
  }, [sessionId])

  return (
    <AskUserQuestionOptimisticInputProvider value={optimisticAskUserQuestionInputsByToolCallId}>
      <MessageListProvider value={messageList}>
        <MessageList />
      </MessageListProvider>
    </AskUserQuestionOptimisticInputProvider>
  )
}

const FALLBACK_TIMESTAMP = '1970-01-01T00:00:00.000Z'

export default memo(AgentSessionMessages)
