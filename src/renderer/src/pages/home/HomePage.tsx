import { useAssistants } from '@renderer/hooks/useAssistant'
import { useChat } from '@renderer/hooks/useChat'
import { useSettings } from '@renderer/hooks/useSettings'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import NavigationService from '@renderer/services/NavigationService'
import { FC, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import styled from 'styled-components'

import Chat from './Chat'
import ChatNavbar from './ChatNavbar'

const HomePage: FC = () => {
  const { assistants } = useAssistants()
  const navigate = useNavigate()

  const location = useLocation()
  const state = location.state

  const { activeAssistant, activeTopic, setActiveAssistant, setActiveTopic } = useChat()
  const { showAssistants, showTopics, topicPosition } = useSettings()

  useEffect(() => {
    NavigationService.setNavigate(navigate)
  }, [navigate])

  useEffect(() => {
    state?.assistant && setActiveAssistant(state?.assistant)
    state?.topic && setActiveTopic(state?.topic)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  useEffect(() => {
    const unsubscribe = EventEmitter.on(EVENT_NAMES.SWITCH_ASSISTANT, (assistantId: string) => {
      const newAssistant = assistants.find((a) => a.id === assistantId)
      if (newAssistant) {
        setActiveAssistant(newAssistant)
      }
    })

    return () => {
      unsubscribe()
    }
  }, [assistants, setActiveAssistant])

  useEffect(() => {
    const canMinimize = topicPosition == 'left' ? !showAssistants : !showAssistants && !showTopics
    window.api.window.setMinimumSize(canMinimize ? 520 : 1080, 600)

    return () => {
      window.api.window.resetMinimumSize()
    }
  }, [showAssistants, showTopics, topicPosition])

  return (
    <Container id="home-page">
      <ChatNavbar activeAssistant={activeAssistant} position="left" />
      <ContentContainer id="content-container">
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
  overflow: hidden;
`

export default HomePage
