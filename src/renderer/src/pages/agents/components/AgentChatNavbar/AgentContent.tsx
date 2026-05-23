import { Tooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { SidebarCollapseIcon, SidebarExpandIcon } from '@renderer/components/Icons'
import NavbarIcon from '@renderer/components/NavbarIcon'
import type { AgentEntity } from '@shared/data/types/agent'
import { Menu } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import AgentSidePanelDrawer from '../AgentSidePanelDrawer'
import Tools from './Tools'

type AgentContentProps = {
  activeAgent: AgentEntity | null
  tools?: ReactNode
  showSidebarControls?: boolean
}

const AgentContent = ({ activeAgent, tools, showSidebarControls = true }: AgentContentProps) => {
  const { t } = useTranslation()
  const [showSidebar, setShowSidebar] = usePreference('topic.tab.show')
  const toggleShowSidebar = () => void setShowSidebar(!showSidebar)

  return (
    <div className="flex w-full justify-between">
      <div className="flex min-w-0 shrink items-center">
        {showSidebarControls && (
          <>
            {showSidebar && (
              <Tooltip title={t('navbar.hide_sidebar')} delay={800}>
                <NavbarIcon onClick={toggleShowSidebar}>
                  <SidebarCollapseIcon />
                </NavbarIcon>
              </Tooltip>
            )}
            {!showSidebar && (
              <Tooltip title={t('navbar.show_sidebar')} delay={800} placement="right">
                <NavbarIcon onClick={toggleShowSidebar} style={{ marginRight: 2 }}>
                  <SidebarExpandIcon />
                </NavbarIcon>
              </Tooltip>
            )}
            <AnimatePresence initial={false}>
              {!showSidebar && (
                <motion.div
                  initial={{ width: 0, opacity: 0 }}
                  animate={{ width: 'auto', opacity: 1 }}
                  exit={{ width: 0, opacity: 0 }}
                  transition={{ duration: 0.3, ease: 'easeInOut' }}>
                  <NavbarIcon onClick={() => AgentSidePanelDrawer.show()} style={{ marginRight: 5 }}>
                    <Menu size={18} />
                  </NavbarIcon>
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}
      </div>
      <div className="flex items-center">{activeAgent && <Tools>{tools}</Tools>}</div>
    </div>
  )
}

export default AgentContent
