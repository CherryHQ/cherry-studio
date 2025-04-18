import { ActiveTopicProvider, useActiveTopicContext } from '@renderer/context/ActiveTopicContext'
import { useAssistants } from '@renderer/hooks/useAssistant'
import { useSettings } from '@renderer/hooks/useSettings'
import NavigationService from '@renderer/services/NavigationService'
import { useAppDispatch } from '@renderer/store'
import { setActiveTopic as setActiveTopicAction } from '@renderer/store/topics'
import { Assistant } from '@renderer/types'
import { FC, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import styled from 'styled-components'

import Chat from './Chat'
import Navbar from './Navbar'
import HomeTabs from './Tabs'

let _selectedAssistant: Assistant | null

const HomePageContent: FC = () => {
  const { assistants } = useAssistants()
  const navigate = useNavigate()
  const dispatch = useAppDispatch()

  const location = useLocation()
  const state = location.state

  const { activeTopic } = useActiveTopicContext()

  // 兼容旧版本，仅仅用于筛选话题
  const [selectedAssistant, setSelectedAssistant] = useState(state?.assistant || _selectedAssistant || null)

  _selectedAssistant = selectedAssistant

  const { showAssistants, showTopics, topicPosition } = useSettings()

  const activeAssistant = useMemo(
    () =>
      activeTopic?.assistantId
        ? assistants.find((a) => a.id === activeTopic.assistantId) || assistants[0]
        : assistants[0],
    [activeTopic, assistants]
  )

  useEffect(() => {
    NavigationService.setNavigate(navigate)
  }, [navigate])

  useEffect(() => {
    state?.topic && dispatch(setActiveTopicAction(state.topic))
  }, [state, dispatch])

  useEffect(() => {
    const canMinimize = topicPosition == 'left' ? !showAssistants : !showAssistants && !showTopics
    window.api.window.setMinimumSize(canMinimize ? 520 : 1080, 600)

    return () => {
      window.api.window.resetMinimumSize()
    }
  }, [showAssistants, showTopics, topicPosition])

  return (
    <Container id="home-page">
      <Navbar />
      <ContentContainer id="content-container">
        {showAssistants && (
          <HomeTabs
            selectedAssistant={selectedAssistant}
            setSelectedAssistant={setSelectedAssistant}
            activeAssistant={activeAssistant}
            position="left"
          />
        )}

        <Chat assistant={activeAssistant} />
        {topicPosition === 'right' && showTopics && (
          <HomeTabs
            selectedAssistant={selectedAssistant}
            setSelectedAssistant={setSelectedAssistant}
            activeAssistant={activeAssistant}
            position="right"
          />
        )}
      </ContentContainer>
    </Container>
  )
}

const HomePage: FC = () => {
  return (
    <ActiveTopicProvider>
      <HomePageContent />
    </ActiveTopicProvider>
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
