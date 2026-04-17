import { Tooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useMiniAppPopup } from '@renderer/hooks/useMiniAppPopup'
import { useMiniApps } from '@renderer/hooks/useMiniApps'
import { useNavbarPosition } from '@renderer/hooks/useNavbar'
import type { MiniApp } from '@shared/data/types/miniapp'
import type { MenuProps } from 'antd'
import { Dropdown } from 'antd'
import type { FC } from 'react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { DraggableList } from '../DraggableList'
import MiniAppIcon from '../Icons/MiniAppIcon'

/** Tabs of opened miniapps in sidebar */
export const SidebarOpenedMiniAppTabs: FC = () => {
  const { miniAppShow, openedKeepAliveMiniApps, currentMiniAppId } = useMiniApps()
  const { openMiniAppKeepAlive, hideMiniAppPopup, closeMiniApp, closeAllMiniApps } = useMiniAppPopup()
  const [showOpenedMiniAppsInSidebar] = usePreference('feature.mini_app.show_opened_in_sidebar')
  const { theme } = useTheme()
  const { t } = useTranslation()
  const { isLeftNavbar } = useNavbarPosition()

  const handleOnClick = (app: MiniApp) => {
    if (miniAppShow && currentMiniAppId === app.appId) {
      hideMiniAppPopup()
    } else {
      openMiniAppKeepAlive(app)
    }
  }

  // animation for miniapp switch indicator
  useEffect(() => {
    //hacky way to get the height of the icon
    const iconDefaultHeight = 40
    const iconDefaultOffset = 17
    const container = document.querySelector('.TabsContainer') as HTMLElement
    const activeIcon = document.querySelector('.TabsContainer .opened-active') as HTMLElement

    let indicatorTop = 0,
      indicatorRight = 0
    if (miniAppShow && activeIcon && container) {
      indicatorTop = activeIcon.offsetTop + activeIcon.offsetHeight / 2 - 4 // 4 is half of the indicator's height (8px)
      indicatorRight = 0
    } else {
      indicatorTop =
        ((openedKeepAliveMiniApps.length > 0 ? openedKeepAliveMiniApps.length : 1) / 2) * iconDefaultHeight +
        iconDefaultOffset -
        4
      indicatorRight = -50
    }
    container.style.setProperty('--indicator-top', `${indicatorTop}px`)
    container.style.setProperty('--indicator-right', `${indicatorRight}px`)
  }, [currentMiniAppId, openedKeepAliveMiniApps, miniAppShow])

  // Check whether to show the opened-miniapps component
  const isShowOpened = showOpenedMiniAppsInSidebar && openedKeepAliveMiniApps.length > 0

  // If not needed, return an empty container to preserve animation but show no content
  if (!isShowOpened) return <TabsContainer className="TabsContainer" />

  return (
    <TabsContainer className="TabsContainer">
      {isLeftNavbar && <Divider />}
      <TabsWrapper>
        <Menus>
          {openedKeepAliveMiniApps.map((app) => {
            const menuItems: MenuProps['items'] = [
              {
                key: 'closeApp',
                label: t('miniapp.sidebar.close.title'),
                onClick: () => {
                  closeMiniApp(app.appId)
                }
              },
              {
                key: 'closeAllApp',
                label: t('miniapp.sidebar.closeall.title'),
                onClick: () => {
                  closeAllMiniApps()
                }
              }
            ]
            const isActive = miniAppShow && currentMiniAppId === app.appId

            return (
              <Dropdown
                key={app.appId}
                menu={{ items: menuItems }}
                trigger={['contextMenu']}
                overlayStyle={{ zIndex: 10000 }}>
                {/* FIXME: Antd Dropdown is not compatible with HeroUI Tooltip */}
                {/* <Tooltip content={app.name} placement="right" delay={800}> */}
                <Icon theme={theme} onClick={() => handleOnClick(app)} className={`${isActive ? 'opened-active' : ''}`}>
                  <MiniAppIcon size={20} app={app} style={{ borderRadius: 6 }} sidebar />
                </Icon>
                {/* </Tooltip> */}
              </Dropdown>
            )
          })}
        </Menus>
      </TabsWrapper>
    </TabsContainer>
  )
}

export const SidebarPinnedApps: FC = () => {
  const { pinned, updatePinnedMiniApps, miniAppShow, openedKeepAliveMiniApps, currentMiniAppId } = useMiniApps()
  const { t } = useTranslation()
  const { theme } = useTheme()
  const { openMiniAppKeepAlive } = useMiniAppPopup()
  const { isTopNavbar } = useNavbarPosition()

  return (
    <DraggableList list={pinned} onUpdate={updatePinnedMiniApps} listStyle={{ marginBottom: 5 }}>
      {(app) => {
        const menuItems: MenuProps['items'] = [
          {
            key: 'togglePin',
            label: isTopNavbar ? t('miniapp.remove_from_launchpad') : t('miniapp.remove_from_sidebar'),
            onClick: () => {
              void updatePinnedMiniApps(pinned.filter((item) => item.appId !== app.appId))
            }
          }
        ]
        const isActive = miniAppShow && currentMiniAppId === app.appId
        return (
          <Tooltip key={app.appId} content={app.name} placement="right" delay={800}>
            <Dropdown menu={{ items: menuItems }} trigger={['contextMenu']} overlayStyle={{ zIndex: 10000 }}>
              <Icon
                theme={theme}
                onClick={() => openMiniAppKeepAlive(app)}
                className={`${isActive ? 'active' : ''} ${openedKeepAliveMiniApps.some((item) => item.appId === app.appId) ? 'opened-miniapp' : ''}`}>
                <MiniAppIcon size={20} app={app} style={{ borderRadius: 6 }} sidebar />
              </Icon>
            </Dropdown>
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
  }
  &.active {
    background-color: ${({ theme }) => (theme === 'dark' ? 'var(--color-black)' : 'var(--color-white)')};
    border: 0.5px solid var(--color-border);
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

  &.opened-miniapp {
    position: relative;
  }
  &.opened-miniapp::after {
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
