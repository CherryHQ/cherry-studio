import { NavbarHeader } from '@renderer/components/app/Navbar'
import SearchPopup from '@renderer/components/Popups/SearchPopup'
import { useShortcut } from '@renderer/hooks/useShortcuts'
import { cn } from '@renderer/utils'
import type { AgentEntity } from '@shared/data/types/agent'

import AgentContent from './AgentContent'

interface Props {
  activeAgent: AgentEntity
  onOpenSettings: () => void
  className?: string
}

const AgentChatNavbar = ({ activeAgent, onOpenSettings, className }: Props) => {
  useShortcut('general.search', () => {
    void SearchPopup.show()
  })

  return (
    <NavbarHeader className={cn('agent-navbar h-(--navbar-height)', className)}>
      <div className="flex h-full min-w-0 flex-1 shrink items-center overflow-auto">
        <AgentContent activeAgent={activeAgent} onOpenSettings={onOpenSettings} />
      </div>
    </NavbarHeader>
  )
}

export default AgentChatNavbar
