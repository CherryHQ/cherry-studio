import { Navbar, NavbarLeft, NavbarRight } from '@renderer/components/app/Navbar'
import { HStack } from '@renderer/components/Layout'
import SearchPopup from '@renderer/components/Popups/SearchPopup'
import { isLinux, isMac, isWin } from '@renderer/config/constant'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { modelGenerating } from '@renderer/hooks/useRuntime'
import { useSettings } from '@renderer/hooks/useSettings'
import { useShortcut } from '@renderer/hooks/useShortcuts'
import { useShowAssistants, useShowTopics } from '@renderer/hooks/useStore'
import { useChatMaxWidth } from '@renderer/pages/home/Chat'
import ChatNavbarContent from '@renderer/pages/home/components/ChatNavbarContent'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { useAppDispatch } from '@renderer/store'
import { setNarrowMode } from '@renderer/store/settings'
import { Assistant, Topic } from '@renderer/types'
import { Tooltip } from 'antd'
import { t } from 'i18next'
import { Menu, PanelLeftClose, PanelRightClose, Search } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import React, { FC } from 'react'
import styled from 'styled-components'

import AssistantsDrawer from './components/AssistantsDrawer'
import SelectModelButton from './components/SelectModelButton'
import UpdateAppButton from './components/UpdateAppButton'

interface Props {
  activeAssistant: Assistant
  activeTopic: Topic
  setActiveTopic: (topic: Topic) => void
  setActiveAssistant: (assistant: Assistant) => void
  position: 'left' | 'right'
  activeTopicOrSession?: 'topic' | 'session'
}

const HeaderNavbar: FC<Props> = ({
  activeAssistant,
  setActiveAssistant,
  activeTopic,
  setActiveTopic,
  activeTopicOrSession
}) => {
  const { assistant } = useAssistant(activeAssistant.id)
  const { showAssistants, toggleShowAssistants } = useShowAssistants()
  const { topicPosition, narrowMode } = useSettings()
  const { showTopics, toggleShowTopics } = useShowTopics()
  const chatMaxWidth = useChatMaxWidth()
  const dispatch = useAppDispatch()

  useShortcut('toggle_show_assistants', toggleShowAssistants)

  useShortcut('toggle_show_topics', () => {
    if (topicPosition === 'right') {
      toggleShowTopics()
    } else {
      EventEmitter.emit(EVENT_NAMES.SHOW_TOPIC_SIDEBAR)
    }
  })

  useShortcut('search_message', () => {
    SearchPopup.show()
  })

  const handleNarrowModeToggle = async () => {
    await modelGenerating()
    dispatch(setNarrowMode(!narrowMode))
  }

  const onShowAssistantsDrawer = () => {
    AssistantsDrawer.show({
      activeAssistant,
      setActiveAssistant,
      activeTopic,
      setActiveTopic
    })
  }

  return (
    <Navbar className="home-navbar">
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
            paddingRight: 10,
            minWidth: 'auto'
          }}>
          <Tooltip title={t('navbar.show_sidebar')} mouseEnterDelay={0.8}>
            <NavbarIcon onClick={() => toggleShowAssistants()}>
              <PanelRightClose size={18} />
            </NavbarIcon>
          </Tooltip>
          <AnimatePresence initial={false}>
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 'auto', opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.3, ease: 'easeInOut' }}
              style={{ overflow: 'hidden' }}>
              <NavbarIcon onClick={onShowAssistantsDrawer} style={{ marginLeft: 8 }}>
                <Menu size={18} />
              </NavbarIcon>
            </motion.div>
          </AnimatePresence>
        </NavbarLeft>
      )}
      {activeTopicOrSession === 'topic' ? (
        <HStack alignItems="center" gap={6} ml={!isMac ? 16 : 0}>
          <SelectModelButton assistant={assistant} />
        </HStack>
      ) : (
        <ChatNavbarContainer style={{ maxWidth: chatMaxWidth }}>
          <ChatNavbarContent assistant={assistant} />
        </ChatNavbarContainer>
      )}

      <NavbarRight
        style={{
          justifyContent: 'flex-end',
          flex: activeTopicOrSession === 'topic' ? 1 : 'none',
          position: 'relative',
          paddingRight: isWin || isLinux ? '144px' : '15px',
          minWidth: activeTopicOrSession === 'topic' ? '' : 'auto'
        }}
        className="home-navbar-right">
        <HStack alignItems="center" gap={6}>
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
          <UpdateAppButton />
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
        </HStack>
      </NavbarRight>
    </Navbar>
  )
}

export const NavbarIcon = styled.div`
  -webkit-app-region: none;
  border-radius: 8px;
  height: 30px;
  padding: 0 7px;
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;
  transition: all 0.2s ease-in-out;
  cursor: pointer;
  .iconfont {
    font-size: 18px;
    color: var(--color-icon);
    &.icon-a-addchat {
      font-size: 20px;
    }
    &.icon-a-darkmode {
      font-size: 20px;
    }
    &.icon-appstore {
      font-size: 20px;
    }
  }
  .anticon {
    color: var(--color-icon);
    font-size: 16px;
  }
  &:hover {
    background-color: var(--color-background-mute);
    color: var(--color-icon-white);
  }
`

const NarrowIcon = styled(NavbarIcon)`
  @media (max-width: 1000px) {
    display: none;
  }
`

const ChatNavbarContainer: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({
  children,
  style
}) => {
  return (
    <div className="flex min-w-0 flex-1 items-center justify-start gap-1.5 overflow-hidden" style={style}>
      {children}
    </div>
  )
}

export default HeaderNavbar
