import { RowFlex, Tooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { Navbar, NavbarCenter, NavbarLeft, NavbarRight } from '@renderer/components/app/Navbar'
import SearchPopup from '@renderer/components/Popups/SearchPopup'
import { useShortcut } from '@renderer/hooks/useShortcuts'
import { t } from 'i18next'
import { PanelLeftClose, PanelRightClose, Search } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import type { FC } from 'react'

import NavbarIcon from '../../components/NavbarIcon'
import UpdateAppButton from './components/UpdateAppButton'

interface Props {
  position: 'left' | 'right'
}

const HeaderNavbar: FC<Props> = () => {
  const [narrowMode, setNarrowMode] = usePreference('chat.narrow_mode')
  const [topicPosition] = usePreference('topic.position')
  // Single source of truth for the topics sidebar (the only sidebar in v2).
  const [showSidebar, setShowSidebar] = usePreference('topic.tab.show')
  const toggleShowSidebar = () => void setShowSidebar(!showSidebar)

  useShortcut('general.search', () => {
    void SearchPopup.show()
  })

  const handleNarrowModeToggle = () => {
    void setNarrowMode(!narrowMode)
  }

  return (
    <Navbar className="home-navbar">
      <AnimatePresence initial={false}>
        {showSidebar && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 'auto', opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
            style={{ overflow: 'hidden', display: 'flex', flexDirection: 'row' }}>
            <NavbarLeft style={{ justifyContent: 'space-between', borderRight: 'none', padding: 0 }}>
              <Tooltip placement="bottom" content={t('navbar.hide_sidebar')} delay={800}>
                <NavbarIcon onClick={toggleShowSidebar}>
                  <PanelLeftClose size={18} />
                </NavbarIcon>
              </Tooltip>
            </NavbarLeft>
          </motion.div>
        )}
      </AnimatePresence>
      {!showSidebar && (
        <NavbarLeft
          style={{
            justifyContent: 'flex-start',
            borderRight: 'none',
            paddingLeft: 0,
            paddingRight: 0,
            minWidth: 'auto'
          }}>
          <Tooltip placement="bottom" content={t('navbar.show_sidebar')} delay={800}>
            <NavbarIcon onClick={toggleShowSidebar}>
              <PanelRightClose size={18} />
            </NavbarIcon>
          </Tooltip>
        </NavbarLeft>
      )}
      <NavbarCenter></NavbarCenter>
      <NavbarRight
        style={{
          justifyContent: 'flex-end',
          flex: 1,
          position: 'relative',
          paddingRight: '15px'
        }}
        className="home-navbar-right">
        <RowFlex className="items-center gap-1.5">
          <UpdateAppButton />
          <Tooltip placement="bottom" content={t('chat.assistant.search.placeholder')} delay={800}>
            <NavbarIcon className="max-[1000px]:hidden" onClick={() => SearchPopup.show()}>
              <Search size={18} />
            </NavbarIcon>
          </Tooltip>
          <Tooltip placement="bottom" content={t('navbar.expand')} delay={800}>
            <NavbarIcon className="max-[1000px]:hidden" onClick={handleNarrowModeToggle}>
              <i className="iconfont icon-icon-adaptive-width"></i>
            </NavbarIcon>
          </Tooltip>
          {topicPosition === 'right' && (
            <Tooltip
              placement="bottom"
              content={showSidebar ? t('navbar.hide_sidebar') : t('navbar.show_sidebar')}
              delay={2000}>
              <NavbarIcon onClick={toggleShowSidebar}>
                {showSidebar ? <PanelRightClose size={18} /> : <PanelLeftClose size={18} />}
              </NavbarIcon>
            </Tooltip>
          )}
        </RowFlex>
      </NavbarRight>
    </Navbar>
  )
}

export default HeaderNavbar
