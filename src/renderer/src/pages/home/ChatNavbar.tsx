import { Navbar } from '@renderer/components/app/Navbar'
import NarrowModeIcon from '@renderer/components/Icons/NarrowModeIcon'
import { HStack } from '@renderer/components/Layout'
import SearchPopup from '@renderer/components/Popups/SearchPopup'
import { isLinux, isMac, isWindows } from '@renderer/config/constant'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useChat } from '@renderer/hooks/useChat'
import { useFullscreen } from '@renderer/hooks/useFullscreen'
import { modelGenerating } from '@renderer/hooks/useRuntime'
import { useSettings } from '@renderer/hooks/useSettings'
import { useShortcut } from '@renderer/hooks/useShortcuts'
import { useShowAssistants } from '@renderer/hooks/useStore'
import { useAppDispatch } from '@renderer/store'
import { setNarrowMode } from '@renderer/store/settings'
import { Tooltip } from 'antd'
import { t } from 'i18next'
import { LayoutGrid, PanelLeft, PanelRight, Search } from 'lucide-react'
import { FC } from 'react'
import { useNavigate } from 'react-router'
import styled from 'styled-components'

import SelectModelButton from './components/SelectModelButton'
import UpdateAppButton from './components/UpdateAppButton'

const ChatNavbar: FC = () => {
  const { activeAssistant } = useChat()
  const { assistant } = useAssistant(activeAssistant.id)
  const { showAssistants, toggleShowAssistants } = useShowAssistants()
  const isFullscreen = useFullscreen()
  const { sidebarIcons, narrowMode } = useSettings()
  const dispatch = useAppDispatch()
  const navigate = useNavigate()

  useShortcut('search_message', SearchPopup.show)

  const handleNarrowModeToggle = async () => {
    await modelGenerating()
    dispatch(setNarrowMode(!narrowMode))
  }

  return (
    <Navbar className="home-navbar">
      <NavbarContainer $isFullscreen={isFullscreen} $showSidebar={showAssistants} className="home-navbar-right">
        <HStack alignItems="center" gap={8}>
          <NavbarIcon onClick={() => toggleShowAssistants()}>
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
              <NarrowModeIcon isNarrowMode={narrowMode} />
            </NarrowIcon>
          </Tooltip>
          {sidebarIcons.visible.includes('minapp') && (
            <Tooltip title={t('minapp.title')} mouseEnterDelay={0.8}>
              <NarrowIcon onClick={() => navigate('/apps')}>
                <LayoutGrid size={18} />
              </NarrowIcon>
            </Tooltip>
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
  margin-left: ${({ $showSidebar }) => ($showSidebar ? '15px' : isMac ? '75px' : '15px')};
  font-weight: bold;
  color: var(--color-text-1);
  padding-right: ${({ $isFullscreen }) => ($isFullscreen ? '15px' : isWindows ? '140px' : isLinux ? '120px' : '15px')};
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
  &.active {
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
