import { usePreference } from '@data/hooks/usePreference'
import { ConversationSidebarToggleButton } from '@renderer/components/chat/shell/ConversationSidebarToggleButton'
import { NavbarHeader } from '@renderer/components/Navbar'
import { useWindowFrame } from '@renderer/hooks/useWindowFrame'
import type { FC } from 'react'

interface HeaderNavbarProps {
  showSidebarControls?: boolean
  sidebarOpen?: boolean
  onSidebarToggle?: () => void
}

const HeaderNavbar: FC<HeaderNavbarProps> = ({ showSidebarControls = true, sidebarOpen, onSidebarToggle }) => {
  const [preferredShowSidebar] = usePreference('topic.tab.show')
  const showSidebar = sidebarOpen ?? preferredShowSidebar
  const { mode, chrome } = useWindowFrame()

  return (
    <NavbarHeader className="home-navbar relative" style={{ height: 'var(--navbar-height)' }}>
      <div className="-mx-1 flex h-full min-w-0 flex-1 items-center justify-between overflow-hidden">
        <div data-navbar-left-occupant className="flex shrink-0 items-center">
          {showSidebarControls && (
            <ConversationSidebarToggleButton
              sidebarOpen={showSidebar}
              onSidebarToggle={onSidebarToggle}
              tooltipPlacement="bottom"
            />
          )}
          {mode === 'window' && chrome?.titleLeading ? (
            <div className={showSidebarControls ? 'ml-2 min-w-0' : 'min-w-0'}>{chrome.titleLeading}</div>
          ) : null}
        </div>
      </div>
    </NavbarHeader>
  )
}

export default HeaderNavbar
