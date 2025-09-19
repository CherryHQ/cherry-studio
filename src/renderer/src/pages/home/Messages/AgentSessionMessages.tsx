import ContextMenu from '@renderer/components/ContextMenu'
import Scrollbar from '@renderer/components/Scrollbar'
import { useSession } from '@renderer/hooks/agents/useSession'
import { memo } from 'react'
import styled from 'styled-components'

import NarrowLayout from './NarrowLayout'

type Props = {
  agentId: string
  sessionId: string
}

const AgentSessionMessages: React.FC<Props> = ({ agentId, sessionId }) => {
  const { messages } = useSession(agentId, sessionId)

  return (
    <MessagesContainer id="messages" className="messages-container">
      <NarrowLayout style={{ display: 'flex', flexDirection: 'column-reverse' }}>
        <ContextMenu>
          <ScrollContainer>
            {messages.map((message) => {
              const content = message.content.content
              if (typeof content === 'string') {
                return <div key={message.id}>{content}</div>
              } else {
                return 'Not string content'
              }
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
