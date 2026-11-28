import type { CSSProperties, FC } from 'react'

import type { ResourceListRevealRequest } from '@renderer/components/chat/resourceList/base'
import { ConversationNavigationPane } from '@renderer/components/chat/shell/ConversationNavigationPane'
import type { AssistantTopicsSource } from '@renderer/hooks/resourceViewSources'
import type { Topic } from '@renderer/types/topic'
import type { TopicTabPosition } from '@shared/data/preference/preferenceTypes'

import type { AddNewTopicPayload } from '../types'
import { Topics } from './components/topics'

interface Props {
  activeTopicId?: string | null
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
  getArchiveSelectionVersion?: () => number
  isAssistantListComplete?: boolean
  onSelectedTopicOwnerChanged?: (topic: Topic) => void
  onLocalArchiveRecordSelected?: (archived: Topic, replacement: Topic, token?: symbol) => void
  onActiveTopicArchived?: (topic: Topic, token?: symbol) => void
  onLocalArchivePendingChange?: (topicId: string, pending: boolean, token?: symbol) => void
  onLocalPermanentDeletePendingChange?: (id: string | null) => void
  onManageAssistants?: () => void | Promise<void>
  onSetPanePosition?: (position: TopicTabPosition) => void | Promise<void>
  panePosition?: TopicTabPosition
  setActiveTopic: (topic: Topic) => void
  revealRequest?: ResourceListRevealRequest
  style?: CSSProperties
}

const HomeTabs: FC<Props> = ({
  activeTopic,
  activeTopicId = activeTopic?.id,
  dataEnabled,
  historyRecordsActive,
  manageAssistantsActive,
  assistantTopicsSource,
  onActiveAssistantDeleted,
  onAddAssistant,
  clearActiveTopic,
  onNewTopic,
  onOpenHistoryRecords,
  getArchiveSelectionVersion,
  isAssistantListComplete = false,
  onSelectedTopicOwnerChanged,
  onLocalArchiveRecordSelected,
  onActiveTopicArchived,
  onLocalArchivePendingChange,
  onLocalPermanentDeletePendingChange,
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
        activeTopicId={activeTopicId}
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
        getArchiveSelectionVersion={getArchiveSelectionVersion}
        isAssistantListComplete={isAssistantListComplete}
        onLocalArchiveRecordSelected={onLocalArchiveRecordSelected}
        onSelectedTopicOwnerChanged={onSelectedTopicOwnerChanged}
        onActiveTopicArchived={onActiveTopicArchived}
        onLocalArchivePendingChange={onLocalArchivePendingChange}
        onLocalPermanentDeletePendingChange={onLocalPermanentDeletePendingChange}
        onManageAssistants={onManageAssistants}
        onSetPanePosition={onSetPanePosition}
        panePosition={panePosition}
        revealRequest={revealRequest}
      />
    </ConversationNavigationPane>
  )
}

export default HomeTabs
