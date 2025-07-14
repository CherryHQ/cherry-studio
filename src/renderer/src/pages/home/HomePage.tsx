import { useAssistants } from '@renderer/hooks/useAssistant'
import { useSettings } from '@renderer/hooks/useSettings'
import { useActiveTopic } from '@renderer/hooks/useTopic'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import NavigationService from '@renderer/services/NavigationService'
import { Assistant, Topic } from '@renderer/types'
import { FC, startTransition, useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import styled from 'styled-components'

import Chat from './Chat'
import Navbar from './Navbar'
import HomeTabs from './Tabs'

let _activeAssistant: Assistant

const HomePage: FC = () => {
  const { assistants } = useAssistants()
  const navigate = useNavigate()

  const location = useLocation()
  const state = location.state

  const [activeAssistant, _setActiveAssistant] = useState(state?.assistant || _activeAssistant || assistants[0])
  const { activeTopic, setActiveTopic: _setActiveTopic } = useActiveTopic(activeAssistant?.id, state?.topic)
  const { showAssistants, showTopics, topicPosition } = useSettings()

  _activeAssistant = activeAssistant

  const setActiveAssistant = useCallback(
    (newAssistant: Assistant) => {
      startTransition(() => {
        _setActiveAssistant(newAssistant)
        // 同步更新 active topic，避免不必要的重新渲染
        const newTopic = newAssistant.topics[0]
        _setActiveTopic((prev) => (newTopic?.id === prev.id ? prev : newTopic))
      })
    },
    [_setActiveTopic]
  )

  const setActiveTopic = useCallback(
    (newTopic: Topic) => {
      startTransition(() => _setActiveTopic((prev) => (newTopic?.id === prev.id ? prev : newTopic)))
    },
    [_setActiveTopic]
  )

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
      <Navbar
        activeAssistant={activeAssistant}
        activeTopic={activeTopic}
        setActiveTopic={setActiveTopic}
        setActiveAssistant={setActiveAssistant}
        position="left"
      />
      <ContentContainer id="content-container">
        {showAssistants && (
          <HomeTabs
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
  max-width: calc(100vw - var(--sidebar-width));
`

const ContentContainer = styled.div`
  display: flex;
  flex: 1;
  flex-direction: row;
  overflow: hidden;
`

export default HomePage
