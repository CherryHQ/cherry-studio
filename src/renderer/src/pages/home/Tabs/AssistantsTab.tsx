import Scrollbar from '@renderer/components/Scrollbar'
import { Assistant } from '@renderer/types'
import { FC, useRef } from 'react'
import styled from 'styled-components'

import { AgentSection } from './components/AgentSection'
import Assistants from './components/Assistants'

interface AssistantsTabProps {
  activeAssistant: Assistant
  setActiveAssistant: (assistant: Assistant) => void
  onCreateAssistant: () => void
  onCreateDefaultAssistant: () => void
}

const AssistantsTab: FC<AssistantsTabProps> = (props) => {
  const containerRef = useRef<HTMLDivElement>(null)
  return (
    <Container className="assistants-tab" ref={containerRef}>
      <AgentSection />
      <Assistants {...props} />
    </Container>
  )
}

const Container = styled(Scrollbar)`
  display: flex;
  flex-direction: column;
  padding: 10px;
  margin-top: 3px;
`

export default AssistantsTab
