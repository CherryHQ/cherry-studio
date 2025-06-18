import DragableList from '@renderer/components/DragableList'
import MinAppIcon from '@renderer/components/Icons/MinAppIcon'
import IndicatorLight from '@renderer/components/IndicatorLight'
import { Center } from '@renderer/components/Layout'
import { useMinappPopup } from '@renderer/hooks/useMinappPopup'
import { useMinapps } from '@renderer/hooks/useMinapps'
import { useRuntime } from '@renderer/hooks/useRuntime'
import { useSettings } from '@renderer/hooks/useSettings'
import type { MenuProps } from 'antd'
import { Empty } from 'antd'
import { Dropdown } from 'antd'
import { isEmpty } from 'lodash'
import { FC, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import {
  MainMenuItem,
  MainMenuItemIcon,
  MainMenuItemLeft,
  MainMenuItemRight,
  MainMenuItemText,
  TabsContainer,
  TabsWrapper
} from './MainSidebarStyles'

const OpenedMinapps: FC = () => {
  const { minappShow, openedKeepAliveMinapps, currentMinappId } = useRuntime()
  const { openMinappKeepAlive, hideMinappPopup, closeMinapp, closeAllMinapps } = useMinappPopup()
  const { showOpenedMinappsInSidebar } = useSettings()
  const { pinned, updatePinnedMinapps } = useMinapps()
  const { t } = useTranslation()

  // 合并并排序应用列表
  const sortedApps = useMemo(() => {
    // 分离已打开但未固定的应用
    const openedNotPinned = openedKeepAliveMinapps.filter((app) => !pinned.find((p) => p.id === app.id))

    // 获取固定应用列表(保持原有顺序)
    const pinnedApps = pinned.map((app) => {
      const openedApp = openedKeepAliveMinapps.find((o) => o.id === app.id)
      return openedApp || app
    })

    // 把已启动但未固定的放到列表下面
    return [...pinnedApps, ...openedNotPinned]
  }, [openedKeepAliveMinapps, pinned])

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

  const isShowApps = showOpenedMinappsInSidebar && sortedApps.length > 0

  if (!isShowApps) return <TabsContainer className="TabsContainer" />

  return (
    <TabsContainer className="TabsContainer" style={{ marginBottom: 4 }}>
      <Divider />
      <TabsWrapper>
        <DragableList
          list={sortedApps}
          onUpdate={(newList) => {
            // 只更新固定应用的顺序
            const newPinned = newList.filter((app) => pinned.find((p) => p.id === app.id))
            updatePinnedMinapps(newPinned)
          }}
          listStyle={{ margin: '4px 0' }}>
          {(app) => {
            const isPinned = pinned.find((p) => p.id === app.id)
            const isOpened = openedKeepAliveMinapps.find((o) => o.id === app.id)

            const menuItems: MenuProps['items'] = [
              {
                key: 'togglePin',
                label: isPinned ? t('minapp.sidebar.remove.title') : t('minapp.sidebar.pin.title'),
                onClick: () => {
                  if (isPinned) {
                    const newPinned = pinned.filter((item) => item.id !== app.id)
                    updatePinnedMinapps(newPinned)
                  } else {
                    updatePinnedMinapps([...pinned, app])
                  }
                }
              }
            ]

            if (isOpened) {
              menuItems.push(
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
              )
            }

            return (
              <Dropdown menu={{ items: menuItems }} trigger={['contextMenu']} overlayStyle={{ zIndex: 10000 }}>
                <MainMenuItem key={app.id} onClick={() => handleOnClick(app)}>
                  <MainMenuItemLeft>
                    <MainMenuItemIcon>
                      <MinAppIcon size={22} app={app} style={{ borderRadius: 6 }} sidebar />
                    </MainMenuItemIcon>
                    <MainMenuItemText>{app.name}</MainMenuItemText>
                  </MainMenuItemLeft>
                  {isOpened && (
                    <MainMenuItemRight style={{ marginRight: 4 }}>
                      <IndicatorLight color="var(--color-primary)" shadow={false} animation={false} size={5} />
                    </MainMenuItemRight>
                  )}
                </MainMenuItem>
              </Dropdown>
            )
          }}
        </DragableList>
        {isEmpty(sortedApps) && (
          <Center>
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />
          </Center>
        )}
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
