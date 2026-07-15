import { loggerService } from '@logger'
import MessageList from '@renderer/components/chat/messages/MessageList'
import { MessageListProvider } from '@renderer/components/chat/messages/MessageListProvider'
import { AskUserQuestionOptimisticInputProvider } from '@renderer/components/chat/messages/tools/agent'
import type { MessageListActions, MessageStreamingLayers } from '@renderer/components/chat/messages/types'
import { usePreference } from '@renderer/data/hooks/usePreference'
import { useSession } from '@renderer/hooks/agent/useSession'
import { ipcApi } from '@renderer/ipc'
import type { GetAgentResponse } from '@renderer/types/agent'
import { type Topic, TopicType, type TopicType as TopicTypeEnum } from '@renderer/types/topic'
import { getAgentAvatarFromConfiguration } from '@renderer/utils/agent'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import { memo, useEffect, useMemo } from 'react'

import { useAgentMessageListProviderValue } from '../messages/agentMessageListAdapter'

const logger = loggerService.withContext('AgentSessionMessages')

type Props = {
  agentId?: string
  sessionId: string
  messages: CherryUIMessage[]
  activeAgent?: GetAgentResponse
  partsByMessageId: Record<string, CherryMessagePart[]>
  streamingLayers?: MessageStreamingLayers
  optimisticAskUserQuestionInputsByToolCallId?: Record<string, unknown>
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
  streamingLayers,
  optimisticAskUserQuestionInputsByToolCallId = {},
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
  const assistantProfile = useMemo(
    () =>
      activeAgent
        ? {
            name: activeAgent.name,
            avatar: getAgentAvatarFromConfiguration(activeAgent.configuration)
          }
        : undefined,
    [activeAgent]
  )

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
    streamingLayers,
    assistantProfile,
    assistantId: agentId,
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
    void ipcApi.request('ai.prewarm_agent_session', { sessionId }).catch((error) => {
      logger.warn('Failed to prewarm agent session', error as Error)
    })
    return () => {
      void ipcApi.request('ai.close_agent_session_warm', { sessionId }).catch((error) => {
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
