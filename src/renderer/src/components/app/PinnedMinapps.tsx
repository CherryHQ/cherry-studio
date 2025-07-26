import { useTheme } from '@renderer/context/ThemeProvider'
import { useMinappPopup } from '@renderer/hooks/useMinappPopup'
import { useMinapps } from '@renderer/hooks/useMinapps'
import { useRuntime } from '@renderer/hooks/useRuntime'
import { useNavbarPosition, useSettings } from '@renderer/hooks/useSettings'
import type { MenuProps } from 'antd'
import { Dropdown, Tooltip } from 'antd'
import { FC, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { DraggableList } from '../DraggableList'
import MinAppIcon from '../Icons/MinAppIcon'

/** Tabs of opened minapps in top navbar */
export const TopNavbarOpenedMinappTabs: FC = () => {
  const { minappShow, openedKeepAliveMinapps, currentMinappId } = useRuntime()
  const { openMinappKeepAlive, hideMinappPopup, closeMinapp, closeAllMinapps } = useMinappPopup()
  const { showOpenedMinappsInSidebar } = useSettings()
  const { theme } = useTheme()
  const { t } = useTranslation()
  const [keepAliveMinapps, setKeepAliveMinapps] = useState(openedKeepAliveMinapps)

  useEffect(() => {
    setTimeout(() => setKeepAliveMinapps(openedKeepAliveMinapps), 300)
  }, [openedKeepAliveMinapps])

  const handleOnClick = (app) => {
    if (minappShow && currentMinappId === app.id) {
      hideMinappPopup()
    } else {
      openMinappKeepAlive(app)
    }
  }

  // 检查是否需要显示已打开小程序组件
  const isShowOpened = showOpenedMinappsInSidebar && keepAliveMinapps.length > 0

  // 如果不需要显示，返回空容器
  if (!isShowOpened) return null

  return (
    <TopNavContainer
      style={{ backgroundColor: keepAliveMinapps.length > 1 ? 'var(--color-list-item)' : 'transparent' }}>
      <TopNavMenus>
        {keepAliveMinapps.map((app) => {
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
            <Tooltip key={app.id} title={app.name} mouseEnterDelay={0.8} placement="bottom">
              <StyledLink>
                <Dropdown menu={{ items: menuItems }} trigger={['contextMenu']} overlayStyle={{ zIndex: 10000 }}>
                  <TopNavIcon
                    theme={theme}
                    onClick={() => handleOnClick(app)}
                    className={`${isActive ? 'opened-active' : ''}`}>
                    <MinAppIcon size={22} app={app} style={{ border: 'none', padding: 0 }} />
                  </TopNavIcon>
                </Dropdown>
              </StyledLink>
            </Tooltip>
          )
        })}
      </TopNavMenus>
    </TopNavContainer>
  )
}

/** Tabs of opened minapps in sidebar */
export const SidebarOpenedMinappTabs: FC = () => {
  const { minappShow, openedKeepAliveMinapps, currentMinappId } = useRuntime()
  const { openMinappKeepAlive, hideMinappPopup, closeMinapp, closeAllMinapps } = useMinappPopup()
  const { showOpenedMinappsInSidebar } = useSettings() // 获取控制显示的设置
  const { theme } = useTheme()
  const { t } = useTranslation()
  const { isLeftNavbar } = useNavbarPosition()

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
      {isLeftNavbar && <Divider />}
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

export const SidebarPinnedApps: FC = () => {
  const { pinned, updatePinnedMinapps } = useMinapps()
  const { t } = useTranslation()
  const { minappShow, openedKeepAliveMinapps, currentMinappId } = useRuntime()
  const { theme } = useTheme()
  const { openMinappKeepAlive } = useMinappPopup()
  const { isTopNavbar } = useNavbarPosition()

  return (
    <DraggableList list={pinned} onUpdate={updatePinnedMinapps} listStyle={{ marginBottom: 5 }}>
      {(app) => {
        const menuItems: MenuProps['items'] = [
          {
            key: 'togglePin',
            label: isTopNavbar ? t('minapp.remove_from_launchpad') : t('minapp.remove_from_sidebar'),
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

const TopNavContainer = styled.div`
  display: flex;
  align-items: center;
  padding: 4px 2px;
  gap: 6px;
  background-color: var(--color-list-item);
  border-radius: 20px;
  margin: 0 5px;
`

const TopNavMenus = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 2px;
  height: 100%;
`

const TopNavIcon = styled(Icon)`
  width: 22px;
  height: 22px;

  .icon {
    width: 22px;
    height: 22px;
  }

  &:hover {
    background-color: ${({ theme }) => (theme === 'dark' ? 'var(--color-black)' : 'var(--color-white)')};
    opacity: 0.8;
    border-radius: 50%;
  }

  &.opened-active {
    background-color: ${({ theme }) => (theme === 'dark' ? 'var(--color-black)' : 'var(--color-white)')};
    border: 0.5px solid var(--color-border);
    border-radius: 50%;
    .icon {
      color: var(--color-primary);
    }
  }
`
