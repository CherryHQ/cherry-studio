import { loggerService } from '@logger'
import ContextMenu from '@renderer/components/ContextMenu'
import Scrollbar from '@renderer/components/Scrollbar'
import { useSession } from '@renderer/hooks/agents/useSession'
import Blocks from '@renderer/pages/home/Messages/Blocks'
import { useAppSelector } from '@renderer/store'
import { selectMessagesForTopic } from '@renderer/store/newMessage'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import { useMemo } from 'react'
import styled from 'styled-components'

import NarrowLayout from './NarrowLayout'

const logger = loggerService.withContext('AgentSessionMessages')

type Props = {
  agentId: string
  sessionId: string
}

const AgentSessionMessages: React.FC<Props> = ({ agentId, sessionId }) => {
  const { session } = useSession(agentId, sessionId)
  const sessionTopicId = useMemo(() => buildAgentSessionTopicId(sessionId), [sessionId])
  const messages = useAppSelector((state) => selectMessagesForTopic(state, sessionTopicId))

  logger.silly('Rendering agent session messages', {
    sessionId,
    messageCount: messages.length
  })

  return (
    <MessagesContainer id="messages" className="messages-container">
      <NarrowLayout style={{ display: 'flex', flexDirection: 'column-reverse' }}>
        <ContextMenu>
          <ScrollContainer>
            {messages
              .slice()
              .reverse()
              .map((message) => (
                <MessageRow key={message.id} $role={message.role}>
                  <Blocks blocks={message.blocks ?? []} message={message} />
                </MessageRow>
              ))}
            {!messages.length && <EmptyState>{session ? 'No messages yet.' : 'Loading session...'}</EmptyState>}
          </ScrollContainer>
        </ContextMenu>
      </NarrowLayout>
    </MessagesContainer>
  )
}

const ScrollContainer = styled.div`
  display: flex;
  flex-direction: column-reverse;
  gap: 12px;
  padding: 10px 10px 20px;
  .multi-select-mode & {
    padding-bottom: 60px;
  }
`

const MessageRow = styled.div<{ $role: string }>`
  display: flex;
  flex-direction: column;
  align-items: ${(props) => (props.$role === 'user' ? 'flex-end' : 'flex-start')};
  .block-wrapper {
    max-width: 700px;
  }
`

const EmptyState = styled.div`
  color: var(--color-text-3);
  font-size: 12px;
  text-align: center;
  padding: 20px 0;
`

interface ContainerProps {
  $right?: boolean
}

const MessagesContainer = styled(Scrollbar)<ContainerProps>`
  display: flex;
  flex-direction: column-reverse;
  overflow-x: hidden;
  z-index: 1;
  position: relative;
`

export default AgentSessionMessages
