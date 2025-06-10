import AddAssistantPopup from '@renderer/components/Popups/AddAssistantPopup'
import { useAssistants, useDefaultAssistant } from '@renderer/hooks/useAssistant'
import { Assistant, Topic } from '@renderer/types'
import { uuid } from '@renderer/utils'
import { FC } from 'react'
import styled from 'styled-components'

import Assistants from './AssistantsTab'
import Settings from './SettingsTab'
import Topics from './TopicsTab'

interface Props {
  tab: Tab
  activeAssistant: Assistant
  activeTopic: Topic
  setActiveAssistant: (assistant: Assistant) => void
  setActiveTopic: (topic: Topic) => void
  style?: React.CSSProperties
}

type Tab = 'assistants' | 'topic' | 'settings'

const HomeTabs: FC<Props> = ({ tab, activeAssistant, activeTopic, setActiveAssistant, setActiveTopic, style }) => {
  const { addAssistant } = useAssistants()
  const { defaultAssistant } = useDefaultAssistant()

  const onCreateAssistant = async () => {
    const assistant = await AddAssistantPopup.show()
    assistant && setActiveAssistant(assistant)
  }

  const onCreateDefaultAssistant = () => {
    const assistant = { ...defaultAssistant, id: uuid() }
    addAssistant(assistant)
    setActiveAssistant(assistant)
  }

  return (
    <Container style={{ ...style }} className="home-tabs">
      <TabContent className="home-tabs-content">
        {tab === 'assistants' && (
          <Assistants
            activeAssistant={activeAssistant}
            setActiveAssistant={setActiveAssistant}
            onCreateAssistant={onCreateAssistant}
            onCreateDefaultAssistant={onCreateDefaultAssistant}
          />
        )}
        {tab === 'topic' && (
          <Topics assistant={activeAssistant} activeTopic={activeTopic} setActiveTopic={setActiveTopic} />
        )}
        {tab === 'settings' && <Settings assistant={activeAssistant} />}
      </TabContent>
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  max-width: var(--assistants-width);
  min-width: var(--assistants-width);
  background-color: transparent;
  overflow: hidden;
  .collapsed {
    width: 0;
    border-left: none;
  }
`

const TabContent = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  overflow-y: auto;
  overflow-x: hidden;
`

export default HomeTabs
