import type { FC, ReactNode } from 'react'

import { usePreference } from '@data/hooks/usePreference'
import { ConversationSidebarToggleButton } from '@renderer/components/chat/shell/ConversationSidebarToggleButton'
import { ConversationTopBarPortalHost } from '@renderer/components/chat/shell/ConversationTopBarPortal'
import { NavbarHeader } from '@renderer/components/Navbar'
import { useMinimalMode } from '@renderer/hooks/useMinimalMode'
import { cn } from '@renderer/utils/style'

interface HeaderNavbarProps {
  conversationControls?: ReactNode
  showSidebarControls?: boolean
  sidebarOpen?: boolean
  onSidebarToggle?: () => void
}

const HeaderNavbar: FC<HeaderNavbarProps> = ({
  conversationControls,
  showSidebarControls = true,
  sidebarOpen,
  onSidebarToggle
}) => {
  const minimalMode = useMinimalMode()
  const [preferredShowSidebar] = usePreference('topic.tab.show')
  const showSidebar = sidebarOpen ?? preferredShowSidebar

  return (
    <NavbarHeader
      className={cn(
        'home-navbar relative',
        minimalMode?.enabled &&
          minimalMode.isHome && [
            'transition-[padding-left] duration-300 ease-in-out motion-reduce:transition-none',
            !showSidebar && 'pl-1'
          ]
      )}
      style={{ height: 'var(--navbar-height)' }}>
      <div className="-mx-1 flex h-full min-w-0 flex-1 items-center justify-between overflow-hidden">
        <div data-navbar-left-occupant className="flex min-w-0 flex-1 items-center overflow-hidden">
          {showSidebarControls && (
            <ConversationSidebarToggleButton
              sidebarOpen={showSidebar}
              onSidebarToggle={onSidebarToggle}
              tooltipPlacement="bottom"
            />
          )}
          <ConversationTopBarPortalHost
            className={cn(
              minimalMode?.enabled &&
                minimalMode.isHome && [
                  '[-webkit-app-region:drag] transition-[margin-left] duration-300 ease-in-out motion-reduce:transition-none',
                  !showSidebar && 'ml-0'
                ]
            )}>
            {conversationControls}
          </ConversationTopBarPortalHost>
        </div>
      </div>
    </NavbarHeader>
  )
}

export default HeaderNavbar
