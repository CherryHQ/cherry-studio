import type {
  ConversationResourceMenuItem,
  ResourceListRevealRequest
} from '@renderer/components/chat/resourceList/base'
import type { AgentSessionsSource } from '@renderer/hooks/resourceViewSources'
import { useWindowFrame } from '@renderer/hooks/useWindowFrame'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import type { TopicTabPosition } from '@shared/data/preference/preferenceTypes'

import Sessions from './components/Sessions'
import type { CreateAgentSessionDefaults } from './types'

interface AgentSidePanelProps {
  activeSession?: AgentSessionEntity | null
  activeSessionId: string | null
  historyRecordsActive?: boolean
  agentSessionsSource: AgentSessionsSource
  onActiveAgentDeleted?: (agentId: string) => void | Promise<void>
  onAddAgent?: () => void | Promise<void>
  onOpenHistoryRecords?: () => void
  onSetPanePosition?: (position: TopicTabPosition) => void | Promise<void>
  onCreateSession?: (
    defaults: CreateAgentSessionDefaults
  ) => AgentSessionEntity | null | void | Promise<AgentSessionEntity | null | void>
  onShowMissingAgentSelection?: () => void | Promise<void>
  panePosition?: TopicTabPosition
  revealRequest?: ResourceListRevealRequest
  resourceMenuItems?: readonly ConversationResourceMenuItem[]
  setActiveSessionId: (id: string | null, session?: AgentSessionEntity | null) => void
}

const AgentSidePanel = ({
  activeSession,
  activeSessionId,
  historyRecordsActive,
  agentSessionsSource,
  onActiveAgentDeleted,
  onAddAgent,
  onOpenHistoryRecords,
  onSetPanePosition,
  onCreateSession,
  onShowMissingAgentSelection,
  panePosition,
  revealRequest,
  resourceMenuItems,
  setActiveSessionId
}: AgentSidePanelProps) => {
  const isWindowFrame = useWindowFrame().mode === 'window'

  return (
    <div
      className="flex flex-col overflow-hidden"
      style={{
        width: 'var(--assistants-width)',
        height: isWindowFrame ? '100%' : 'calc(100vh - var(--navbar-height))'
      }}>
      <div className="flex flex-1 flex-col overflow-hidden">
        <Sessions
          activeSession={activeSession}
          agentSessionsSource={agentSessionsSource}
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
          onCreateSession={onCreateSession}
          onShowMissingAgentSelection={onShowMissingAgentSelection}
        />
      </div>
    </div>
  )
}

export default AgentSidePanel
