import { RowFlex, Tooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { NavbarHeader } from '@renderer/components/app/Navbar'
import SearchPopup from '@renderer/components/Popups/SearchPopup'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { modelGenerating } from '@renderer/hooks/useModel'
import { useNavbarPosition } from '@renderer/hooks/useNavbar'
import { useShortcut } from '@renderer/hooks/useShortcuts'
import { useShowAssistants, useShowTopics } from '@renderer/hooks/useStore'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { Assistant, Topic } from '@renderer/types'
import { t } from 'i18next'
import { Menu, PanelLeftClose, PanelRightClose, Search } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import type { FC } from 'react'
import styled from 'styled-components'

import AssistantsDrawer from './components/AssistantsDrawer'
import ChatNavbarContent from './components/ChatNavbarContent'
import UpdateAppButton from './components/UpdateAppButton'

interface Props {
  activeAssistant: Assistant
  activeTopic: Topic
  setActiveTopic: (topic: Topic) => void
  setActiveAssistant: (assistant: Assistant) => void
  position: 'left' | 'right'
}

const HeaderNavbar: FC<Props> = ({ activeAssistant, setActiveAssistant, activeTopic, setActiveTopic }) => {
  const [topicPosition] = usePreference('topic.position')
  const [narrowMode, setNarrowMode] = usePreference('chat.narrow_mode')

  const { assistant } = useAssistant(activeAssistant.id)
  const { showAssistants, toggleShowAssistants } = useShowAssistants()

  const { showTopics, toggleShowTopics } = useShowTopics()
  const { isTopNavbar } = useNavbarPosition()

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
    setNarrowMode(!narrowMode)
  }

  const onShowAssistantsDrawer = () => {
    AssistantsDrawer.show({
      activeAssistant,
      setActiveAssistant,
      activeTopic,
      setActiveTopic
    })
  }

  // const handleUpdateModel = useCallback(
  //   async (model: ApiModel) => {
  //     if (!activeSession || !activeAgent) return
  //     return updateModel(activeSession.id, model.id, { showSuccessToast: false })
  //   },
  //   [activeAgent, activeSession, updateModel]
  // )

  return (
    <NavbarHeader className="home-navbar" style={{ height: 'var(--navbar-height)' }}>
      <div className="flex h-full min-w-0 flex-1 shrink items-center overflow-auto">
        {isTopNavbar && showAssistants && (
          <Tooltip placement="bottom" content={t('navbar.hide_sidebar')} delay={800}>
            <NavbarIcon onClick={toggleShowAssistants}>
              <PanelLeftClose size={18} />
            </NavbarIcon>
          </Tooltip>
        )}
        {isTopNavbar && !showAssistants && (
          <Tooltip placement="bottom" content={t('navbar.show_sidebar')} delay={800}>
            <NavbarIcon onClick={() => toggleShowAssistants()} style={{ marginRight: 8 }}>
              <PanelRightClose size={18} />
            </NavbarIcon>
          </Tooltip>
        )}
        <AnimatePresence initial={false}>
          {!showAssistants && isTopNavbar && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 'auto', opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.3, ease: 'easeInOut' }}>
              <NavbarIcon onClick={onShowAssistantsDrawer} style={{ marginRight: 5 }}>
                <Menu size={18} />
              </NavbarIcon>
            </motion.div>
          )}
        </AnimatePresence>
        <ChatNavbarContent assistant={assistant} />
      </div>
      <RowFlex className="items-center gap-2">
        {isTopNavbar && <UpdateAppButton />}
        {isTopNavbar && (
          <Tooltip placement="bottom" content={t('navbar.expand')} delay={800}>
            <NarrowIcon onClick={handleNarrowModeToggle}>
              <i className="iconfont icon-icon-adaptive-width"></i>
            </NarrowIcon>
          </Tooltip>
        )}
        {isTopNavbar && (
          <Tooltip placement="bottom" content={t('chat.assistant.search.placeholder')} delay={800}>
            <NavbarIcon onClick={() => SearchPopup.show()}>
              <Search size={18} />
            </NavbarIcon>
          </Tooltip>
        )}
        {isTopNavbar && topicPosition === 'right' && !showTopics && (
          <Tooltip placement="bottom" content={t('navbar.show_sidebar')} delay={2000}>
            <NavbarIcon onClick={toggleShowTopics}>
              <PanelLeftClose size={18} />
            </NavbarIcon>
          </Tooltip>
        )}
        {isTopNavbar && topicPosition === 'right' && showTopics && (
          <Tooltip placement="bottom" content={t('navbar.hide_sidebar')} delay={2000}>
            <NavbarIcon onClick={toggleShowTopics}>
              <PanelRightClose size={18} />
            </NavbarIcon>
          </Tooltip>
        )}
      </RowFlex>
    </NavbarHeader>
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

export default HeaderNavbar
