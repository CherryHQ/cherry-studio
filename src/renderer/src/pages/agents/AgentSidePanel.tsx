import type { ChatPanePosition } from '@renderer/components/chat'
import type { ResourceListRevealRequest } from '@renderer/components/chat/resources'
import { useNavbarPosition } from '@renderer/hooks/useNavbar'

import Sessions from './components/Sessions'

interface AgentSidePanelProps {
  onOpenHistory?: (origin?: DOMRectReadOnly) => void
  onSelectItem?: () => void
  position?: ChatPanePosition
  revealRequest?: ResourceListRevealRequest
}

const AgentSidePanel = ({ onOpenHistory, onSelectItem, position = 'left', revealRequest }: AgentSidePanelProps) => {
  const { isLeftNavbar } = useNavbarPosition()
  const borderStyle = '0.5px solid var(--color-border)'

  return (
    <div
      className="flex flex-col overflow-hidden"
      style={{
        width: 'var(--assistants-width)',
        height: 'calc(100vh - var(--navbar-height))',
        borderRight: isLeftNavbar && position === 'left' ? borderStyle : 'none',
        borderLeft: isLeftNavbar && position === 'right' ? borderStyle : 'none',
        backgroundColor: isLeftNavbar ? 'var(--color-background)' : undefined
      }}>
      <div className="flex flex-1 flex-col overflow-hidden">
        <Sessions onOpenHistory={onOpenHistory} onSelectItem={onSelectItem} revealRequest={revealRequest} />
      </div>
    </div>
  )
}

export default AgentSidePanel
