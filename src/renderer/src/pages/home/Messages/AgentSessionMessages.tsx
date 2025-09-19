import { loggerService } from '@logger'
import ContextMenu from '@renderer/components/ContextMenu'
import Scrollbar from '@renderer/components/Scrollbar'
import { useSession } from '@renderer/hooks/agents/useSession'
import { ModelMessage } from 'ai'
import { memo } from 'react'
import styled from 'styled-components'

import NarrowLayout from './NarrowLayout'

const logger = loggerService.withContext('AgentSessionMessages')

type Props = {
  agentId: string
  sessionId: string
}

const AgentSessionMessages: React.FC<Props> = ({ agentId, sessionId }) => {
  const { messages } = useSession(agentId, sessionId)

  const getTextFromContent = (content: string | ModelMessage): string => {
    logger.debug('content', { content })
    if (typeof content === 'string') {
      return content
    } else if (typeof content.content === 'string') {
      return content.content
    } else {
      return content.content
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('\n')
    }
  }

  return (
    <MessagesContainer id="messages" className="messages-container">
      <NarrowLayout style={{ display: 'flex', flexDirection: 'column-reverse' }}>
        <ContextMenu>
          <ScrollContainer>
            {messages.toReversed().map((message) => {
              const content = getTextFromContent(message.content)
              return <div key={message.id}>{content}</div>
            })}
          </ScrollContainer>
        </ContextMenu>
      </NarrowLayout>
    </MessagesContainer>
  )
}

const ScrollContainer = styled.div`
  display: flex;
  flex-direction: column-reverse;
  padding: 10px 10px 20px;
  .multi-select-mode & {
    padding-bottom: 60px;
  }
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

export default memo(AgentSessionMessages)
