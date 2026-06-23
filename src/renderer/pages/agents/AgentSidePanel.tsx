import type { ResourceListRevealRequest } from '@renderer/components/chat/resources'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'

import Sessions from './components/Sessions'
import type { DraftAgentSessionDefaults } from './types'

interface AgentSidePanelProps {
  activeSessionId: string | null
  onOpenHistoryRecords?: () => void
  onSelectItem?: () => void
  onStartDraftSession?: (defaults: DraftAgentSessionDefaults) => void | Promise<void>
  onStartMissingAgentDraft?: () => void | Promise<void>
  revealRequest?: ResourceListRevealRequest
  setActiveSessionId: (id: string | null, session?: AgentSessionEntity | null) => void
}

const AgentSidePanel = ({
  activeSessionId,
  onOpenHistoryRecords,
  onSelectItem,
  onStartDraftSession,
  onStartMissingAgentDraft,
  revealRequest,
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
          setActiveSessionId={setActiveSessionId}
          onSelectItem={onSelectItem}
          onOpenHistoryRecords={onOpenHistoryRecords}
          revealRequest={revealRequest}
          onStartDraftSession={onStartDraftSession}
          onStartMissingAgentDraft={onStartMissingAgentDraft}
        />
      </div>
    </div>
  )
}

export default AgentSidePanel
