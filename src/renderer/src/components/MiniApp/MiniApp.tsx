import { loggerService } from '@logger'
import MiniAppIcon from '@renderer/components/Icons/MiniAppIcon'
import IndicatorLight from '@renderer/components/IndicatorLight'
import MarqueeText from '@renderer/components/MarqueeText'
import { useMiniApps } from '@renderer/hooks/useMiniApps'
import { useNavbarPosition } from '@renderer/hooks/useNavbar'
import { useTabs } from '@renderer/hooks/useTabs'
import { ErrorCode, isDataApiError } from '@shared/data/api'
import type { MiniApp } from '@shared/data/types/miniApp'
import type { MenuProps } from 'antd'
import { Dropdown } from 'antd'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface Props {
  app: MiniApp
  onClick?: () => void
  size?: number
  isLast?: boolean
}

const logger = loggerService.withContext('App')

const MiniApp: FC<Props> = ({ app, onClick, size = 60, isLast }) => {
  const { t } = useTranslation()
  const {
    miniapps,
    pinned,
    disabled,
    openedKeepAliveMiniApps,
    currentMiniAppId,
    miniAppShow,
    setOpenedKeepAliveMiniApps,
    updateMiniApps,
    updateDisabledMiniApps,
    updatePinnedMiniApps,
    removeCustomMiniApp
  } = useMiniApps()
  const { openTab } = useTabs()
  const isPinned = pinned.some((p) => p.appId === app.appId)
  const isVisible = miniapps.some((m) => m.appId === app.appId)
  // Pinned apps should always be visible regardless of region/locale filtering
  const shouldShow = isVisible || isPinned
  const isActive = miniAppShow && currentMiniAppId === app.appId
  const isOpened = openedKeepAliveMiniApps.some((item) => item.appId === app.appId)
  const { isTopNavbar } = useNavbarPosition()

  // Calculate display name
  const displayName = isLast ? t('settings.miniapps.custom.title') : app.nameKey ? t(app.nameKey) : app.name

  const handleClick = () => {
    openTab(`/app/mini-app/${app.appId}`, { title: displayName, icon: app.logo })
    onClick?.()
  }

  const menuItems: MenuProps['items'] = [
    {
      key: 'togglePin',
      label: isPinned
        ? isTopNavbar
          ? t('miniapp.remove_from_launchpad')
          : t('miniapp.remove_from_sidebar')
        : isTopNavbar
          ? t('miniapp.add_to_launchpad')
          : t('miniapp.add_to_sidebar'),
      onClick: () => {
        const newPinned = isPinned ? pinned.filter((item) => item.appId !== app.appId) : [...pinned, app]
        void updatePinnedMiniApps(newPinned).catch((error: unknown) => {
          if (isDataApiError(error)) {
            logger.error('Failed to update pinned apps', { code: error.code, message: error.message })
          } else {
            logger.error('Failed to update pinned apps', error as Error)
          }
        })
      }
    },
    ...(!isPinned
      ? [
          {
            key: 'hide',
            label: t('miniapp.sidebar.hide.title'),
            onClick: () => {
              const newMiniApps = miniapps.filter((item) => item.appId !== app.appId)
              void updateMiniApps(newMiniApps).catch((error: unknown) => {
                if (isDataApiError(error)) {
                  logger.error('Failed to update mini apps', { code: error.code, message: error.message })
                } else {
                  logger.error('Failed to update mini apps', error as Error)
                }
              })
              const newDisabled = [...(disabled || []), app]
              void updateDisabledMiniApps(newDisabled).catch((error: unknown) => {
                if (isDataApiError(error)) {
                  logger.error('Failed to update disabled apps', { code: error.code, message: error.message })
                } else {
                  logger.error('Failed to update disabled apps', error as Error)
                }
              })
              // Update openedKeepAliveMiniApps
              const newOpenedKeepAliveMiniApps = openedKeepAliveMiniApps.filter((item) => item.appId !== app.appId)
              setOpenedKeepAliveMiniApps(newOpenedKeepAliveMiniApps)
            }
          }
        ]
      : []),
    ...(app.presetMiniappId == null
      ? [
          {
            key: 'removeCustom',
            label: t('miniapp.sidebar.remove_custom.title'),
            danger: true,
            onClick: async () => {
              try {
                await removeCustomMiniApp(app.appId)
                window.toast.success(t('settings.miniapps.custom.remove_success'))
              } catch (error) {
                if (isDataApiError(error)) {
                  if (error.code === ErrorCode.NOT_FOUND) {
                    window.toast.warning(t('miniapp.not_found'))
                  } else if (!error.isRetryable) {
                    window.toast.error(t('settings.miniapps.custom.remove_error'))
                  } else {
                    window.toast.error(t('settings.miniapps.custom.remove_error'))
                  }
                } else {
                  window.toast.error(t('settings.miniapps.custom.remove_error'))
                }
                logger.error('Failed to remove custom mini app:', error as Error)
              }
            }
          }
        ]
      : [])
  ]

  if (!shouldShow) {
    return null
  }

  return (
    <Dropdown menu={{ items: menuItems }} trigger={['contextMenu']}>
      <Container onClick={handleClick}>
        <IconContainer>
          <MiniAppIcon size={size} app={app} />
          {isOpened && (
            <StyledIndicator>
              <IndicatorLight color="#22c55e" size={6} animation={!isActive} />
            </StyledIndicator>
          )}
        </IconContainer>
        <AppTitle>
          <MarqueeText>{displayName}</MarqueeText>
        </AppTitle>
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
  min-height: 85px;
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
  width: 100%;
  max-width: 80px;
`

export default MiniApp
