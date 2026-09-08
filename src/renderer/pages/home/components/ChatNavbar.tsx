import { usePreference } from '@data/hooks/usePreference'
import { ConversationSidebarToggleButton } from '@renderer/components/chat/shell/ConversationSidebarToggleButton'
import { ConversationTopBarPortalHost } from '@renderer/components/chat/shell/ConversationTopBarPortal'
import { NavbarHeader } from '@renderer/components/Navbar'
import type { FC, ReactNode } from 'react'

interface HeaderNavbarProps {
  title?: string
  actions?: ReactNode
  conversationControls?: ReactNode
  showSidebarControls?: boolean
  sidebarOpen?: boolean
  onSidebarToggle?: () => void
}

const HeaderNavbar: FC<HeaderNavbarProps> = ({
  title,
  actions,
  conversationControls,
  showSidebarControls = true,
  sidebarOpen,
  onSidebarToggle
}) => {
  const [preferredShowSidebar] = usePreference('topic.tab.show')
  const showSidebar = sidebarOpen ?? preferredShowSidebar

  return (
    <NavbarHeader className="home-navbar relative" style={{ height: 'var(--navbar-height)' }}>
      <div className="-mx-1 flex h-full min-w-0 flex-1 items-center justify-between overflow-hidden">
        <div data-navbar-left-occupant className="flex min-w-0 flex-1 items-center overflow-hidden">
          {showSidebarControls && (
            <ConversationSidebarToggleButton
              sidebarOpen={showSidebar}
              onSidebarToggle={onSidebarToggle}
              tooltipPlacement="bottom"
            />
          )}
          {title && (
            <div className="min-w-0 flex-1 truncate px-2 font-medium text-sm" title={title}>
              {title}
            </div>
          )}
          <ConversationTopBarPortalHost className={title ? 'max-w-[60%] flex-initial justify-end' : undefined}>
            {conversationControls}
          </ConversationTopBarPortalHost>
          {actions}
        </div>
      </div>
    </NavbarHeader>
  )
}

export default HeaderNavbar
