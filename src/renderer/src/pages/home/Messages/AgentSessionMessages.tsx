import { loggerService } from '@logger'
import ContextMenu from '@renderer/components/ContextMenu'
import { useSession } from '@renderer/hooks/agents/useSession'
import { useTopicMessages } from '@renderer/hooks/useMessageOperations'
import { getGroupedMessages } from '@renderer/services/MessagesService'
import { type Topic, TopicType } from '@renderer/types'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import { Spin } from 'antd'
import { memo, useMemo } from 'react'
import styled from 'styled-components'

import MessageGroup from './MessageGroup'
import NarrowLayout from './NarrowLayout'
import PermissionModeDisplay from './PermissionModeDisplay'
import { MessagesContainer, ScrollContainer } from './shared'

const logger = loggerService.withContext('AgentSessionMessages')

type Props = {
  agentId: string
  sessionId: string
}

const AgentSessionMessages: React.FC<Props> = ({ agentId, sessionId }) => {
  const { session } = useSession(agentId, sessionId)
  const sessionTopicId = useMemo(() => buildAgentSessionTopicId(sessionId), [sessionId])
  // Use the same hook as Messages.tsx for consistent behavior
  const messages = useTopicMessages(sessionTopicId)

  const displayMessages = useMemo(() => {
    if (!messages || messages.length === 0) return []
    return [...messages].reverse()
  }, [messages])

  const groupedMessages = useMemo(() => {
    if (!displayMessages || displayMessages.length === 0) return []
    return Object.entries(getGroupedMessages(displayMessages))
  }, [displayMessages])

  const sessionAssistantId = session?.agent_id ?? agentId
  const sessionName = session?.name ?? sessionId
  const sessionCreatedAt = session?.created_at ?? session?.updated_at ?? FALLBACK_TIMESTAMP
  const sessionUpdatedAt = session?.updated_at ?? session?.created_at ?? FALLBACK_TIMESTAMP

  const derivedTopic = useMemo<Topic>(
    () => ({
      id: sessionTopicId,
      type: TopicType.Session,
      assistantId: sessionAssistantId,
      name: sessionName,
      createdAt: sessionCreatedAt,
      updatedAt: sessionUpdatedAt,
      messages: []
    }),
    [sessionTopicId, sessionAssistantId, sessionName, sessionCreatedAt, sessionUpdatedAt]
  )

  logger.silly('Rendering agent session messages', {
    sessionId,
    messageCount: messages.length
  })

  return (
    <MessagesContainer id="messages" className="messages-container">
      <NarrowLayout style={{ display: 'flex', flexDirection: 'column-reverse' }}>
        <ContextMenu>
          <ScrollContainer>
            {groupedMessages.length > 0 ? (
              groupedMessages.map(([key, groupMessages]) => (
                <MessageGroup key={key} messages={groupMessages} topic={derivedTopic} />
              ))
            ) : session ? (
              <PermissionModeDisplay session={session} agentId={agentId} />
            ) : (
              <LoadingState>
                <Spin size="small" />
              </LoadingState>
            )}
          </ScrollContainer>
        </ContextMenu>
      </NarrowLayout>
    </MessagesContainer>
  )
}

const LoadingState = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 20px 0;
`

const FALLBACK_TIMESTAMP = '1970-01-01T00:00:00.000Z'

export default memo(AgentSessionMessages)
