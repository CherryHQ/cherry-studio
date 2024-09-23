import { FolderOutlined, TranslationOutlined } from '@ant-design/icons'
import { isMac } from '@renderer/config/constant'
import { isLocalAi, UserAvatar } from '@renderer/config/env'
import useAvatar from '@renderer/hooks/useAvatar'
import { useSettings } from '@renderer/hooks/useSettings'
import { useRuntime } from '@renderer/hooks/useStore'
import { Avatar } from 'antd'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import styled from 'styled-components'

import MinApp from '../MinApp'
import UserPopup from '../Popups/UserPopup'

const Sidebar: FC = () => {
  const { pathname } = useLocation()
  const avatar = useAvatar()
  const { minappShow } = useRuntime()
  const { generating } = useRuntime()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { windowStyle } = useSettings()

  const isRoute = (path: string): string => (pathname === path ? 'active' : '')

  const onEditUser = () => UserPopup.show()

  const macTransparentWindow = isMac && windowStyle === 'transparent'
  const sidebarBgColor = macTransparentWindow ? 'transparent' : 'var(--navbar-background)'

  const to = (path: string) => {
    if (generating) {
      window.message.warning({ content: t('message.switch.disabled'), key: 'switch-assistant' })
      return
    }
    navigate(path)
  }

  return (
    <Container
      id="app-sidebar"
      style={{
        backgroundColor: sidebarBgColor,
        zIndex: minappShow ? 10000 : 'initial'
      }}>
      <AvatarImg src={avatar || UserAvatar} draggable={false} className="nodrag" onClick={onEditUser} />
      <MainMenus>
        <Menus onClick={MinApp.onClose}>
          <StyledLink onClick={() => to('/')}>
            <Icon className={isRoute('/')}>
              <i className="iconfont icon-chat" />
            </Icon>
          </StyledLink>
          <StyledLink onClick={() => to('/agents')}>
            <Icon className={isRoute('/agents')}>
              <i className="iconfont icon-business-smart-assistant" />
            </Icon>
          </StyledLink>
          <StyledLink onClick={() => to('/translate')}>
            <Icon className={isRoute('/translate')}>
              <TranslationOutlined />
            </Icon>
          </StyledLink>
          <StyledLink onClick={() => to('/apps')}>
            <Icon className={isRoute('/apps')}>
              <i className="iconfont icon-appstore" />
            </Icon>
          </StyledLink>
          <StyledLink onClick={() => to('/files')}>
            <Icon className={isRoute('/files')}>
              <FolderOutlined />
            </Icon>
          </StyledLink>
        </Menus>
      </MainMenus>
      <Menus onClick={MinApp.onClose}>
        <StyledLink onClick={() => to(isLocalAi ? '/settings/assistant' : '/settings/provider')}>
          <Icon className={pathname.startsWith('/settings') ? 'active' : ''}>
            <i className="iconfont icon-setting" />
          </Icon>
        </StyledLink>
      </Menus>
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px 0;
  width: var(--sidebar-width);
  min-width: var(--sidebar-width);
  height: ${isMac ? 'calc(100vh - var(--navbar-height))' : '100vh'};
  -webkit-app-region: drag !important;
  margin-top: ${isMac ? 'var(--navbar-height)' : 0};
  transition: background-color 0.3s ease;
`

const AvatarImg = styled(Avatar)`
  width: 32px;
  height: 32px;
  background-color: var(--color-background-soft);
  margin-bottom: ${isMac ? '12px' : '12px'};
  margin-top: ${isMac ? '-5px' : '2px'};
  border: none;
  cursor: pointer;
`
const MainMenus = styled.div`
  display: flex;
  flex: 1;
`

const Menus = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
`

const Icon = styled.div`
  width: 35px;
  height: 35px;
  display: flex;
  justify-content: center;
  align-items: center;
  border-radius: 50%;
  margin-bottom: 5px;
  transition: background-color 0.2s ease;
  -webkit-app-region: none;
  transition: all 0.2s ease;
  .iconfont,
  .anticon {
    color: var(--color-icon);
    font-size: 20px;
    transition: color 0.2s ease;
    text-decoration: none;
  }
  .anticon {
    font-size: 17px;
  }
  &:hover {
    background-color: var(--color-hover);
    cursor: pointer;
    .iconfont,
    .anticon {
      color: var(--color-icon-white);
    }
  }
  &.active {
    background-color: var(--color-active);
    .iconfont,
    .anticon {
      color: var(--color-icon-white);
    }
  }
`

const StyledLink = styled.div`
  text-decoration: none;
  -webkit-app-region: none;
  &* {
    user-select: none;
  }
`

export default Sidebar
