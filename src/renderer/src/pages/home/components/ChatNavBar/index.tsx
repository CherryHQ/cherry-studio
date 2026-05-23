import { Tooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { NavbarHeader } from '@renderer/components/app/Navbar'
import { SidebarCollapseIcon, SidebarExpandIcon } from '@renderer/components/Icons'
import { t } from 'i18next'
import { Menu } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import type { FC } from 'react'

import NavbarIcon from '../../../../components/NavbarIcon'
import ChatNavbarContent from './ChatNavbarContent'

interface HeaderNavbarProps {
  onOpenSidePanelDrawer?: () => void | Promise<void>
  onOpenTopicFlow?: () => void | Promise<void>
  showSidebarControls?: boolean
}

const HeaderNavbar: FC<HeaderNavbarProps> = ({
  onOpenSidePanelDrawer,
  onOpenTopicFlow,
  showSidebarControls = true
}) => {
  const [showSidebar, setShowSidebar] = usePreference('topic.tab.show')
  const toggleShowSidebar = () => void setShowSidebar(!showSidebar)

  return (
    <NavbarHeader className="home-navbar" style={{ height: 'var(--navbar-height)' }}>
      <div className="-mx-1 flex h-full min-w-0 flex-1 items-center justify-between overflow-hidden">
        <div className="flex shrink-0 items-center">
          {showSidebarControls &&
            (showSidebar ? (
              <Tooltip placement="bottom" content={t('navbar.hide_sidebar')} delay={800}>
                <NavbarIcon onClick={toggleShowSidebar}>
                  <SidebarCollapseIcon />
                </NavbarIcon>
              </Tooltip>
            ) : (
              <Tooltip placement="bottom" content={t('navbar.show_sidebar')} delay={800}>
                <NavbarIcon onClick={toggleShowSidebar} style={{ marginRight: 2 }}>
                  <SidebarExpandIcon />
                </NavbarIcon>
              </Tooltip>
            ))}
          {showSidebarControls && (
            <AnimatePresence initial={false}>
              {!showSidebar && (
                <motion.div
                  initial={{ width: 0, opacity: 0 }}
                  animate={{ width: 'auto', opacity: 1 }}
                  exit={{ width: 0, opacity: 0 }}
                  transition={{ duration: 0.3, ease: 'easeInOut' }}>
                  <NavbarIcon onClick={() => void onOpenSidePanelDrawer?.()} style={{ marginRight: 5 }}>
                    <Menu size={18} />
                  </NavbarIcon>
                </motion.div>
              )}
            </AnimatePresence>
          )}
        </div>
        <div className="flex shrink-0 items-center">
          <ChatNavbarContent onOpenTopicFlow={onOpenTopicFlow} />
        </div>
      </div>
    </NavbarHeader>
  )
}

export default HeaderNavbar
