import { loggerService } from '@logger'
import { useMessageImageCaptureMessages } from '@renderer/components/chat/messages/hooks/useMessageImageCaptureMessages'
import MessageImageCaptureHost from '@renderer/components/chat/messages/MessageImageCaptureHost'
import {
  getAgentSessionExportTitle,
  getAgentSessionMessagesForExport
} from '@renderer/services/AgentSessionExportService'
import type { GetAgentResponse } from '@renderer/types/agent'
import type { Topic } from '@renderer/types/topic'
import { TopicType, type TopicType as TopicTypeEnum } from '@renderer/types/topic'
import { getAgentAvatarFromConfiguration } from '@renderer/utils/agent'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import type { ModelSnapshot } from '@shared/data/types/message'
import { memo, useCallback, useMemo } from 'react'

import { useAgentMessageListProviderValue } from './agentMessageListAdapter'
import { rejectPendingAgentSessionImageActions } from './agentSessionImageActionBus'

const logger = loggerService.withContext('AgentSessionImageCaptureHost')

interface AgentSessionImageCaptureHostProps {
  activeAgent?: GetAgentResponse
  modelFallback?: ModelSnapshot
  session: AgentSessionEntity
}

const AgentSessionImageCaptureHost = ({ activeAgent, modelFallback, session }: AgentSessionImageCaptureHostProps) => {
  const topicId = useMemo(() => buildAgentSessionTopicId(session.id), [session.id])
  const loadMessages = useCallback(
    () => getAgentSessionMessagesForExport(session, { modelFallback }),
    [modelFallback, session]
  )
  const handleLoadError = useCallback(
    (error: unknown) => {
      logger.error('Failed to load agent session messages for image capture', error as Error, {
        sessionId: session.id
      })
      rejectPendingAgentSessionImageActions(session.id, error)
    },
    [session.id]
  )
  const { messages, partsByMessageId } = useMessageImageCaptureMessages({
    loadMessages,
    onError: handleLoadError
  })
  const sessionExportTitle = useMemo(() => getAgentSessionExportTitle(session), [session])

  const topic = useMemo<Topic>(
    () => ({
      id: topicId,
      type: TopicType.Session as TopicTypeEnum,
      assistantId: session.agentId ?? undefined,
      name: sessionExportTitle,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      messages: []
    }),
    [session.agentId, session.createdAt, session.updatedAt, sessionExportTitle, topicId]
  )

  const messageList = useAgentMessageListProviderValue({
    topic,
    messages: messages ?? [],
    partsByMessageId,
    assistantProfile: activeAgent
      ? {
          name: activeAgent.name,
          avatar: getAgentAvatarFromConfiguration(activeAgent.configuration)
        }
      : undefined,
    assistantId: session.agentId ?? undefined,
    modelFallback,
    isLoading: false,
    imageActionConsumer: 'capture',
    messageNavigation: 'anchor',
    workspacePath: session.workspace?.path
  })

  return (
    <MessageImageCaptureHost
      captureHostAttribute="data-agent-session-image-capture-host"
      messageList={messageList}
      ready={messages !== null}
      testId="agent-session-image-capture-host"
    />
  )
}

export default memo(AgentSessionImageCaptureHost)
