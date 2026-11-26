import type { ResourceListRevealRequest } from '@renderer/components/chat/resourceList/base'
import { ConversationNavigationPane } from '@renderer/components/chat/shell/ConversationNavigationPane'
import type { AgentSessionsSource } from '@renderer/hooks/resourceViewSources'
import { useMinimalMode } from '@renderer/hooks/useMinimalMode'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import type { TopicTabPosition } from '@shared/data/preference/preferenceTypes'

import { MinimalAgentList } from './components/MinimalAgentList'
import { Sessions } from './components/sessions'
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
  onCreateSessionForAgent: (agentId: string) => Promise<AgentSessionEntity>
  onActivateMinimalSession: (session: AgentSessionEntity, created: boolean) => void
  onShowMissingAgentSelection?: () => void | Promise<void>
  panePosition?: TopicTabPosition
  onLocalPermanentDeletePendingChange?: (id: string | null) => void
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
  onCreateSessionForAgent,
  onActivateMinimalSession,
  onShowMissingAgentSelection,
  onLocalPermanentDeletePendingChange,
  panePosition,
  revealRequest,
  setActiveSessionId
}: AgentSidePanelProps) => {
  const minimalContext = useMinimalMode()
  const minimalMode = minimalContext?.enabled && minimalContext.isHome ? minimalContext : null
  return (
    <ConversationNavigationPane className={minimalMode?.enabled ? 'border-r-[0.5px] border-border' : undefined}>
      {minimalMode?.renderSidebarHeader?.(onAddAgent)}
      {minimalMode ? (
        <MinimalAgentList
          source={agentSessionsSource}
          dataEnabled={dataEnabled}
          activeSessionId={activeSessionId}
          onSelect={onActivateMinimalSession}
          onCreate={onCreateSessionForAgent}
          onActiveAgentDeleted={onActiveAgentDeleted}
        />
      ) : (
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
          onLocalPermanentDeletePendingChange={onLocalPermanentDeletePendingChange}
          onCreateSession={onCreateSession}
          onShowMissingAgentSelection={onShowMissingAgentSelection}
        />
      )}
      {minimalMode?.sidebarFooter}
    </ConversationNavigationPane>
  )
}

export default AgentSidePanel
