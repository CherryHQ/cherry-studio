import { usePreference } from '@data/hooks/usePreference'
import { ConversationSidebarToggleButton } from '@renderer/components/chat/shell/ConversationSidebarToggleButton'
import { CommandTooltip } from '@renderer/components/command'
import { NavbarHeader } from '@renderer/components/Navbar'
import NavbarIcon from '@renderer/components/NavbarIcon'
import { useResolvedCommand } from '@renderer/hooks/command'
import { useWindowFrame } from '@renderer/hooks/useWindowFrame'
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
  const { mode, chrome } = useWindowFrame()

  return (
    <NavbarHeader className="home-navbar relative" style={{ height: 'var(--navbar-height)' }}>
      <div className="-mx-1 flex h-full min-w-0 flex-1 items-center justify-between overflow-hidden">
        <div data-navbar-left-occupant className="flex shrink-0 items-center">
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
          {mode === 'window' && chrome?.titleLeading ? (
            <div className={showSidebarControls ? 'ml-2 min-w-0' : 'min-w-0'}>{chrome.titleLeading}</div>
          ) : null}
        </div>
      </div>
    </NavbarHeader>
  )
}

export default HeaderNavbar
