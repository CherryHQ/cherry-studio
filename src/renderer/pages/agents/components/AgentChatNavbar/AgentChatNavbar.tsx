import type { ReactNode } from 'react'

import { NavbarHeader } from '@renderer/components/Navbar'
import { cn } from '@renderer/utils/style'
import type { AgentEntity } from '@shared/data/types/agent'

import AgentContent from './AgentContent'

interface Props {
  activeAgent: AgentEntity | null
  conversationControls?: ReactNode
  tools?: ReactNode
  className?: string
  showSidebarControls?: boolean
  sidebarOpen?: boolean
  onSidebarToggle?: () => void
}

const AgentChatNavbar = ({
  activeAgent,
  conversationControls,
  tools,
  className,
  showSidebarControls = true,
  sidebarOpen,
  onSidebarToggle
}: Props) => {
  return (
    <NavbarHeader className={cn('agent-navbar relative', className)} style={{ height: 'var(--navbar-height)' }}>
      <div className="-mx-1 flex h-full min-w-0 flex-1 items-center justify-between overflow-hidden">
        <AgentContent
          activeAgent={activeAgent}
          conversationControls={conversationControls}
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
