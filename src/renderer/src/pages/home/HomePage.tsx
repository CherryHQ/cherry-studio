import { useAssistants } from '@renderer/hooks/useAssistant'
import { useSettings } from '@renderer/hooks/useSettings'
import { useActiveTopic } from '@renderer/hooks/useTopic'
import NavigationService from '@renderer/services/NavigationService'
import { Assistant } from '@renderer/types'
import { FC, useEffect, useState } from 'react'
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

  // 添加安全检查，确保总是有一个可用的assistant
  const defaultAssistant = state?.assistant || _activeAssistant || assistants[0]
  const [activeAssistant, setActiveAssistant] = useState(defaultAssistant)

  // 如果没有assistant可用，但已经加载了assistants数据，则显示错误
  useEffect(() => {
    if (!activeAssistant && assistants.length > 0) {
      console.error('没有可用的assistant，使用第一个可用的assistant')
      setActiveAssistant(assistants[0])
    } else if (!activeAssistant && assistants.length === 0) {
      console.error('没有可用的assistant，且assistants数组为空')
    }
  }, [activeAssistant, assistants])

  const { activeTopic, setActiveTopic } = useActiveTopic(activeAssistant, state?.topic)
  const { showAssistants, showTopics, topicPosition } = useSettings()

  _activeAssistant = activeAssistant

  useEffect(() => {
    NavigationService.setNavigate(navigate)
  }, [navigate])

  useEffect(() => {
    state?.assistant && setActiveAssistant(state?.assistant)
    state?.topic && setActiveTopic(state?.topic)
  }, [state, setActiveTopic])

  useEffect(() => {
    const canMinimize = topicPosition == 'left' ? !showAssistants : !showAssistants && !showTopics
    window.api.window.setMinimumSize(canMinimize ? 520 : 1080, 600)

    return () => {
      window.api.window.resetMinimumSize()
    }
  }, [showAssistants, showTopics, topicPosition])

  return (
    <Container id="home-page">
      <Navbar activeAssistant={activeAssistant} activeTopic={activeTopic} setActiveTopic={setActiveTopic} />
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
