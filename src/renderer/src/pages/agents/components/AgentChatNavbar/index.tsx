import { NavbarHeader } from '@renderer/components/app/Navbar'
import SearchPopup from '@renderer/components/Popups/SearchPopup'
import { useShortcut } from '@renderer/hooks/useShortcuts'
import { cn } from '@renderer/utils'
import type { AgentEntity } from '@shared/data/types/agent'
import type { ReactNode } from 'react'

import AgentContent from './AgentContent'

interface Props {
  activeAgent: AgentEntity | null
  tools?: ReactNode
  className?: string
  showSidebarControls?: boolean
}

const AgentChatNavbar = ({ activeAgent, tools, className, showSidebarControls = true }: Props) => {
  useShortcut('general.search', () => {
    void SearchPopup.show()
  })

  return (
    <NavbarHeader className={cn('agent-navbar h-(--navbar-height)', className)}>
      <div className="-mx-1 flex h-full min-w-0 flex-1 shrink items-center overflow-auto">
        <AgentContent activeAgent={activeAgent} tools={tools} showSidebarControls={showSidebarControls} />
      </div>
    </NavbarHeader>
  )
}

export default AgentChatNavbar
