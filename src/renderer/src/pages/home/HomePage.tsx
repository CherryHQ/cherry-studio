import { useSettings } from '@renderer/hooks/useSettings'
import { FC, useEffect } from 'react'
import styled from 'styled-components'

import Chat from './Chat'
import ChatNavbar from './ChatNavbar'

const HomePage: FC = () => {
  const { showAssistants, showTopics, topicPosition } = useSettings()

  useEffect(() => {
    window.api.window.setMinimumSize(showAssistants ? 1080 : 520, 600)

    return () => {
      window.api.window.resetMinimumSize()
    }
  }, [showAssistants, showTopics, topicPosition])

  return (
    <Container id="home-page">
      <ChatNavbar />
      <ContentContainer id="content-container">
        <Chat />
      </ContentContainer>
    </Container>
  )
}

const Container = styled.div`
  min-width: 0;
  display: flex;
  flex: 1;
  flex-direction: column;
`

const ContentContainer = styled.div`
  overflow: hidden;
`

export default HomePage
