import type { ResourceListRevealRequest } from '@renderer/components/chat/resources'
import type { Topic } from '@renderer/types'
import type { FC } from 'react'
import styled from 'styled-components'

import type { AddNewTopicPayload } from '../types'
import { Topics } from './components/Topics'

interface Props {
  activeTopic?: Topic
  onNewTopic?: (payload?: AddNewTopicPayload) => void | Promise<void>
  onOpenHistory?: (origin?: DOMRectReadOnly) => void
  setActiveTopic: (topic: Topic) => void
  revealRequest?: ResourceListRevealRequest
  style?: React.CSSProperties
}

const HomeTabs: FC<Props> = ({ activeTopic, onNewTopic, onOpenHistory, setActiveTopic, revealRequest, style }) => {
  return (
    <Container style={style} className="home-tabs">
      <TabContent className="home-tabs-content">
        <Topics
          activeTopic={activeTopic}
          setActiveTopic={setActiveTopic}
          onNewTopic={onNewTopic}
          onOpenHistory={onOpenHistory}
          revealRequest={revealRequest}
        />
      </TabContent>
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex-direction: column;
  width: var(--assistants-width);
  transition: width 0.3s;
  height: calc(100vh - var(--navbar-height));
  position: relative;

  overflow: hidden;
  .collapsed {
    width: 0;
    border-left: none;
  }
`

const TabContent = styled.div`
  display: flex;
  transition: width 0.3s;
  flex: 1;
  flex-direction: column;
  overflow-y: hidden;
  overflow-x: hidden;
`

export default HomeTabs
