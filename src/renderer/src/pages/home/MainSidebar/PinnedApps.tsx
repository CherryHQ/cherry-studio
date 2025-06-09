import DragableList from '@renderer/components/DragableList'
import MinAppIcon from '@renderer/components/Icons/MinAppIcon'
import { useMinappPopup } from '@renderer/hooks/useMinappPopup'
import { useMinapps } from '@renderer/hooks/useMinapps'
import { useRuntime } from '@renderer/hooks/useRuntime'
import type { MenuProps } from 'antd'
import { Dropdown } from 'antd'
import { isEmpty } from 'lodash'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { MainMenuItem, MainMenuItemIcon, MainMenuItemLeft, MainMenuItemText } from './MainSidebarStyles'

const PinnedApps: FC = () => {
  const { pinned, updatePinnedMinapps } = useMinapps()
  const { t } = useTranslation()
  const { openMinappKeepAlive } = useMinappPopup()
  const { openedKeepAliveMinapps } = useRuntime()

  if (isEmpty(pinned)) {
    return null
  }

  return (
    <div style={{ marginBottom: -10 }}>
      <Divider style={{ marginBottom: 5, marginTop: 5 }} />
      <DragableList list={pinned} onUpdate={updatePinnedMinapps} listStyle={{ margin: '5px 0', marginBottom: 0 }}>
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

          return (
            <Dropdown menu={{ items: menuItems }} trigger={['contextMenu']} overlayStyle={{ zIndex: 10000 }}>
              <MainMenuItem key={app.id} onClick={() => openMinappKeepAlive(app)}>
                <MainMenuItemLeft>
                  <MainMenuItemIcon>
                    <MinAppIcon size={22} app={app} style={{ borderRadius: 6 }} sidebar />
                  </MainMenuItemIcon>
                  <MainMenuItemText>{app.name}</MainMenuItemText>
                </MainMenuItemLeft>
              </MainMenuItem>
            </Dropdown>
          )
        }}
      </DragableList>
      {isEmpty(openedKeepAliveMinapps) && <Divider style={{ marginBottom: 5, marginTop: 5 }} />}
    </div>
  )
}

const Divider = styled.div`
  width: 100%;
  height: 1px;
  background-color: var(--color-border);
  opacity: 0.5;
`

export default PinnedApps
