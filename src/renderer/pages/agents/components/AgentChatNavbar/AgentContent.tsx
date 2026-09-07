import { usePreference } from '@data/hooks/usePreference'
import { ConversationNavbarTitle } from '@renderer/components/chat/shell/ConversationNavbarTitle'
import { ConversationSidebarToggleButton } from '@renderer/components/chat/shell/ConversationSidebarToggleButton'
import { ConversationTopBarPortalHost } from '@renderer/components/chat/shell/ConversationTopBarPortal'
import type { AgentEntity } from '@shared/data/types/agent'
import type { ReactNode } from 'react'

import Tools from './Tools'

type AgentContentProps = {
  activeAgent: AgentEntity | null
  conversationControls?: ReactNode
  conversationTitle?: string
  tools?: ReactNode
  showSidebarControls?: boolean
  sidebarOpen?: boolean
  onSidebarToggle?: () => void
}

const AgentContent = ({
  activeAgent,
  conversationControls,
  conversationTitle,
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
        {conversationTitle && <ConversationNavbarTitle title={conversationTitle} />}
        <ConversationTopBarPortalHost>{conversationControls}</ConversationTopBarPortalHost>
      </div>
      <div data-navbar-right-occupant className="flex shrink-0 items-center">
        {activeAgent && <Tools>{tools}</Tools>}
      </div>
    </div>
  )
}

export default AgentContent
