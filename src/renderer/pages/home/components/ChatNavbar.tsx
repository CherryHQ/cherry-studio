import { usePreference } from '@data/hooks/usePreference'
import { ConversationNavbarTitle } from '@renderer/components/chat/shell/ConversationNavbarTitle'
import { ConversationSidebarToggleButton } from '@renderer/components/chat/shell/ConversationSidebarToggleButton'
import { ConversationTopBarPortalHost } from '@renderer/components/chat/shell/ConversationTopBarPortal'
import { NavbarHeader } from '@renderer/components/Navbar'
import type { FC, ReactNode } from 'react'

interface HeaderNavbarProps {
  conversationControls?: ReactNode
  conversationTitle?: string
  branchSwitcher?: (title: ReactNode) => ReactNode
  showSidebarControls?: boolean
  sidebarOpen?: boolean
  onSidebarToggle?: () => void
}

const HeaderNavbar: FC<HeaderNavbarProps> = ({
  conversationControls,
  conversationTitle,
  branchSwitcher,
  showSidebarControls = true,
  sidebarOpen,
  onSidebarToggle
}) => {
  const [preferredShowSidebar] = usePreference('topic.tab.show')
  const showSidebar = sidebarOpen ?? preferredShowSidebar
  const title = conversationTitle ? <ConversationNavbarTitle title={conversationTitle} /> : null

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
          {branchSwitcher ? branchSwitcher(title) : title}
          <ConversationTopBarPortalHost>{conversationControls}</ConversationTopBarPortalHost>
        </div>
      </div>
    </NavbarHeader>
  )
}

export default HeaderNavbar
