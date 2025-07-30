import React from 'react'
import styled from 'styled-components'

import PocHeader from './components/PocHeader'
import PocMessageList from './components/PocMessageList'
import PocCommandInput from './components/PocCommandInput'
import PocStatusBar from './components/PocStatusBar'

const PageContainer = styled.div`
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100%;
  background: var(--color-background);
`

const ContentArea = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
`

const CommandPocPage: React.FC = () => {
  return (
    <PageContainer>
      <PocHeader />
      <ContentArea>
        <PocMessageList />
        <PocStatusBar />
        <PocCommandInput />
      </ContentArea>
    </PageContainer>
  )
}

export default CommandPocPage