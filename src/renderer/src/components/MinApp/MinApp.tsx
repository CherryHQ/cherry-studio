import { loggerService } from '@logger'
import MinAppIcon from '@renderer/components/Icons/MinAppIcon'
import IndicatorLight from '@renderer/components/IndicatorLight'
import { loadCustomMiniApp, ORIGIN_DEFAULT_MIN_APPS, updateDefaultMinApps } from '@renderer/config/minapps'
import { useMinappPopup } from '@renderer/hooks/useMinappPopup'
import { useMinapps } from '@renderer/hooks/useMinapps'
import { useRuntime } from '@renderer/hooks/useRuntime'
import { useNavbarPosition } from '@renderer/hooks/useSettings'
import { setOpenedKeepAliveMinapps } from '@renderer/store/runtime'
import { MinAppType } from '@renderer/types'
import type { MenuProps } from 'antd'
import { Dropdown } from 'antd'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { useDispatch } from 'react-redux'
import styled from 'styled-components'

interface Props {
  app: MinAppType
  onClick?: () => void
  size?: number
  isLast?: boolean
}

const logger = loggerService.withContext('App')

const MinApp: FC<Props> = ({ app, onClick, size = 60, isLast }) => {
  const { openMinappKeepAlive } = useMinappPopup()
  const { t } = useTranslation()
  const { minapps, pinned, disabled, updateMinapps, updateDisabledMinapps, updatePinnedMinapps } = useMinapps()
  const { openedKeepAliveMinapps, currentMinappId, minappShow } = useRuntime()
  const dispatch = useDispatch()
  const isPinned = pinned.some((p) => p.id === app.id)
  const isVisible = minapps.some((m) => m.id === app.id)
  const isActive = minappShow && currentMinappId === app.id
  const isOpened = openedKeepAliveMinapps.some((item) => item.id === app.id)
  const { isTopNavbar } = useNavbarPosition()

  const handleClick = () => {
    openMinappKeepAlive(app)
    onClick?.()
  }

  const menuItems: MenuProps['items'] = [
    {
      key: 'togglePin',
      label: isPinned
        ? isTopNavbar
          ? t('minapp.remove_from_launchpad')
          : t('minapp.remove_from_sidebar')
        : isTopNavbar
          ? t('minapp.add_to_launchpad')
          : t('minapp.add_to_sidebar'),
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
        // 更新 openedKeepAliveMinapps
        const newOpenedKeepAliveMinapps = openedKeepAliveMinapps.filter((item) => item.id !== app.id)
        dispatch(setOpenedKeepAliveMinapps(newOpenedKeepAliveMinapps))
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
                window.message.success(t('settings.miniapps.custom.remove_success'))
                const reloadedApps = [...ORIGIN_DEFAULT_MIN_APPS, ...(await loadCustomMiniApp())]
                updateDefaultMinApps(reloadedApps)
                updateMinapps(minapps.filter((item) => item.id !== app.id))
                updatePinnedMinapps(pinned.filter((item) => item.id !== app.id))
                updateDisabledMinapps(disabled.filter((item) => item.id !== app.id))
              } catch (error) {
                window.message.error(t('settings.miniapps.custom.remove_error'))
                logger.error('Failed to remove custom mini app:', error as Error)
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
        <IconContainer>
          <MinAppIcon size={size} app={app} />
          {isOpened && (
            <StyledIndicator>
              <IndicatorLight color="#22c55e" size={6} animation={!isActive} />
            </StyledIndicator>
          )}
        </IconContainer>
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

const IconContainer = styled.div`
  position: relative;
  display: flex;
  justify-content: center;
  align-items: center;
`

const StyledIndicator = styled.div`
  position: absolute;
  bottom: -2px;
  right: -2px;
  padding: 2px;
  background: var(--color-background);
  border-radius: 50%;
`

const AppTitle = styled.div`
  font-size: 12px;
  margin-top: 5px;
  color: var(--color-text-soft);
  text-align: center;
  user-select: none;
  white-space: nowrap;
`

export default MinApp
