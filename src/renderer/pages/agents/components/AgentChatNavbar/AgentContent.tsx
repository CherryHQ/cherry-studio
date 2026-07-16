import { usePreference } from '@data/hooks/usePreference'
import { ConversationSidebarToggleButton } from '@renderer/components/chat/shell/ConversationSidebarToggleButton'
import { ConversationTopBarPortalHost } from '@renderer/components/chat/shell/ConversationTopBarPortal'
import type { AgentEntity } from '@shared/data/types/agent'
import type { ReactNode } from 'react'

import Tools from './Tools'

type AgentContentProps = {
  activeAgent: AgentEntity | null
  tools?: ReactNode
  showSidebarControls?: boolean
  sidebarOpen?: boolean
  onSidebarToggle?: () => void
}

const AgentContent = ({
  activeAgent,
  tools,
  showSidebarControls = true,
  sidebarOpen,
  onSidebarToggle
}: AgentContentProps) => {
  const [preferredShowSidebar] = usePreference('topic.tab.show')
  const showSidebar = sidebarOpen ?? preferredShowSidebar

  return (
    <div className="flex w-full justify-between">
      <div data-navbar-left-occupant className="flex min-w-0 flex-1 items-center overflow-hidden">
        {showSidebarControls && (
          <ConversationSidebarToggleButton
            sidebarOpen={showSidebar}
            onSidebarToggle={onSidebarToggle}
            tooltipPlacement={showSidebar ? undefined : 'right'}
          />
        )}
        <ConversationTopBarPortalHost />
      </div>
      <div data-navbar-right-occupant className="flex shrink-0 items-center">
        {activeAgent && <Tools>{tools}</Tools>}
      </div>
    </div>
  )
}

export default AgentContent
