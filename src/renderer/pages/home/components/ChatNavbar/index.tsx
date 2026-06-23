import { usePreference } from '@data/hooks/usePreference'
import { NavbarHeader } from '@renderer/components/app/Navbar'
import { CommandTooltip } from '@renderer/components/command'
import { SidebarCollapseIcon, SidebarExpandIcon } from '@renderer/components/Icons'
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
  const [preferredShowSidebar, setShowSidebar] = usePreference('topic.tab.show')
  const showSidebar = sidebarOpen ?? preferredShowSidebar
  const newTopic = useResolvedCommand('topic.create')
  const toggleShowSidebar = () => {
    if (onSidebarToggle) {
      onSidebarToggle()
      return
    }

    void setShowSidebar(!showSidebar)
  }

  return (
    <NavbarHeader
      className='home-navbar relative after:pointer-events-none after:absolute after:top-full after:right-0 after:left-0 after:z-10 in-data-conversation-shell-topbar:after:hidden after:h-3 after:bg-linear-to-b after:from-background after:to-transparent after:content-[""]'
      style={{ height: 'var(--navbar-height)' }}>
      <div className="-mx-1 flex h-full min-w-0 flex-1 items-center justify-between overflow-hidden">
        <div data-navbar-left-occupant className="flex shrink-0 items-center">
          {showSidebarControls &&
            (showSidebar ? (
              <CommandTooltip
                command="app.sidebar.toggle"
                label={t('navbar.hide_sidebar')}
                placement="bottom"
                delay={800}>
                <NavbarIcon tone="conversation" aria-pressed={showSidebar} onClick={toggleShowSidebar}>
                  <SidebarCollapseIcon />
                </NavbarIcon>
              </CommandTooltip>
            ) : (
              <>
                <CommandTooltip
                  command="app.sidebar.toggle"
                  label={t('navbar.show_sidebar')}
                  placement="bottom"
                  delay={800}>
                  <NavbarIcon
                    tone="conversation"
                    aria-pressed={showSidebar}
                    onClick={toggleShowSidebar}
                    style={{ marginRight: 2 }}>
                    <SidebarExpandIcon />
                  </NavbarIcon>
                </CommandTooltip>
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
        </div>
      </div>
    </NavbarHeader>
  )
}

export default HeaderNavbar
