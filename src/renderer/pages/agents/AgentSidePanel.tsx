import type { ResourceListRevealRequest } from '@renderer/components/chat/resourceList/base'
import { ConversationNavigationPane } from '@renderer/components/chat/shell/ConversationNavigationPane'
import type { AgentSessionsSource } from '@renderer/hooks/resourceViewSources'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import type { TopicTabPosition } from '@shared/data/preference/preferenceTypes'

import Sessions from './components/Sessions'
import type { CreateAgentSessionDefaults } from './types'

interface AgentSidePanelProps {
  activeSessionId: string | null
  dataEnabled?: boolean
  historyRecordsActive?: boolean
  manageAgentsActive?: boolean
  agentSessionsSource: AgentSessionsSource
  onActiveAgentDeleted?: (agentId: string) => void | Promise<void>
  onAddAgent?: () => void | Promise<void>
  onOpenHistoryRecords?: () => void
  onManageAgents?: () => void | Promise<void>
  onSetPanePosition?: (position: TopicTabPosition) => void | Promise<void>
  onCreateSession?: (
    defaults: CreateAgentSessionDefaults
  ) => AgentSessionEntity | null | void | Promise<AgentSessionEntity | null | void>
  onShowMissingAgentSelection?: () => void | Promise<void>
  panePosition?: TopicTabPosition
  revealRequest?: ResourceListRevealRequest
  setActiveSessionId: (id: string | null, session?: AgentSessionEntity | null) => void
}

const AgentSidePanel = ({
  activeSessionId,
  dataEnabled,
  historyRecordsActive,
  manageAgentsActive,
  agentSessionsSource,
  onActiveAgentDeleted,
  onAddAgent,
  onOpenHistoryRecords,
  onManageAgents,
  onSetPanePosition,
  onCreateSession,
  onShowMissingAgentSelection,
  panePosition,
  revealRequest,
  setActiveSessionId
}: AgentSidePanelProps) => {
  return (
    <ConversationNavigationPane>
      <Sessions
        agentSessionsSource={agentSessionsSource}
        activeSessionId={activeSessionId}
        dataEnabled={dataEnabled}
        historyRecordsActive={historyRecordsActive}
        manageAgentsActive={manageAgentsActive}
        setActiveSessionId={setActiveSessionId}
        onActiveAgentDeleted={onActiveAgentDeleted}
        onAddAgent={onAddAgent}
        onOpenHistoryRecords={onOpenHistoryRecords}
        onManageAgents={onManageAgents}
        onSetPanePosition={onSetPanePosition}
        panePosition={panePosition}
        revealRequest={revealRequest}
        onCreateSession={onCreateSession}
        onShowMissingAgentSelection={onShowMissingAgentSelection}
      />
    </ConversationNavigationPane>
  )
}

export default AgentSidePanel
