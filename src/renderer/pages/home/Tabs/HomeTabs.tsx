import type {
  ConversationResourceMenuItem,
  ResourceListRevealRequest
} from '@renderer/components/chat/resourceList/base'
import type { AssistantTopicsSource } from '@renderer/hooks/resourceViewSources'
import type { Topic } from '@renderer/types/topic'
import { cn } from '@renderer/utils/style'
import type { TopicTabPosition } from '@shared/data/preference/preferenceTypes'
import type { FC, HTMLAttributes } from 'react'

import type { AddNewTopicPayload, AddNewTopicWithReusePayload } from '../types'
import { Topics } from './components/Topics'

interface Props {
  activeTopic?: Topic
  historyRecordsActive?: boolean
  assistantTopicsSource: AssistantTopicsSource
  onActiveAssistantDeleted?: (assistantId: string) => void | Promise<void>
  onAddAssistant?: () => void | Promise<void>
  onCreateTopicAfterClear?: (payload: AddNewTopicPayload) => void | Promise<void>
  onNewTopic?: (payload?: AddNewTopicWithReusePayload) => void | Promise<void>
  onOpenHistoryRecords?: () => void
  onSetPanePosition?: (position: TopicTabPosition) => void | Promise<void>
  panePosition?: TopicTabPosition
  setActiveTopic: (topic: Topic) => void
  revealRequest?: ResourceListRevealRequest
  resourceMenuItems?: readonly ConversationResourceMenuItem[]
  style?: React.CSSProperties
}

const HomeTabs: FC<Props> = ({
  activeTopic,
  historyRecordsActive,
  assistantTopicsSource,
  onActiveAssistantDeleted,
  onAddAssistant,
  onCreateTopicAfterClear,
  onNewTopic,
  onOpenHistoryRecords,
  onSetPanePosition,
  panePosition,
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
          historyRecordsActive={historyRecordsActive}
          assistantTopicsSource={assistantTopicsSource}
          onActiveAssistantDeleted={onActiveAssistantDeleted}
          onAddAssistant={onAddAssistant}
          setActiveTopic={setActiveTopic}
          onCreateTopicAfterClear={onCreateTopicAfterClear}
          onNewTopic={onNewTopic}
          onOpenHistoryRecords={onOpenHistoryRecords}
          onSetPanePosition={onSetPanePosition}
          panePosition={panePosition}
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
