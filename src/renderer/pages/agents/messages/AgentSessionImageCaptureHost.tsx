// oxlint-disable typescript/no-unnecessary-type-assertion -- tsgolint 7 false-positives vs tsc 7 (see #17746)
import { memo, useCallback, useMemo, useRef } from 'react'

import { loggerService } from '@logger'
import { useMessageImageCaptureMessages } from '@renderer/components/chat/messages/hooks/useMessageImageCaptureMessages'
import MessageImageCaptureHost from '@renderer/components/chat/messages/MessageImageCaptureHost'
import { getAgentSessionExportTitle, getAgentSessionMessagesForExport } from '@renderer/services/agentSessionExport'
import type { GetAgentResponse } from '@renderer/types/agent'
import type { Topic } from '@renderer/types/topic'
import { TopicType, type TopicType as TopicTypeEnum } from '@renderer/types/topic'
import { getAgentAvatarFromConfiguration } from '@renderer/utils/agent'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import type { ModelSnapshot } from '@shared/data/types/message'

import { useAgentMessageListProviderValue } from './agentMessageListAdapter'
import { rejectPendingAgentSessionImageActions } from './agentSessionImageActionBus'

const logger = loggerService.withContext('AgentSessionImageCaptureHost')

interface AgentSessionImageCaptureHostProps {
  activeAgent?: GetAgentResponse
  modelFallback?: ModelSnapshot
  session: AgentSessionEntity
}

const AgentSessionImageCaptureHost = ({ activeAgent, modelFallback, session }: AgentSessionImageCaptureHostProps) => {
  const captureTarget = useRef({ activeAgent, modelFallback, session }).current
  const topicId = useMemo(() => buildAgentSessionTopicId(captureTarget.session.id), [captureTarget.session.id])
  const loadMessages = useCallback(
    () => getAgentSessionMessagesForExport(captureTarget.session, { modelFallback: captureTarget.modelFallback }),
    [captureTarget]
  )
  const handleLoadError = useCallback(
    (error: unknown) => {
      logger.error('Failed to load agent session messages for image capture', error as Error, {
        sessionId: captureTarget.session.id
      })
      rejectPendingAgentSessionImageActions(captureTarget.session.id, error)
    },
    [captureTarget.session.id]
  )
  const { messages, partsByMessageId } = useMessageImageCaptureMessages({
    loadMessages,
    onError: handleLoadError
  })
  const sessionExportTitle = useMemo(() => getAgentSessionExportTitle(captureTarget.session), [captureTarget.session])

  const topic = useMemo<Topic>(
    () => ({
      id: topicId,
      type: TopicType.Session as TopicTypeEnum,
      assistantId: captureTarget.session.agentId ?? undefined,
      name: sessionExportTitle,
      lastActivityAt: captureTarget.session.lastActivityAt,
      createdAt: captureTarget.session.createdAt,
      updatedAt: captureTarget.session.updatedAt,
      messages: []
    }),
    [captureTarget.session, sessionExportTitle, topicId]
  )

  const messageList = useAgentMessageListProviderValue({
    topic,
    messages: messages ?? [],
    partsByMessageId,
    assistantProfile: captureTarget.activeAgent
      ? {
          name: captureTarget.activeAgent.name,
          avatar: getAgentAvatarFromConfiguration(captureTarget.activeAgent.configuration)
        }
      : undefined,
    assistantId: captureTarget.session.agentId ?? undefined,
    isLoading: false,
    imageActionConsumer: 'capture',
    messageNavigation: 'anchor',
    workspacePath: captureTarget.session.workspace?.path
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
