import { useAssistants } from '@renderer/hooks/useAssistant'
import { useShowAssistants } from '@renderer/hooks/useStore'
import { useActiveTopic } from '@renderer/hooks/useTopic'
import { Assistant } from '@renderer/types'
import { FC, useState } from 'react'
import styled from 'styled-components'

import Chat from './Chat'
import Navbar from './Navbar'
import RightSidebar from './RightSidebar'

let _activeAssistant: Assistant

const HomePage: FC = () => {
  const { assistants } = useAssistants()
  const [activeAssistant, setActiveAssistant] = useState(_activeAssistant || assistants[0])
  const { showAssistants } = useShowAssistants()
  const { activeTopic, setActiveTopic } = useActiveTopic(activeAssistant)

  _activeAssistant = activeAssistant

  return (
    <Container>
      <Navbar activeAssistant={activeAssistant} activeTopic={activeTopic} setActiveTopic={setActiveTopic} />
      <ContentContainer>
        {showAssistants && (
          <RightSidebar
            activeAssistant={activeAssistant}
            activeTopic={activeTopic}
            setActiveAssistant={setActiveAssistant}
            setActiveTopic={setActiveTopic}
            position="left"
          />
        )}
        <Chat
          assistant={activeAssistant}
          activeTopic={activeTopic}
          setActiveTopic={setActiveTopic}
          setActiveAssistant={setActiveAssistant}
        />
      </ContentContainer>
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
`

const ContentContainer = styled.div`
  display: flex;
  flex: 1;
  flex-direction: row;
  background-color: var(--color-background);
`

export default HomePage
