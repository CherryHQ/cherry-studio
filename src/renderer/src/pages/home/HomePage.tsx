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
  console.log('HomePage组件开始渲染')

  const { assistants } = useAssistants()
  console.log('获取到assistants:', Array.isArray(assistants) ? assistants.length : '非数组')

  const navigate = useNavigate()
  const location = useLocation()
  const state = location.state

  const hasAssistants = assistants && assistants.length > 0
  console.log('是否有可用助手:', hasAssistants)

  const initialAssistant = state?.assistant || _activeAssistant || (hasAssistants ? assistants[0] : undefined)
  const [activeAssistant, setActiveAssistant] = useState(initialAssistant)
  console.log('activeAssistant设置完成:', activeAssistant?.id)

  const safeAssistant =
    activeAssistant ||
    (hasAssistants
      ? assistants[0]
      : {
          id: 'default',
          name: 'Default',
          topics: [],
          prompt: '',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        })

  const { activeTopic, setActiveTopic } = useActiveTopic(safeAssistant, state?.topic)
  console.log('activeTopic设置完成:', activeTopic?.id)

  const { showAssistants, showTopics, topicPosition } = useSettings()
  console.log('获取设置完成')

  _activeAssistant = activeAssistant

  useEffect(() => {
    NavigationService.setNavigate(navigate)
  }, [navigate])

  useEffect(() => {
    state?.assistant && setActiveAssistant(state?.assistant)
    state?.topic && setActiveTopic(state?.topic)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

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
