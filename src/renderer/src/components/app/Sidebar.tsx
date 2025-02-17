import {
  FileSearchOutlined,
  FolderOutlined,
  PictureOutlined,
  QuestionCircleOutlined,
  TranslationOutlined
} from '@ant-design/icons'
import { isMac } from '@renderer/config/constant'
import { AppLogo, isLocalAi, UserAvatar } from '@renderer/config/env'
import { useTheme } from '@renderer/context/ThemeProvider'
import useAvatar from '@renderer/hooks/useAvatar'
import { useMinapps } from '@renderer/hooks/useMinapps'
import { modelGenerating, useRuntime } from '@renderer/hooks/useRuntime'
import { useSettings } from '@renderer/hooks/useSettings'
import type { MenuProps } from 'antd'
import { Tooltip } from 'antd'
import { Avatar } from 'antd'
import { Dropdown } from 'antd'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import styled from 'styled-components'

import DragableList from '../DragableList'
import MinAppIcon from '../Icons/MinAppIcon'
import MinApp from '../MinApp'
import UserPopup from '../Popups/UserPopup'

const Sidebar: FC = () => {
  const { pathname } = useLocation()
  const avatar = useAvatar()
  const { minappShow } = useRuntime()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { windowStyle, sidebarIcons } = useSettings()
  const { theme, toggleTheme } = useTheme()
  const { pinned } = useMinapps()

  const onEditUser = () => UserPopup.show()

  const macTransparentWindow = isMac && windowStyle === 'transparent'
  const sidebarBgColor = macTransparentWindow ? 'transparent' : 'var(--navbar-background)'

  const showPinnedApps = pinned.length > 0 && sidebarIcons.visible.includes('minapp')

  const to = async (path: string) => {
    await modelGenerating()
    navigate(path)
  }

  const onOpenDocs = () => {
    MinApp.start({
      id: 'docs',
      name: t('docs.title'),
      url: 'https://docs.cherry-ai.com/',
      logo: AppLogo
    })
  }

  return (
    <Container
      id="app-sidebar"
      style={{
        backgroundColor: sidebarBgColor,
        zIndex: minappShow ? 10000 : 'initial'
      }}>
      <AvatarImg src={avatar || UserAvatar} draggable={false} className="nodrag" onClick={onEditUser} />
      <MainMenusContainer>
        <Menus onClick={MinApp.onClose}>
          <MainMenus />
        </Menus>
        {showPinnedApps && (
          <AppsContainer>
            <Divider />
            <Menus>
              <PinnedApps />
            </Menus>
          </AppsContainer>
        )}
      </MainMenusContainer>
      <Menus>
        <Tooltip title={t('docs.title')} mouseEnterDelay={0.8} placement="right">
          <Icon
            onClick={onOpenDocs}
            className={minappShow && MinApp.app?.url === 'https://docs.cherry-ai.com/' ? 'active' : ''}>
            <QuestionCircleOutlined />
          </Icon>
        </Tooltip>
        <Tooltip title={t('settings.theme.title')} mouseEnterDelay={0.8} placement="right">
          <Icon onClick={() => toggleTheme()}>
            {theme === 'dark' ? (
              <i className="iconfont icon-theme icon-dark1" />
            ) : (
              <i className="iconfont icon-theme icon-theme-light" />
            )}
          </Icon>
        </Tooltip>
        <Tooltip title={t('settings.title')} mouseEnterDelay={0.8} placement="right">
          <StyledLink
            onClick={async () => {
              if (minappShow) {
                await MinApp.close()
              }
              await to(isLocalAi ? '/settings/assistant' : '/settings/provider')
            }}>
            <Icon className={pathname.startsWith('/settings') && !minappShow ? 'active' : ''}>
              <i className="iconfont icon-setting" />
            </Icon>
          </StyledLink>
        </Tooltip>
      </Menus>
    </Container>
  )
}

const MainMenus: FC = () => {
  const { t } = useTranslation()
  const { pathname } = useLocation()
  const { sidebarIcons } = useSettings()
  const { minappShow } = useRuntime()
  const navigate = useNavigate()

  const isRoute = (path: string): string => (pathname === path && !minappShow ? 'active' : '')
  const isRoutes = (path: string): string => (pathname.startsWith(path) && !minappShow ? 'active' : '')

  const iconMap = {
    assistants: <i className="iconfont icon-chat" />,
    agents: <i className="iconfont icon-business-smart-assistant" />,
    paintings: <PictureOutlined style={{ fontSize: 16 }} />,
    translate: <TranslationOutlined />,
    minapp: <i className="iconfont icon-appstore" />,
    knowledge: <FileSearchOutlined />,
    files: <FolderOutlined />
  }

  const pathMap = {
    assistants: '/',
    agents: '/agents',
    paintings: '/paintings',
    translate: '/translate',
    minapp: '/apps',
    knowledge: '/knowledge',
    files: '/files'
  }

  return sidebarIcons.visible.map((icon) => {
    const path = pathMap[icon]
    const isActive = path === '/' ? isRoute(path) : isRoutes(path)

    return (
      <Tooltip key={icon} title={t(`${icon}.title`)} mouseEnterDelay={0.8} placement="right">
        <StyledLink
          onClick={async () => {
            if (minappShow) {
              await MinApp.close()
            }
            navigate(path)
          }}>
          <Icon className={isActive}>{iconMap[icon]}</Icon>
        </StyledLink>
      </Tooltip>
    )
  })
}

const PinnedApps: FC = () => {
  const { pinned, updatePinnedMinapps } = useMinapps()
  const { t } = useTranslation()
  const { minappShow } = useRuntime()

  return (
    <DragableList list={pinned} onUpdate={updatePinnedMinapps} listStyle={{ marginBottom: 5 }}>
      {(app) => {
        const menuItems: MenuProps['items'] = [
          {
            key: 'togglePin',
            label: t('minapp.sidebar.remove.title'),
            onClick: () => {
              const newPinned = pinned.filter((item) => item.id !== app.id)
              updatePinnedMinapps(newPinned)
            }
          }
        ]
        const isActive = minappShow && MinApp.app?.id === app.id
        return (
          <Tooltip key={app.id} title={app.name} mouseEnterDelay={0.8} placement="right">
            <StyledLink>
              <Dropdown menu={{ items: menuItems }} trigger={['contextMenu']}>
                <Icon onClick={() => MinApp.start(app)} className={isActive ? 'active' : ''}>
                  <MinAppIcon size={20} app={app} style={{ borderRadius: 6 }} />
                </Icon>
              </Dropdown>
            </StyledLink>
          </Tooltip>
        )
      }}
    </DragableList>
  )
}

const Container = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px 0;
  padding-bottom: 12px;
  width: var(--sidebar-width);
  min-width: var(--sidebar-width);
  height: ${isMac ? 'calc(100vh - var(--navbar-height))' : '100vh'};
  -webkit-app-region: drag !important;
  margin-top: ${isMac ? 'var(--navbar-height)' : 0};
`

const AvatarImg = styled(Avatar)`
  width: 31px;
  height: 31px;
  background-color: var(--color-background-soft);
  margin-bottom: ${isMac ? '12px' : '12px'};
  margin-top: ${isMac ? '0px' : '2px'};
  border: none;
  cursor: pointer;
`
const MainMenusContainer = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  overflow: hidden;
`

const Menus = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
`

const Icon = styled.div`
  width: 35px;
  height: 35px;
  display: flex;
  justify-content: center;
  align-items: center;
  border-radius: 50%;
  -webkit-app-region: none;
  border: 0.5px solid transparent;
  .iconfont,
  .anticon {
    color: var(--color-icon);
    font-size: 20px;
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
    border: 0.5px solid var(--color-border);
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

const AppsContainer = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  overflow-y: auto;
  overflow-x: hidden;
  margin-bottom: 10px;
  -webkit-app-region: none;
  &::-webkit-scrollbar {
    display: none;
  }
`

const Divider = styled.div`
  width: 50%;
  margin: 8px 0;
  border-bottom: 0.5px solid var(--color-border);
`

export default Sidebar
