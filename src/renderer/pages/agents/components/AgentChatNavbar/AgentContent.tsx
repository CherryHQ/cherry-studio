import { usePreference } from '@data/hooks/usePreference'
import { SidebarCollapseIcon, SidebarExpandIcon } from '@renderer/components/Icons'
import NavbarIcon from '@renderer/components/NavbarIcon'
import { CommandTooltip } from '@renderer/features/command'
import type { AgentEntity } from '@shared/data/types/agent'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

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
  const { t } = useTranslation()
  const [preferredShowSidebar, setShowSidebar] = usePreference('topic.tab.show')
  const showSidebar = sidebarOpen ?? preferredShowSidebar
  const toggleShowSidebar = () => {
    if (onSidebarToggle) {
      onSidebarToggle()
      return
    }

    void setShowSidebar(!showSidebar)
  }

  return (
    <div className="flex w-full justify-between">
      <div data-navbar-left-occupant className="flex min-w-0 shrink items-center">
        {showSidebarControls && (
          <>
            {showSidebar && (
              <CommandTooltip command="app.sidebar.toggle" label={t('navbar.hide_sidebar')} delay={800}>
                <NavbarIcon tone="conversation" aria-pressed={showSidebar} onClick={toggleShowSidebar}>
                  <SidebarCollapseIcon />
                </NavbarIcon>
              </CommandTooltip>
            )}
            {!showSidebar && (
              <CommandTooltip
                command="app.sidebar.toggle"
                label={t('navbar.show_sidebar')}
                delay={800}
                placement="right">
                <NavbarIcon
                  tone="conversation"
                  aria-pressed={showSidebar}
                  onClick={toggleShowSidebar}
                  style={{ marginRight: 2 }}>
                  <SidebarExpandIcon />
                </NavbarIcon>
              </CommandTooltip>
            )}
          </>
        )}
      </div>
      <div data-navbar-right-occupant className="flex items-center">
        {activeAgent && <Tools>{tools}</Tools>}
      </div>
    </div>
  )
}

export default AgentContent
