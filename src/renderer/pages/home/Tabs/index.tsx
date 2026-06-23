import type { ResourceListRevealRequest } from '@renderer/components/chat/resources'
import type { Topic } from '@renderer/types'
import { cn } from '@renderer/utils'
import type { FC, HTMLAttributes } from 'react'

import type { AddNewTopicPayload } from '../types'
import { Topics } from './components/Topics'

interface Props {
  activeTopic?: Topic
  onNewTopic?: (payload?: AddNewTopicPayload) => void | Promise<void>
  setActiveTopic: (topic: Topic) => void
  revealRequest?: ResourceListRevealRequest
  style?: React.CSSProperties
}

const HomeTabs: FC<Props> = ({ activeTopic, onNewTopic, setActiveTopic, revealRequest, style }) => {
  return (
    <Container style={style} className="home-tabs">
      <TabContent className="home-tabs-content">
        <Topics
          activeTopic={activeTopic}
          setActiveTopic={setActiveTopic}
          onNewTopic={onNewTopic}
          revealRequest={revealRequest}
        />
      </TabContent>
    </Container>
  )
}

function Container({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'relative flex h-[calc(100vh_-_var(--navbar-height))] w-[var(--assistants-width)] flex-col overflow-hidden transition-[width] duration-300 [&_.collapsed]:w-0 [&_.collapsed]:border-l-0',
        className
      )}
      {...props}
    />
  )
}

function TabContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('flex flex-1 flex-col overflow-hidden transition-[width] duration-300', className)} {...props} />
  )
}

export default HomeTabs
