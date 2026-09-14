import type { CSSProperties, FC } from 'react'

import type { ResourceListRevealRequest } from '@renderer/components/chat/resourceList/base'
import { ConversationNavigationPane } from '@renderer/components/chat/shell/ConversationNavigationPane'
import type { AssistantTopicsSource } from '@renderer/hooks/resourceViewSources'
import type { Topic } from '@renderer/types/topic'
import type { TopicTabPosition } from '@shared/data/preference/preferenceTypes'

import type { AddNewTopicPayload } from '../types'
import { Topics } from './components/Topics'

interface Props {
  activeTopic?: Topic
  dataEnabled?: boolean
  historyRecordsActive?: boolean
  manageAssistantsActive?: boolean
  assistantTopicsSource: AssistantTopicsSource
  onActiveAssistantDeleted?: (assistantId: string) => void | Promise<void>
  onAddAssistant?: () => void | Promise<void>
  clearActiveTopic: () => void
  onNewTopic?: (payload?: AddNewTopicPayload) => void | Promise<void>
  onOpenHistoryRecords?: () => void
  onManageAssistants?: () => void | Promise<void>
  onSetPanePosition?: (position: TopicTabPosition) => void | Promise<void>
  panePosition?: TopicTabPosition
  setActiveTopic: (topic: Topic) => void
  revealRequest?: ResourceListRevealRequest
  style?: CSSProperties
}

const HomeTabs: FC<Props> = ({
  activeTopic,
  dataEnabled,
  historyRecordsActive,
  manageAssistantsActive,
  assistantTopicsSource,
  onActiveAssistantDeleted,
  onAddAssistant,
  clearActiveTopic,
  onNewTopic,
  onOpenHistoryRecords,
  onManageAssistants,
  onSetPanePosition,
  panePosition,
  setActiveTopic,
  revealRequest,
  style
}) => {
  return (
    <ConversationNavigationPane style={style}>
      <Topics
        activeTopic={activeTopic}
        dataEnabled={dataEnabled}
        historyRecordsActive={historyRecordsActive}
        manageAssistantsActive={manageAssistantsActive}
        assistantTopicsSource={assistantTopicsSource}
        onActiveAssistantDeleted={onActiveAssistantDeleted}
        onAddAssistant={onAddAssistant}
        clearActiveTopic={clearActiveTopic}
        setActiveTopic={setActiveTopic}
        onNewTopic={onNewTopic}
        onOpenHistoryRecords={onOpenHistoryRecords}
        onManageAssistants={onManageAssistants}
        onSetPanePosition={onSetPanePosition}
        panePosition={panePosition}
        revealRequest={revealRequest}
      />
    </ConversationNavigationPane>
  )
}

export default HomeTabs
