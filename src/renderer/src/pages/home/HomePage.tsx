import { HStack } from '@renderer/components/Layout'
import { ChatProvider } from '@renderer/hooks/useChat'
import { useSettings } from '@renderer/hooks/useSettings'
import { FC, useEffect } from 'react'
import styled from 'styled-components'

import Chat from './Chat'
import ChatNavbar from './ChatNavbar'
import MainSidebar from './MainSidebar/MainSidebar'

const HomePage: FC<{ style?: React.CSSProperties }> = ({ style }) => {
  const { showAssistants, showTopics, topicPosition } = useSettings()

  useEffect(() => {
    window.api.window.setMinimumSize(showAssistants ? 1080 : 520, 600)

    return () => {
      window.api.window.resetMinimumSize()
    }
  }, [showAssistants, showTopics, topicPosition])

  return (
    <ChatProvider>
      <HStack style={{ display: 'flex', flex: 1 }} id="home-page">
        <MainSidebar />
        <Container style={style}>
          <ChatNavbar />
          <ContentContainer id="content-container">
            <Chat />
          </ContentContainer>
        </Container>
      </HStack>
    </ChatProvider>
  )
}

const Container = styled.div`
  min-width: 0;
  display: flex;
  flex: 1;
  flex-direction: column;
`

const ContentContainer = styled.div``

export default HomePage
