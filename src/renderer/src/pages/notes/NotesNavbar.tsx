import { Navbar, NavbarLeft, NavbarRight } from '@renderer/components/app/Navbar'
import { HStack } from '@renderer/components/Layout'
import { isMac } from '@renderer/config/constant'
import { useFullscreen } from '@renderer/hooks/useFullscreen'
import { useShowWorkspace } from '@renderer/hooks/useStore'
import { Tooltip } from 'antd'
import { PanelLeftClose, PanelRightClose } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const NotesNavbar = () => {
  const { t } = useTranslation()
  const { showWorkspace, toggleShowWorkspace } = useShowWorkspace()
  const isFullscreen = useFullscreen()
  const [sidebarHideCooldown, setSidebarHideCooldown] = useState(false)

  const handleToggleShowWorkspace = useCallback(() => {
    if (showWorkspace) {
      toggleShowWorkspace()
      setSidebarHideCooldown(true)
    } else {
      toggleShowWorkspace()
    }
  }, [showWorkspace, toggleShowWorkspace])

  return (
    <Navbar className="notes-navbar">
      {showWorkspace && (
        <NavbarLeft style={{ justifyContent: 'space-between', borderRight: 'none', padding: 0 }}>
          <Tooltip title={t('navbar.hide_sidebar')} mouseEnterDelay={0.8}>
            <NavbarIcon onClick={handleToggleShowWorkspace} style={{ marginLeft: isMac && !isFullscreen ? 16 : 0 }}>
              <PanelLeftClose size={18} />
            </NavbarIcon>
          </Tooltip>
        </NavbarLeft>
      )}
      <NavbarRight style={{ justifyContent: 'space-between', flex: 1 }} className="notes-navbar-right">
        <HStack alignItems="center">
          {!showWorkspace && !sidebarHideCooldown && (
            <Tooltip title={t('navbar.show_sidebar')} mouseEnterDelay={0.8}>
              <NavbarIcon
                onClick={handleToggleShowWorkspace}
                style={{ marginRight: 8, marginLeft: isMac && !isFullscreen ? 4 : -12 }}>
                <PanelRightClose size={18} />
              </NavbarIcon>
            </Tooltip>
          )}
          {!showWorkspace && sidebarHideCooldown && (
            <Tooltip title={t('navbar.show_sidebar')} mouseEnterDelay={0.8}>
              <NavbarIcon
                onClick={handleToggleShowWorkspace}
                style={{ marginRight: 8, marginLeft: isMac && !isFullscreen ? 4 : -12 }}
                onMouseOut={() => setSidebarHideCooldown(false)}>
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

export default NotesNavbar
