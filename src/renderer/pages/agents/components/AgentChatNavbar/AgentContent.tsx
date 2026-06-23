import { usePreference } from '@data/hooks/usePreference'
import { CommandTooltip } from '@renderer/components/command'
import { SidebarCollapseIcon, SidebarExpandIcon } from '@renderer/components/Icons'
import NavbarIcon from '@renderer/components/NavbarIcon'
import { useResolvedCommand } from '@renderer/hooks/command'
import type { AgentEntity } from '@shared/data/types/agent'
import { SquarePen } from 'lucide-react'
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
  const newSession = useResolvedCommand('topic.create')
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
              <>
                <CommandTooltip
                  command="app.sidebar.toggle"
                  label={t('navbar.show_sidebar')}
                  delay={800}
                  placement="right">
                  <NavbarIcon
                    tone="conversation"
                    aria-pressed={showSidebar}
                    onClick={toggleShowSidebar}
                    style={{ marginInlineEnd: 2 }}>
                    <SidebarExpandIcon />
                  </NavbarIcon>
                </CommandTooltip>
                <CommandTooltip
                  command="topic.create"
                  label={t('agent.session.add.title')}
                  delay={800}
                  placement="bottom">
                  <NavbarIcon
                    tone="conversation"
                    aria-label={t('agent.session.add.title')}
                    className="[&_svg]:!size-4"
                    disabled={!newSession.enabled}
                    onClick={newSession.execute}>
                    <SquarePen />
                  </NavbarIcon>
                </CommandTooltip>
              </>
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
