import { Navbar } from '@renderer/components/app/Navbar'
import { HStack } from '@renderer/components/Layout'
import MinAppsPopover from '@renderer/components/Popups/MinAppsPopover'
import SearchPopup from '@renderer/components/Popups/SearchPopup'
import { isLinux, isMac, isWindows } from '@renderer/config/constant'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useFullscreen } from '@renderer/hooks/useFullscreen'
import { modelGenerating } from '@renderer/hooks/useRuntime'
import { useSettings } from '@renderer/hooks/useSettings'
import { useShortcut } from '@renderer/hooks/useShortcuts'
import { useShowAssistants, useShowTopics } from '@renderer/hooks/useStore'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { useAppDispatch } from '@renderer/store'
import { setNarrowMode } from '@renderer/store/settings'
import { Assistant } from '@renderer/types'
import { Tooltip } from 'antd'
import { t } from 'i18next'
import { LayoutGrid, PanelLeft, PanelRight, Search } from 'lucide-react'
import { FC, useCallback } from 'react'
import styled from 'styled-components'

import SelectModelButton from './components/SelectModelButton'
import UpdateAppButton from './components/UpdateAppButton'

interface Props {
  activeAssistant: Assistant
  position: 'left' | 'right'
}

const ChatNavbar: FC<Props> = ({ activeAssistant }) => {
  const { assistant } = useAssistant(activeAssistant.id)
  const { showAssistants, toggleShowAssistants } = useShowAssistants()
  const isFullscreen = useFullscreen()
  const { topicPosition, sidebarIcons, narrowMode } = useSettings()
  const { toggleShowTopics } = useShowTopics()
  const dispatch = useAppDispatch()

  // Function to toggle assistants with cooldown
  const handleToggleShowAssistants = useCallback(() => {
    if (showAssistants) {
      // When hiding sidebar, set cooldown
      toggleShowAssistants()
      // setTimeout(() => {
      //   setSidebarHideCooldown(false)
      // }, 10000) // 10 seconds cooldown
    } else {
      // When showing sidebar, no cooldown needed
      toggleShowAssistants()
    }
  }, [showAssistants, toggleShowAssistants])

  useShortcut('toggle_show_assistants', handleToggleShowAssistants)

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

  return (
    <Navbar className="home-navbar">
      <NavbarContainer $isFullscreen={isFullscreen} $showSidebar={showAssistants} className="home-navbar-right">
        <HStack alignItems="center">
          <NavbarIcon
            onClick={() => toggleShowAssistants()}
            style={{ marginRight: 8, marginLeft: isMac && !isFullscreen ? 4 : -12 }}>
            {showAssistants ? <PanelLeft size={18} /> : <PanelRight size={18} />}
          </NavbarIcon>
          <SelectModelButton assistant={assistant} />
        </HStack>
        <HStack alignItems="center" gap={8}>
          <UpdateAppButton />
          {isMac && (
            <Tooltip title={t('chat.assistant.search.placeholder')} mouseEnterDelay={0.8}>
              <NarrowIcon onClick={() => SearchPopup.show()}>
                <Search size={18} />
              </NarrowIcon>
            </Tooltip>
          )}
          <Tooltip title={t('navbar.expand')} mouseEnterDelay={0.8}>
            <NarrowIcon onClick={handleNarrowModeToggle}>
              <i className="iconfont icon-icon-adaptive-width"></i>
            </NarrowIcon>
          </Tooltip>
          {sidebarIcons.visible.includes('minapp') && (
            <MinAppsPopover>
              <Tooltip title={t('minapp.title')} mouseEnterDelay={0.8}>
                <NarrowIcon>
                  <LayoutGrid size={18} />
                </NarrowIcon>
              </Tooltip>
            </MinAppsPopover>
          )}
        </HStack>
      </NavbarContainer>
    </Navbar>
  )
}

const NavbarContainer = styled.div<{ $isFullscreen: boolean; $showSidebar: boolean }>`
  flex: 1;
  display: flex;
  flex-direction: row;
  align-items: center;
  height: var(--navbar-height);
  max-height: var(--navbar-height);
  min-height: var(--navbar-height);
  justify-content: space-between;
  padding-left: ${({ $showSidebar }) => (isMac ? ($showSidebar ? '10px' : '75px') : '15px')};
  font-weight: bold;
  color: var(--color-text-1);
  padding-right: ${({ $isFullscreen }) => ($isFullscreen ? '12px' : isWindows ? '140px' : isLinux ? '120px' : '12px')};
  -webkit-app-region: drag;
`

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

export default ChatNavbar
