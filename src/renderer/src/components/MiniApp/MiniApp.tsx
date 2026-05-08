import { loggerService } from '@logger'
import MiniAppIcon from '@renderer/components/Icons/MiniAppIcon'
import IndicatorLight from '@renderer/components/IndicatorLight'
import MarqueeText from '@renderer/components/MarqueeText'
import { useMiniApps } from '@renderer/hooks/useMiniApps'
import { useNavbarPosition } from '@renderer/hooks/useNavbar'
import { useTabs } from '@renderer/hooks/useTabs'
import { ErrorCode, isDataApiError, toDataApiError } from '@shared/data/api'
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
    miniApps,
    pinned,
    openedKeepAliveMiniApps,
    currentMiniAppId,
    miniAppShow,
    setOpenedKeepAliveMiniApps,
    updateAppStatus,
    removeCustomMiniApp
  } = useMiniApps()
  const { openTab } = useTabs()
  const isPinned = pinned.some((p) => p.appId === app.appId)
  const isVisible = miniApps.some((m) => m.appId === app.appId)
  // Pinned apps should always be visible regardless of region/locale filtering
  const shouldShow = isVisible || isPinned
  const isActive = miniAppShow && currentMiniAppId === app.appId
  const isOpened = openedKeepAliveMiniApps.some((item) => item.appId === app.appId)
  const { isTopNavbar } = useNavbarPosition()

  // Calculate display name
  const displayName = isLast ? t('settings.miniApps.custom.title') : app.nameKey ? t(app.nameKey) : app.name

  const handleClick = () => {
    openTab(`/app/mini-app/${app.appId}`, { title: displayName, icon: app.logo })
    onClick?.()
  }

  const reportFailure = (fallbackKey: string) => (err: unknown) => {
    const e = toDataApiError(err)
    if (isDataApiError(e)) {
      logger.error('mutation failed', { code: e.code, message: e.message })
      window.toast?.error?.(e.message || t(fallbackKey))
    } else {
      logger.error('mutation failed', err as Error)
      window.toast?.error?.(t(fallbackKey))
    }
  }

  const menuItems: MenuProps['items'] = [
    {
      key: 'togglePin',
      label: isPinned
        ? isTopNavbar
          ? t('miniApp.remove_from_launchpad')
          : t('miniApp.remove_from_sidebar')
        : isTopNavbar
          ? t('miniApp.add_to_launchpad')
          : t('miniApp.add_to_sidebar'),
      onClick: () => {
        // Toggle pin: enabled ↔ pinned. Custom apps that were technically
        // 'disabled' (shouldn't normally end up in the grid) fall back to
        // 'enabled' on unpin, matching the previous diff behavior.
        const nextStatus = isPinned ? 'enabled' : 'pinned'
        updateAppStatus(app.appId, nextStatus).catch(
          reportFailure(isPinned ? 'miniApp.unpin_failed' : 'miniApp.pin_failed')
        )
      }
    },
    ...(!isPinned
      ? [
          {
            key: 'hide',
            label: t('miniApp.sidebar.hide.title'),
            onClick: () => {
              // Wait for the status flip to land before evicting from the
              // keep-alive pool — otherwise a failed PATCH leaves the user
              // with a still-disabled tab in the strip and no UI feedback.
              updateAppStatus(app.appId, 'disabled')
                .then(() => {
                  setOpenedKeepAliveMiniApps(openedKeepAliveMiniApps.filter((item) => item.appId !== app.appId))
                })
                .catch(reportFailure('miniApp.hide_failed'))
            }
          }
        ]
      : []),
    ...(app.presetMiniAppId == null
      ? [
          {
            key: 'removeCustom',
            label: t('miniApp.sidebar.remove_custom.title'),
            danger: true,
            onClick: async () => {
              try {
                await removeCustomMiniApp(app.appId)
                window.toast.success(t('settings.miniApps.custom.remove_success'))
              } catch (error) {
                if (isDataApiError(error)) {
                  if (error.code === ErrorCode.NOT_FOUND) {
                    window.toast.warning(t('miniApp.error.not_found'))
                  } else if (!error.isRetryable) {
                    window.toast.error(t('settings.miniApps.custom.remove_error'))
                  } else {
                    window.toast.error(t('settings.miniApps.custom.remove_error'))
                  }
                } else {
                  window.toast.error(t('settings.miniApps.custom.remove_error'))
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
