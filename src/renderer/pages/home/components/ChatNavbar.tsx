import { usePreference } from '@data/hooks/usePreference'
import { ConversationSidebarToggleButton } from '@renderer/components/chat/shell/ConversationSidebarToggleButton'
import { ConversationTopBarPortalHost } from '@renderer/components/chat/shell/ConversationTopBarPortal'
import { CommandTooltip } from '@renderer/components/command'
import { NavbarHeader } from '@renderer/components/Navbar'
import NavbarIcon from '@renderer/components/NavbarIcon'
import { useResolvedCommand } from '@renderer/hooks/command'
import { t } from 'i18next'
import { SquarePen } from 'lucide-react'
import type { FC } from 'react'

interface HeaderNavbarProps {
  showSidebarControls?: boolean
  sidebarOpen?: boolean
  onSidebarToggle?: () => void
}

const HeaderNavbar: FC<HeaderNavbarProps> = ({ showSidebarControls = true, sidebarOpen, onSidebarToggle }) => {
  const [preferredShowSidebar] = usePreference('topic.tab.show')
  const showSidebar = sidebarOpen ?? preferredShowSidebar
  const newTopic = useResolvedCommand('topic.create')

  return (
    <NavbarHeader className="home-navbar relative" style={{ height: 'var(--navbar-height)' }}>
      <div className="-mx-1 flex h-full min-w-0 flex-1 items-center justify-between overflow-hidden">
        <div data-navbar-left-occupant className="flex min-w-0 flex-1 items-center overflow-hidden">
          {showSidebarControls &&
            (showSidebar ? (
              <ConversationSidebarToggleButton
                sidebarOpen={showSidebar}
                onSidebarToggle={onSidebarToggle}
                tooltipPlacement="bottom"
              />
            ) : (
              <>
                <ConversationSidebarToggleButton
                  sidebarOpen={showSidebar}
                  onSidebarToggle={onSidebarToggle}
                  tooltipPlacement="bottom"
                  style={{ marginRight: 2 }}
                />
                <CommandTooltip
                  command="topic.create"
                  label={t('chat.conversation.new')}
                  placement="bottom"
                  delay={800}>
                  <NavbarIcon
                    tone="conversation"
                    aria-label={t('chat.conversation.new')}
                    className="[&_svg]:size-4!"
                    disabled={!newTopic.enabled}
                    onClick={newTopic.execute}>
                    <SquarePen />
                  </NavbarIcon>
                </CommandTooltip>
              </>
            ))}
          <ConversationTopBarPortalHost />
        </div>
      </div>
    </NavbarHeader>
  )
}

export default HeaderNavbar
