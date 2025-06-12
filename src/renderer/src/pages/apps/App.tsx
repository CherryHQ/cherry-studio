import MinAppIcon from '@renderer/components/Icons/MinAppIcon'
import { loadCustomMiniApp, ORIGIN_DEFAULT_MIN_APPS, updateDefaultMinApps } from '@renderer/config/minapps'
import { useMinappPopup } from '@renderer/hooks/useMinappPopup'
import { useMinapps } from '@renderer/hooks/useMinapps'
import { MinAppType } from '@renderer/types'
import type { MenuProps } from 'antd'
import { Dropdown, message } from 'antd'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface Props {
  app: MinAppType
  onClick?: () => void
  size?: number
  isLast?: boolean
}

const App: FC<Props> = ({ app, onClick, size = 60, isLast }) => {
  const { openMinappKeepAlive } = useMinappPopup()
  const { t } = useTranslation()
  const { minapps, pinned, disabled, updateMinapps, updateDisabledMinapps, updatePinnedMinapps } = useMinapps()
  const isPinned = pinned.some((p) => p.id === app.id)
  const isVisible = minapps.some((m) => m.id === app.id)

  const handleClick = () => {
    openMinappKeepAlive(app)
    onClick?.()
  }

  const menuItems: MenuProps['items'] = [
    {
      key: 'togglePin',
      label: isPinned ? t('minapp.sidebar.remove.title') : t('minapp.sidebar.add.title'),
      onClick: () => {
        const newPinned = isPinned ? pinned.filter((item) => item.id !== app.id) : [...(pinned || []), app]
        updatePinnedMinapps(newPinned)
      }
    },
    {
      key: 'hide',
      label: t('minapp.sidebar.hide.title'),
      onClick: () => {
        const newMinapps = minapps.filter((item) => item.id !== app.id)
        updateMinapps(newMinapps)
        const newDisabled = [...(disabled || []), app]
        updateDisabledMinapps(newDisabled)
        const newPinned = pinned.filter((item) => item.id !== app.id)
        updatePinnedMinapps(newPinned)
      }
    },
    ...(app.type === 'Custom'
      ? [
          {
            key: 'removeCustom',
            label: t('minapp.sidebar.remove_custom.title'),
            danger: true,
            onClick: async () => {
              try {
                const content = await window.api.file.read('custom-minapps.json')
                const customApps = JSON.parse(content)
                const updatedApps = customApps.filter((customApp: MinAppType) => customApp.id !== app.id)
                await window.api.file.writeWithId('custom-minapps.json', JSON.stringify(updatedApps, null, 2))
                message.success(t('settings.miniapps.custom.remove_success'))
                const reloadedApps = [...ORIGIN_DEFAULT_MIN_APPS, ...(await loadCustomMiniApp())]
                updateDefaultMinApps(reloadedApps)
                updateMinapps(minapps.filter((item) => item.id !== app.id))
                updatePinnedMinapps(pinned.filter((item) => item.id !== app.id))
                updateDisabledMinapps(disabled.filter((item) => item.id !== app.id))
              } catch (error) {
                message.error(t('settings.miniapps.custom.remove_error'))
                console.error('Failed to remove custom mini app:', error)
              }
            }
          }
        ]
      : [])
  ]

  if (!isVisible) {
    return null
  }

  return (
    <Dropdown menu={{ items: menuItems }} trigger={['contextMenu']}>
      <Container onClick={handleClick}>
        <MinAppIcon size={size} app={app} />
        <AppTitle>{isLast ? t('settings.miniapps.custom.title') : app.name}</AppTitle>
      </Container>
    </Dropdown>
  )
}

const Container = styled.div`
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  cursor: pointer;
  overflow: hidden;
`

const AppTitle = styled.div`
  font-size: 12px;
  margin-top: 5px;
  color: var(--color-text-soft);
  text-align: center;
  user-select: none;
  white-space: nowrap;
`

export default App
