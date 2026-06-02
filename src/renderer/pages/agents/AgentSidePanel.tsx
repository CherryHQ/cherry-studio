import type { ResourceListRevealRequest } from '@renderer/components/chat/resources'
import type { TemporaryConversationDefaults } from '@renderer/hooks/useTemporaryConversation'

import Sessions from './components/Sessions'

interface AgentSidePanelProps {
  onOpenHistory?: (origin?: DOMRectReadOnly) => void
  onSelectItem?: () => void
  onDiscardTemporarySession?: () => void | Promise<void>
  onStartTemporarySession?: (defaults: TemporaryConversationDefaults) => void | Promise<void>
  onStartMissingAgentDraft?: () => void | Promise<void>
  revealRequest?: ResourceListRevealRequest
}

const AgentSidePanel = ({
  onOpenHistory,
  onSelectItem,
  onDiscardTemporarySession,
  onStartTemporarySession,
  onStartMissingAgentDraft,
  revealRequest
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
          onOpenHistory={onOpenHistory}
          onSelectItem={onSelectItem}
          revealRequest={revealRequest}
          onDiscardTemporarySession={onDiscardTemporarySession}
          onStartTemporarySession={onStartTemporarySession}
          onStartMissingAgentDraft={onStartMissingAgentDraft}
        />
      </div>
    </div>
  )
}

export default AgentSidePanel
