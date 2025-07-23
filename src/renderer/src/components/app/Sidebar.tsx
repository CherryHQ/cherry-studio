import EmojiAvatar from '@renderer/components/Avatar/EmojiAvatar'
import { isMac } from '@renderer/config/constant'
import { AppLogo, UserAvatar } from '@renderer/config/env'
import { useTheme } from '@renderer/context/ThemeProvider'
import useAvatar from '@renderer/hooks/useAvatar'
import { useFullscreen } from '@renderer/hooks/useFullscreen'
import { useMinappPopup } from '@renderer/hooks/useMinappPopup'
import { useMinapps } from '@renderer/hooks/useMinapps'
import useNavBackgroundColor from '@renderer/hooks/useNavBackgroundColor'
import { modelGenerating, useRuntime } from '@renderer/hooks/useRuntime'
import { useSettings } from '@renderer/hooks/useSettings'
import i18n from '@renderer/i18n'
import PinButton from '@renderer/pages/home/components/PinButton'
import { ThemeMode } from '@renderer/types'
import { isEmoji } from '@renderer/utils'
import type { MenuProps } from 'antd'
import { Avatar, Dropdown, Tooltip } from 'antd'
import {
  CircleHelp,
  FileSearch,
  Folder,
  Languages,
  LayoutGrid,
  MessageSquare,
  Moon,
  Palette,
  Settings,
  Sparkle,
  Sun,
  SunMoon
} from 'lucide-react'
import { FC, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import styled from 'styled-components'

import { DraggableList } from '../DraggableList'
import MinAppIcon from '../Icons/MinAppIcon'
import UserPopup from '../Popups/UserPopup'

const Sidebar: FC = () => {
  const { hideMinappPopup, openMinapp } = useMinappPopup()
  const { minappShow, currentMinappId } = useRuntime()
  const { sidebarIcons } = useSettings()
  const { pinned } = useMinapps()

  const { pathname } = useLocation()
  const navigate = useNavigate()

  const { theme, settedTheme, toggleTheme } = useTheme()
  const avatar = useAvatar()
  const { t } = useTranslation()

  const onEditUser = () => UserPopup.show()

  const backgroundColor = useNavBackgroundColor()

  const showPinnedApps = pinned.length > 0 && sidebarIcons.visible.includes('minapp')

  const to = async (path: string) => {
    await modelGenerating()
    navigate(path)
  }

  const docsId = 'cherrystudio-docs'
  const onOpenDocs = () => {
    const isChinese = i18n.language.startsWith('zh')
    openMinapp({
      id: docsId,
      name: t('docs.title'),
      url: isChinese ? 'https://docs.cherry-ai.com/' : 'https://docs.cherry-ai.com/cherry-studio-wen-dang/en-us',
      logo: AppLogo
    })
  }

  const isFullscreen = useFullscreen()

  return (
    <Container
      $isFullscreen={isFullscreen}
      id="app-sidebar"
      style={{ backgroundColor, zIndex: minappShow ? 10000 : 'initial' }}>
      {isEmoji(avatar) ? (
        <EmojiAvatar onClick={onEditUser} className="sidebar-avatar" size={31} fontSize={18}>
          {avatar}
        </EmojiAvatar>
      ) : (
        <AvatarImg src={avatar || UserAvatar} draggable={false} className="nodrag" onClick={onEditUser} />
      )}
      <MainMenusContainer>
        <Menus onClick={hideMinappPopup}>
          <MainMenus />
        </Menus>
        <SidebarOpenedMinappTabs />
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
        <PinButton />
        <Tooltip title={t('docs.title')} mouseEnterDelay={0.8} placement="right">
          <Icon theme={theme} onClick={onOpenDocs} className={minappShow && currentMinappId === docsId ? 'active' : ''}>
            <CircleHelp size={20} className="icon" />
          </Icon>
        </Tooltip>
        <Tooltip
          title={t('settings.theme.title') + ': ' + t(`settings.theme.${settedTheme}`)}
          mouseEnterDelay={0.8}
          placement="right">
          <Icon theme={theme} onClick={() => toggleTheme()}>
            {settedTheme === ThemeMode.dark ? (
              <Moon size={20} className="icon" />
            ) : settedTheme === ThemeMode.light ? (
              <Sun size={20} className="icon" />
            ) : (
              <SunMoon size={20} className="icon" />
            )}
          </Icon>
        </Tooltip>
        <Tooltip title={t('settings.title')} mouseEnterDelay={0.8} placement="right">
          <StyledLink
            onClick={async () => {
              hideMinappPopup()
              await to('/settings/provider')
            }}>
            <Icon theme={theme} className={pathname.startsWith('/settings') && !minappShow ? 'active' : ''}>
              <Settings size={20} className="icon" />
            </Icon>
          </StyledLink>
        </Tooltip>
      </Menus>
    </Container>
  )
}

const MainMenus: FC = () => {
  const { hideMinappPopup } = useMinappPopup()
  const { t } = useTranslation()
  const { pathname } = useLocation()
  const { sidebarIcons, defaultPaintingProvider } = useSettings()
  const { minappShow } = useRuntime()
  const navigate = useNavigate()
  const { theme } = useTheme()

  const isRoute = (path: string): string => (pathname === path && !minappShow ? 'active' : '')
  const isRoutes = (path: string): string => (pathname.startsWith(path) && !minappShow ? 'active' : '')

  const iconMap = {
    assistants: <MessageSquare size={18} className="icon" />,
    agents: <Sparkle size={18} className="icon" />,
    paintings: <Palette size={18} className="icon" />,
    translate: <Languages size={18} className="icon" />,
    minapp: <LayoutGrid size={18} className="icon" />,
    knowledge: <FileSearch size={18} className="icon" />,
    files: <Folder size={17} className="icon" />
  }

  const pathMap = {
    assistants: '/',
    agents: '/agents',
    paintings: `/paintings/${defaultPaintingProvider}`,
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
            hideMinappPopup()
            await modelGenerating()
            navigate(path)
          }}>
          <Icon theme={theme} className={isActive}>
            {iconMap[icon]}
          </Icon>
        </StyledLink>
      </Tooltip>
    )
  })
}

/** Tabs of opened minapps in sidebar */
const SidebarOpenedMinappTabs: FC = () => {
  const { minappShow, openedKeepAliveMinapps, currentMinappId } = useRuntime()
  const { openMinappKeepAlive, hideMinappPopup, closeMinapp, closeAllMinapps } = useMinappPopup()
  const { showOpenedMinappsInSidebar } = useSettings() // 获取控制显示的设置
  const { theme } = useTheme()
  const { t } = useTranslation()

  const handleOnClick = (app) => {
    if (minappShow && currentMinappId === app.id) {
      hideMinappPopup()
    } else {
      openMinappKeepAlive(app)
    }
  }

  // animation for minapp switch indicator
  useEffect(() => {
    //hacky way to get the height of the icon
    const iconDefaultHeight = 40
    const iconDefaultOffset = 17
    const container = document.querySelector('.TabsContainer') as HTMLElement
    const activeIcon = document.querySelector('.TabsContainer .opened-active') as HTMLElement

    let indicatorTop = 0,
      indicatorRight = 0
    if (minappShow && activeIcon && container) {
      indicatorTop = activeIcon.offsetTop + activeIcon.offsetHeight / 2 - 4 // 4 is half of the indicator's height (8px)
      indicatorRight = 0
    } else {
      indicatorTop =
        ((openedKeepAliveMinapps.length > 0 ? openedKeepAliveMinapps.length : 1) / 2) * iconDefaultHeight +
        iconDefaultOffset -
        4
      indicatorRight = -50
    }
    container.style.setProperty('--indicator-top', `${indicatorTop}px`)
    container.style.setProperty('--indicator-right', `${indicatorRight}px`)
  }, [currentMinappId, openedKeepAliveMinapps, minappShow])

  // 检查是否需要显示已打开小程序组件
  const isShowOpened = showOpenedMinappsInSidebar && openedKeepAliveMinapps.length > 0

  // 如果不需要显示，返回空容器保持动画效果但不显示内容
  if (!isShowOpened) return <TabsContainer className="TabsContainer" />

  return (
    <TabsContainer className="TabsContainer">
      <Divider />
      <TabsWrapper>
        <Menus>
          {openedKeepAliveMinapps.map((app) => {
            const menuItems: MenuProps['items'] = [
              {
                key: 'closeApp',
                label: t('minapp.sidebar.close.title'),
                onClick: () => {
                  closeMinapp(app.id)
                }
              },
              {
                key: 'closeAllApp',
                label: t('minapp.sidebar.closeall.title'),
                onClick: () => {
                  closeAllMinapps()
                }
              }
            ]
            const isActive = minappShow && currentMinappId === app.id

            return (
              <Tooltip key={app.id} title={app.name} mouseEnterDelay={0.8} placement="right">
                <StyledLink>
                  <Dropdown menu={{ items: menuItems }} trigger={['contextMenu']} overlayStyle={{ zIndex: 10000 }}>
                    <Icon
                      theme={theme}
                      onClick={() => handleOnClick(app)}
                      className={`${isActive ? 'opened-active' : ''}`}>
                      <MinAppIcon size={20} app={app} style={{ borderRadius: 6 }} sidebar />
                    </Icon>
                  </Dropdown>
                </StyledLink>
              </Tooltip>
            )
          })}
        </Menus>
      </TabsWrapper>
    </TabsContainer>
  )
}

const PinnedApps: FC = () => {
  const { pinned, updatePinnedMinapps } = useMinapps()
  const { t } = useTranslation()
  const { minappShow, openedKeepAliveMinapps, currentMinappId } = useRuntime()
  const { theme } = useTheme()
  const { openMinappKeepAlive } = useMinappPopup()

  return (
    <DraggableList list={pinned} onUpdate={updatePinnedMinapps} listStyle={{ marginBottom: 5 }}>
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
        const isActive = minappShow && currentMinappId === app.id
        return (
          <Tooltip key={app.id} title={app.name} mouseEnterDelay={0.8} placement="right">
            <StyledLink>
              <Dropdown menu={{ items: menuItems }} trigger={['contextMenu']} overlayStyle={{ zIndex: 10000 }}>
                <Icon
                  theme={theme}
                  onClick={() => openMinappKeepAlive(app)}
                  className={`${isActive ? 'active' : ''} ${openedKeepAliveMinapps.some((item) => item.id === app.id) ? 'opened-minapp' : ''}`}>
                  <MinAppIcon size={20} app={app} style={{ borderRadius: 6 }} sidebar />
                </Icon>
              </Dropdown>
            </StyledLink>
          </Tooltip>
        )
      }}
    </DraggableList>
  )
}

const Container = styled.div<{ $isFullscreen: boolean }>`
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px 0;
  padding-bottom: 12px;
  width: var(--sidebar-width);
  min-width: var(--sidebar-width);
  height: ${({ $isFullscreen }) => (isMac && !$isFullscreen ? 'calc(100vh - var(--navbar-height))' : '100vh')};
  -webkit-app-region: drag !important;
  margin-top: ${({ $isFullscreen }) => (isMac && !$isFullscreen ? 'var(--navbar-height)' : 0)};

  .sidebar-avatar {
    margin-bottom: ${isMac ? '12px' : '12px'};
    margin-top: ${isMac ? '0px' : '2px'};
    -webkit-app-region: none;
  }
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

const Icon = styled.div<{ theme: string }>`
  width: 35px;
  height: 35px;
  display: flex;
  justify-content: center;
  align-items: center;
  border-radius: 50%;
  box-sizing: border-box;
  -webkit-app-region: none;
  border: 0.5px solid transparent;
  &:hover {
    background-color: ${({ theme }) => (theme === 'dark' ? 'var(--color-black)' : 'var(--color-white)')};
    opacity: 0.8;
    cursor: pointer;
    .icon {
      color: var(--color-icon-white);
    }
  }
  &.active {
    background-color: ${({ theme }) => (theme === 'dark' ? 'var(--color-black)' : 'var(--color-white)')};
    border: 0.5px solid var(--color-border);
    .icon {
      color: var(--color-primary);
    }
  }

  @keyframes borderBreath {
    0% {
      opacity: 0.1;
    }
    50% {
      opacity: 1;
    }
    100% {
      opacity: 0.1;
    }
  }

  &.opened-minapp {
    position: relative;
  }
  &.opened-minapp::after {
    content: '';
    position: absolute;
    width: 100%;
    height: 100%;
    top: 0;
    left: 0;
    border-radius: inherit;
    opacity: 0.3;
    border: 0.5px solid var(--color-primary);
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

const TabsContainer = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  -webkit-app-region: none;
  position: relative;
  width: 100%;

  &::after {
    content: '';
    position: absolute;
    right: var(--indicator-right, 0);
    top: var(--indicator-top, 0);
    width: 4px;
    height: 8px;
    background-color: var(--color-primary);
    transition:
      top 0.3s cubic-bezier(0.4, 0, 0.2, 1),
      right 0.3s ease-in-out;
    border-radius: 2px;
  }

  &::-webkit-scrollbar {
    display: none;
  }
`

const TabsWrapper = styled.div`
  background-color: rgba(128, 128, 128, 0.1);
  border-radius: 20px;
  overflow: hidden;
`

export default Sidebar
