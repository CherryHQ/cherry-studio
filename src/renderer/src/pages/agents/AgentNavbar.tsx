import { usePreference } from '@data/hooks/usePreference'
import { Navbar, NavbarCenter, NavbarLeft, NavbarRight } from '@renderer/components/app/Navbar'
import NavbarIcon from '@renderer/components/NavbarIcon'
import SearchPopup from '@renderer/components/Popups/SearchPopup'
import { modelGenerating } from '@renderer/hooks/useModel'
import { useShortcut } from '@renderer/hooks/useShortcuts'
import { useShowAssistants, useShowTopics } from '@renderer/hooks/useStore'
import { Tooltip } from 'antd'
import { t } from 'i18next'
import { Menu, PanelLeftClose, PanelRightClose, Search } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import styled from 'styled-components'

import UpdateAppButton from '../home/components/UpdateAppButton'
import AgentSidePanelDrawer from './components/AgentSidePanelDrawer'

const AgentNavbar = () => {
  const { showAssistants, toggleShowAssistants } = useShowAssistants()
  const { showTopics, toggleShowTopics } = useShowTopics()
  const [narrowMode, setNarrowMode] = usePreference('chat.narrow_mode')
  const [topicPosition] = usePreference('topic.position')

  useShortcut('toggle_show_assistants', toggleShowAssistants)

  useShortcut('search_message', () => {
    SearchPopup.show()
  })

  const handleNarrowModeToggle = async () => {
    await modelGenerating()
    setNarrowMode(!narrowMode)
  }

  return (
    <Navbar className="agent-navbar">
      <AnimatePresence initial={false}>
        {showAssistants && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 'auto', opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
            style={{ overflow: 'hidden', display: 'flex', flexDirection: 'row' }}>
            <NavbarLeft style={{ justifyContent: 'space-between', borderRight: 'none', padding: 0 }}>
              <Tooltip title={t('navbar.hide_sidebar')} mouseEnterDelay={0.8}>
                <NavbarIcon onClick={toggleShowAssistants}>
                  <PanelLeftClose size={18} />
                </NavbarIcon>
              </Tooltip>
            </NavbarLeft>
          </motion.div>
        )}
      </AnimatePresence>
      {!showAssistants && (
        <NavbarLeft
          style={{
            justifyContent: 'flex-start',
            borderRight: 'none',
            paddingLeft: 0,
            paddingRight: 0,
            minWidth: 'auto'
          }}>
          <Tooltip title={t('navbar.show_sidebar')} mouseEnterDelay={0.8} placement="right">
            <NavbarIcon onClick={() => toggleShowAssistants()}>
              <PanelRightClose size={18} />
            </NavbarIcon>
          </Tooltip>
          <NavbarIcon onClick={() => AgentSidePanelDrawer.show()} style={{ marginRight: 5 }}>
            <Menu size={18} />
          </NavbarIcon>
        </NavbarLeft>
      )}
      <NavbarCenter></NavbarCenter>
      <NavbarRight
        style={{
          justifyContent: 'flex-end',
          flex: 'none',
          position: 'relative',
          paddingRight: '15px',
          minWidth: 'auto'
        }}
        className="agent-navbar-right">
        <div className="flex items-center gap-1.5">
          <UpdateAppButton />
          <Tooltip title={t('chat.assistant.search.placeholder')} mouseEnterDelay={0.8}>
            <NarrowIcon onClick={() => SearchPopup.show()}>
              <Search size={18} />
            </NarrowIcon>
          </Tooltip>
          <Tooltip title={t('navbar.expand')} mouseEnterDelay={0.8}>
            <NarrowIcon onClick={handleNarrowModeToggle}>
              <i className="iconfont icon-icon-adaptive-width"></i>
            </NarrowIcon>
          </Tooltip>
          {topicPosition === 'right' && !showTopics && (
            <Tooltip title={t('navbar.show_sidebar')} mouseEnterDelay={2}>
              <NavbarIcon onClick={toggleShowTopics}>
                <PanelLeftClose size={18} />
              </NavbarIcon>
            </Tooltip>
          )}
          {topicPosition === 'right' && showTopics && (
            <Tooltip title={t('navbar.hide_sidebar')} mouseEnterDelay={2}>
              <NavbarIcon onClick={toggleShowTopics}>
                <PanelRightClose size={18} />
              </NavbarIcon>
            </Tooltip>
          )}
        </div>
      </NavbarRight>
    </Navbar>
  )
}

const NarrowIcon = styled(NavbarIcon)`
  @media (max-width: 1000px) {
    display: none;
  }
`

export default AgentNavbar
