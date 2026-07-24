import type {
  ConversationResourceMenuItem,
  ResourceListRevealRequest
} from '@renderer/components/chat/resourceList/base'
import type { AssistantTopicsSource } from '@renderer/hooks/resourceViewSources'
import { useWindowFrame } from '@renderer/hooks/useWindowFrame'
import type { Topic } from '@renderer/types/topic'
import { cn } from '@renderer/utils/style'
import type { TopicTabPosition } from '@shared/data/preference/preferenceTypes'
import type { FC, HTMLAttributes } from 'react'

import type { AddNewTopicPayload } from '../types'
import { Topics } from './components/Topics'

interface Props {
  activeTopic?: Topic
  historyRecordsActive?: boolean
  assistantTopicsSource: AssistantTopicsSource
  onActiveAssistantDeleted?: (
    assistantId: string,
    candidateAssistantIds: readonly string[],
    reason: 'deleted' | 'emptied'
  ) => void | Promise<void>
  onAddAssistant?: () => void | Promise<void>
  onClearActiveTopic?: () => void
  onNewTopic?: (payload?: AddNewTopicPayload) => void | Promise<void>
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
  onClearActiveTopic,
  onNewTopic,
  onOpenHistoryRecords,
  onSetPanePosition,
  panePosition,
  setActiveTopic,
  revealRequest,
  resourceMenuItems,
  style
}) => {
  const isWindowFrame = useWindowFrame().mode === 'window'

  return (
    <Container isWindowFrame={isWindowFrame} style={style} className="home-tabs">
      <TabContent className="home-tabs-content">
        <Topics
          activeTopic={activeTopic}
          historyRecordsActive={historyRecordsActive}
          assistantTopicsSource={assistantTopicsSource}
          onActiveAssistantDeleted={onActiveAssistantDeleted}
          onAddAssistant={onAddAssistant}
          setActiveTopic={setActiveTopic}
          onClearActiveTopic={onClearActiveTopic}
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

function Container({
  className,
  isWindowFrame,
  ...props
}: HTMLAttributes<HTMLDivElement> & { isWindowFrame: boolean }) {
  return (
    <div
      className={cn(
        'relative flex w-[var(--assistants-width)] flex-col overflow-hidden transition-[width] duration-300 [&_.collapsed]:w-0 [&_.collapsed]:border-l-0',
        isWindowFrame ? 'h-full' : 'h-[calc(100vh_-_var(--navbar-height))]',
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
