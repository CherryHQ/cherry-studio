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
  dataEnabled?: boolean
  historyRecordsActive?: boolean
  assistantTopicsSource: AssistantTopicsSource
  onActiveAssistantDeleted?: (assistantId: string) => void | Promise<void>
  onAddAssistant?: () => void | Promise<void>
  onClearActiveTopic?: () => void
  onCreateTopicAfterClear?: (payload: AddNewTopicPayload) => void | Promise<void>
  onNewTopic?: (payload?: AddNewTopicWithReusePayload) => Topic | null | void | Promise<Topic | null | void>
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
  dataEnabled,
  historyRecordsActive,
  assistantTopicsSource,
  onActiveAssistantDeleted,
  onAddAssistant,
  onClearActiveTopic,
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
        dataEnabled={dataEnabled}
        historyRecordsActive={historyRecordsActive}
        assistantTopicsSource={assistantTopicsSource}
        onActiveAssistantDeleted={onActiveAssistantDeleted}
        onAddAssistant={onAddAssistant}
        setActiveTopic={setActiveTopic}
        onClearActiveTopic={onClearActiveTopic}
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
