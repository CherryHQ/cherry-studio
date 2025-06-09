import MinAppIcon from '@renderer/components/Icons/MinAppIcon'
import IndicatorLight from '@renderer/components/IndicatorLight'
import { Center } from '@renderer/components/Layout'
import { useMinappPopup } from '@renderer/hooks/useMinappPopup'
import { useRuntime } from '@renderer/hooks/useRuntime'
import { useSettings } from '@renderer/hooks/useSettings'
import type { MenuProps } from 'antd'
import { Empty } from 'antd'
import { Dropdown } from 'antd'
import { isEmpty } from 'lodash'
import { FC, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import {
  MainMenuItem,
  MainMenuItemIcon,
  MainMenuItemLeft,
  MainMenuItemRight,
  MainMenuItemText,
  Menus,
  TabsContainer,
  TabsWrapper
} from './MainSidebarStyles'

const OpenedMinapps: FC = () => {
  const { minappShow, openedKeepAliveMinapps, currentMinappId } = useRuntime()
  const { openMinappKeepAlive, hideMinappPopup, closeMinapp, closeAllMinapps } = useMinappPopup()
  const { showOpenedMinappsInSidebar } = useSettings()
  const { t } = useTranslation()

  const handleOnClick = (app) => {
    if (minappShow && currentMinappId === app.id) {
      hideMinappPopup()
    } else {
      openMinappKeepAlive(app)
    }
  }

  useEffect(() => {
    const iconDefaultHeight = 40
    const iconDefaultOffset = 17
    const container = document.querySelector('.TabsContainer') as HTMLElement
    const activeIcon = document.querySelector('.TabsContainer .opened-active') as HTMLElement

    let indicatorTop = 0,
      indicatorRight = 0
    if (minappShow && activeIcon && container) {
      indicatorTop = activeIcon.offsetTop + activeIcon.offsetHeight / 2 - 4
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

  const isShowOpened = showOpenedMinappsInSidebar && openedKeepAliveMinapps.length > 0

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
                onClick: () => closeMinapp(app.id)
              },
              {
                key: 'closeAllApp',
                label: t('minapp.sidebar.closeall.title'),
                onClick: () => closeAllMinapps()
              }
            ]

            return (
              <MainMenuItem key={app.id} onClick={() => handleOnClick(app)}>
                <MainMenuItemLeft>
                  <MainMenuItemIcon>
                    <MinAppIcon size={22} app={app} style={{ borderRadius: 6 }} sidebar />
                  </MainMenuItemIcon>
                  <MainMenuItemText>{app.name}</MainMenuItemText>
                </MainMenuItemLeft>
                <MainMenuItemRight style={{ marginRight: 4 }}>
                  <Dropdown menu={{ items: menuItems }} trigger={['contextMenu']} overlayStyle={{ zIndex: 10000 }}>
                    <IndicatorLight color="var(--color-primary)" shadow={false} animation={false} size={5} />
                  </Dropdown>
                </MainMenuItemRight>
              </MainMenuItem>
            )
          })}
          {isEmpty(openedKeepAliveMinapps) && (
            <Center>
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />
            </Center>
          )}
        </Menus>
      </TabsWrapper>
      <Divider />
    </TabsContainer>
  )
}

const Divider = styled.div`
  width: 100%;
  height: 1px;
  background-color: var(--color-border);
  margin: 5px 0;
  opacity: 0.5;
`

export default OpenedMinapps
