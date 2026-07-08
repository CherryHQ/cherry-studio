import type {
  ConversationResourceMenuItem,
  ResourceListRevealRequest
} from '@renderer/components/chat/resourceList/base'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import type { TopicTabPosition } from '@shared/data/preference/preferenceTypes'

import Sessions from './components/Sessions'
import type { DraftAgentSessionDefaults } from './types'

interface AgentSidePanelProps {
  activeSessionId: string | null
  historyRecordsActive?: boolean
  onActiveAgentDeleted?: (agentId: string) => void | Promise<void>
  onAddAgent?: () => void | Promise<void>
  onOpenHistoryRecords?: () => void
  onSetPanePosition?: (position: TopicTabPosition) => void | Promise<void>
  onStartDraftSession?: (defaults: DraftAgentSessionDefaults) => void | Promise<void>
  onStartMissingAgentDraft?: () => void | Promise<void>
  panePosition?: TopicTabPosition
  revealRequest?: ResourceListRevealRequest
  resourceMenuItems?: readonly ConversationResourceMenuItem[]
  setActiveSessionId: (id: string | null, session?: AgentSessionEntity | null) => void
}

const AgentSidePanel = ({
  activeSessionId,
  historyRecordsActive,
  onActiveAgentDeleted,
  onAddAgent,
  onOpenHistoryRecords,
  onSetPanePosition,
  onStartDraftSession,
  onStartMissingAgentDraft,
  panePosition,
  revealRequest,
  resourceMenuItems,
  setActiveSessionId
}: AgentSidePanelProps) => {
  return (
    <div
      className="flex flex-col overflow-hidden"
      style={{
        width: 'var(--assistants-width)',
        height: 'calc(100vh - var(--navbar-height))'
      }}>
      <div className="flex flex-1 flex-col overflow-hidden">
        <Sessions
          activeSessionId={activeSessionId}
          historyRecordsActive={historyRecordsActive}
          setActiveSessionId={setActiveSessionId}
          onActiveAgentDeleted={onActiveAgentDeleted}
          onAddAgent={onAddAgent}
          onOpenHistoryRecords={onOpenHistoryRecords}
          onSetPanePosition={onSetPanePosition}
          panePosition={panePosition}
          revealRequest={revealRequest}
          resourceMenuItems={resourceMenuItems}
          onStartDraftSession={onStartDraftSession}
          onStartMissingAgentDraft={onStartMissingAgentDraft}
        />
      </div>
    </div>
  )
}

export default AgentSidePanel
