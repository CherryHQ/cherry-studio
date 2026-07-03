import { loggerService } from '@logger'
import MessageList from '@renderer/components/chat/messages/MessageList'
import { MessageListProvider } from '@renderer/components/chat/messages/MessageListProvider'
import { getAgentSessionMessagesForExport } from '@renderer/services/AgentSessionExportService'
import type { GetAgentResponse } from '@renderer/types/agent'
import type { MessageExportView } from '@renderer/types/messageExport'
import type { Topic } from '@renderer/types/topic'
import { TopicType, type TopicType as TopicTypeEnum } from '@renderer/types/topic'
import { getAgentAvatarFromConfiguration } from '@renderer/utils/agent'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import { memo, useEffect, useMemo, useState } from 'react'

import { useAgentMessageListProviderValue } from './agentMessageListAdapter'
import { rejectPendingAgentSessionImageActions } from './agentSessionImageActionBus'

const logger = loggerService.withContext('AgentSessionImageCaptureHost')

interface AgentSessionImageCaptureHostProps {
  activeAgent?: GetAgentResponse
  session: AgentSessionEntity
}

function exportViewToUIMessage(message: MessageExportView): CherryUIMessage {
  const metadata: CherryUIMessage['metadata'] = {
    status: message.status,
    createdAt: message.createdAt
  }

  if (message.updatedAt) metadata.updatedAt = message.updatedAt
  if (message.parentId !== undefined) metadata.parentId = message.parentId
  if (message.siblingsGroupId !== undefined) metadata.siblingsGroupId = message.siblingsGroupId
  if (message.modelId) metadata.modelId = message.modelId
  if (message.model) metadata.modelSnapshot = message.model
  if (message.stats) {
    metadata.stats = message.stats
    if (message.stats.totalTokens) metadata.totalTokens = message.stats.totalTokens
  }

  return {
    id: message.id,
    role: message.role,
    parts: message.parts as CherryUIMessage['parts'],
    metadata
  } as CherryUIMessage
}

function createPartsByMessageId(messages: CherryUIMessage[]): Record<string, CherryMessagePart[]> {
  const partsByMessageId: Record<string, CherryMessagePart[]> = {}
  for (const message of messages) {
    partsByMessageId[message.id] = (message.parts ?? []) as CherryMessagePart[]
  }
  return partsByMessageId
}

const AgentSessionImageCaptureHost = ({ activeAgent, session }: AgentSessionImageCaptureHostProps) => {
  const [messages, setMessages] = useState<CherryUIMessage[] | null>(null)
  const topicId = useMemo(() => buildAgentSessionTopicId(session.id), [session.id])

  useEffect(() => {
    let cancelled = false
    setMessages(null)

    void getAgentSessionMessagesForExport(session)
      .then((exportMessages) => {
        if (!cancelled) setMessages(exportMessages.map(exportViewToUIMessage))
      })
      .catch((error) => {
        if (cancelled) return
        logger.error('Failed to load agent session messages for image capture', error as Error, {
          sessionId: session.id
        })
        rejectPendingAgentSessionImageActions(session.id, error)
      })

    return () => {
      cancelled = true
    }
  }, [session])

  const partsByMessageId = useMemo(() => (messages ? createPartsByMessageId(messages) : {}), [messages])

  const topic = useMemo<Topic>(
    () => ({
      id: topicId,
      type: TopicType.Session as TopicTypeEnum,
      assistantId: session.agentId ?? undefined,
      name: session.name,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      messages: []
    }),
    [session.agentId, session.createdAt, session.name, session.updatedAt, topicId]
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
    isLoading: false,
    imageActionConsumer: 'capture',
    messageNavigation: 'anchor',
    workspacePath: session.workspace?.path
  })

  if (!messages) return null

  return (
    <div
      aria-hidden="true"
      className="-left-[10000px] pointer-events-none fixed top-0 h-px w-[960px] overflow-hidden bg-background text-foreground"
      data-agent-session-image-capture-host>
      <MessageListProvider value={messageList}>
        <MessageList />
      </MessageListProvider>
    </div>
  )
}

export default memo(AgentSessionImageCaptureHost)
