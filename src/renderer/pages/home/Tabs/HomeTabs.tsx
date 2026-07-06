import type {
  ConversationResourceMenuItem,
  ResourceListRevealRequest
} from '@renderer/components/chat/resourceList/base'
import type { Topic } from '@renderer/types/topic'
import { cn } from '@renderer/utils/style'
import type { FC, HTMLAttributes } from 'react'

import type { AddNewTopicPayload } from '../types'
import { Topics } from './components/Topics'

interface Props {
  activeTopic?: Topic
  onNewTopic?: (payload?: AddNewTopicPayload) => void | Promise<void>
  onOpenHistoryRecords?: () => void
  setActiveTopic: (topic: Topic) => void
  revealRequest?: ResourceListRevealRequest
  resourceMenuItems?: readonly ConversationResourceMenuItem[]
  style?: React.CSSProperties
}

const HomeTabs: FC<Props> = ({
  activeTopic,
  onNewTopic,
  onOpenHistoryRecords,
  setActiveTopic,
  revealRequest,
  resourceMenuItems,
  style
}) => {
  return (
    <Container style={style} className="home-tabs">
      <TabContent className="home-tabs-content">
        <Topics
          activeTopic={activeTopic}
          setActiveTopic={setActiveTopic}
          onNewTopic={onNewTopic}
          onOpenHistoryRecords={onOpenHistoryRecords}
          revealRequest={revealRequest}
          resourceMenuItems={resourceMenuItems}
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
