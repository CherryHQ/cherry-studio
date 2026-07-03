import { NavbarHeader } from '@renderer/components/app/Navbar'
import SearchPopup from '@renderer/components/Popups/SearchPopup'
import { useCommandHandler } from '@renderer/hooks/command'
import { cn } from '@renderer/utils/style'
import type { AgentEntity } from '@shared/data/types/agent'
import type { ReactNode } from 'react'

import AgentContent from './AgentContent'

interface Props {
  activeAgent: AgentEntity | null
  tools?: ReactNode
  className?: string
  showSidebarControls?: boolean
  sidebarOpen?: boolean
  onSidebarToggle?: () => void
}

const AgentChatNavbar = ({
  activeAgent,
  tools,
  className,
  showSidebarControls = true,
  sidebarOpen,
  onSidebarToggle
}: Props) => {
  useCommandHandler('app.search', () => {
    void SearchPopup.show()
  })

  return (
    <NavbarHeader className={cn('agent-navbar relative h-(--navbar-height)', className)}>
      <div className="-mx-1 flex h-full min-w-0 flex-1 shrink items-center overflow-auto">
        <AgentContent
          activeAgent={activeAgent}
          tools={tools}
          showSidebarControls={showSidebarControls}
          sidebarOpen={sidebarOpen}
          onSidebarToggle={onSidebarToggle}
        />
      </div>
    </NavbarHeader>
  )
}

export default AgentChatNavbar
