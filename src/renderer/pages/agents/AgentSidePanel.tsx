import { useNavbarPosition } from '@renderer/hooks/useNavbar'

import Sessions from './components/Sessions'

interface AgentSidePanelProps {
  onSelectItem?: () => void
}

const AgentSidePanel = ({ onSelectItem }: AgentSidePanelProps) => {
  const { isLeftNavbar } = useNavbarPosition()

  return (
    <div
      className="flex flex-col overflow-hidden"
      style={{
        width: 'var(--assistants-width)',
        height: 'calc(100vh - var(--navbar-height))',
        borderRight: isLeftNavbar ? '0.5px solid var(--color-border)' : 'none',
        backgroundColor: isLeftNavbar ? 'var(--color-background)' : undefined
      }}>
      <div className="flex flex-1 flex-col overflow-hidden">
        <Sessions onSelectItem={onSelectItem} />
      </div>
    </div>
  )
}

export default AgentSidePanel
