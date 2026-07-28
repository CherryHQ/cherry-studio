import type {
  ConversationResourceMenuItem,
  ResourceListRevealRequest
} from '@renderer/components/chat/resourceList/base'
import { ConversationNavigationPane } from '@renderer/components/chat/shell/ConversationNavigationPane'
import type { AssistantTopicsSource } from '@renderer/hooks/resourceViewSources'
import type { Topic } from '@renderer/types/topic'
import type { TopicTabPosition } from '@shared/data/preference/preferenceTypes'
import type { CSSProperties, FC } from 'react'

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
  style?: CSSProperties
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
    <ConversationNavigationPane style={style}>
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
    </ConversationNavigationPane>
  )
}

export default HomeTabs
