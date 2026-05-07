import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import MinAppIcon from '@renderer/components/Icons/MinAppIcon'
import IndicatorLight from '@renderer/components/IndicatorLight'
import MarqueeText from '@renderer/components/MarqueeText'
import { loadCustomMiniApp, ORIGIN_DEFAULT_MIN_APPS, updateAllMinApps } from '@renderer/config/minapps'
import { useMinappPopup } from '@renderer/hooks/useMinappPopup'
import { useMinapps } from '@renderer/hooks/useMinapps'
import { useNavbarPosition } from '@renderer/hooks/useNavbar'
import type { MinAppType } from '@renderer/types'
import { useNavigate } from '@tanstack/react-router'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
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
  const {
    minapps,
    pinned,
    disabled,
    openedKeepAliveMinapps,
    currentMinappId,
    minappShow,
    setOpenedKeepAliveMinapps,
    updateMinapps,
    updateDisabledMinapps,
    updatePinnedMinapps
  } = useMinapps()
  const navigate = useNavigate()
  const isPinned = pinned.some((p) => p.id === app.id)
  const isVisible = minapps.some((m) => m.id === app.id)
  // Pinned apps should always be visible regardless of region/locale filtering
  const shouldShow = isVisible || isPinned
  const isActive = minappShow && currentMinappId === app.id
  const isOpened = openedKeepAliveMinapps.some((item) => item.id === app.id)
  const { isTopNavbar } = useNavbarPosition()

  // Calculate display name
  const displayName = isLast ? t('settings.miniapps.custom.title') : app.nameKey ? t(app.nameKey) : app.name

  const handleClick = () => {
    if (isTopNavbar) {
      // 顶部导航栏：导航到小程序页面
      void navigate({ to: '/app/minapp/$appId', params: { appId: app.id } })
    } else {
      // 侧边导航栏：保持原有弹窗行为
      openMinappKeepAlive(app)
    }
    onClick?.()
  }

  const togglePinLabel = isPinned
    ? isTopNavbar
      ? t('minapp.remove_from_launchpad')
      : t('minapp.remove_from_sidebar')
    : isTopNavbar
      ? t('minapp.add_to_launchpad')
      : t('minapp.add_to_sidebar')

  const handleTogglePin = () => {
    const newPinned = isPinned ? pinned.filter((item) => item.id !== app.id) : [...pinned, app]
    updatePinnedMinapps(newPinned)
  }

  const handleHide = () => {
    const newMinapps = minapps.filter((item) => item.id !== app.id)
    updateMinapps(newMinapps)
    const newDisabled = [...(disabled || []), app]
    updateDisabledMinapps(newDisabled)
    updatePinnedMinapps(pinned.filter((item) => item.id !== app.id))
    const newOpenedKeepAliveMinapps = openedKeepAliveMinapps.filter((item) => item.id !== app.id)
    setOpenedKeepAliveMinapps(newOpenedKeepAliveMinapps)
  }

  const handleRemoveCustom = async () => {
    try {
      const content = await window.api.file.read('custom-minapps.json')
      const customApps = JSON.parse(content)
      const updatedApps = customApps.filter((customApp: MinAppType) => customApp.id !== app.id)
      await window.api.file.writeWithId('custom-minapps.json', JSON.stringify(updatedApps, null, 2))
      window.toast.success(t('settings.miniapps.custom.remove_success'))
      const reloadedApps = [...ORIGIN_DEFAULT_MIN_APPS, ...(await loadCustomMiniApp())]
      updateAllMinApps(reloadedApps)
      updateMinapps(minapps.filter((item) => item.id !== app.id))
      updatePinnedMinapps(pinned.filter((item) => item.id !== app.id))
      updateDisabledMinapps(disabled.filter((item) => item.id !== app.id))
    } catch (error) {
      window.toast.error(t('settings.miniapps.custom.remove_error'))
      logger.error('Failed to remove custom mini app:', error as Error)
    }
  }

  if (!shouldShow) {
    return null
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <Container onClick={handleClick}>
          <IconContainer>
            <MinAppIcon size={size} app={app} />
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
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={handleTogglePin}>{togglePinLabel}</ContextMenuItem>
        <ContextMenuItem onSelect={handleHide}>{t('minapp.sidebar.hide.title')}</ContextMenuItem>
        {app.type === 'Custom' && (
          <ContextMenuItem variant="destructive" onSelect={handleRemoveCustom}>
            {t('minapp.sidebar.remove_custom.title')}
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
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

export default MinApp
