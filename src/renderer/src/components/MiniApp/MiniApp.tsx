import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@cherrystudio/ui'
import { loggerService } from '@logger'
import MiniAppIcon from '@renderer/components/Icons/MiniAppIcon'
import IndicatorLight from '@renderer/components/IndicatorLight'
import MarqueeText from '@renderer/components/MarqueeText'
import { useMiniApps } from '@renderer/hooks/useMiniApps'
import { useNavbarPosition } from '@renderer/hooks/useNavbar'
import { useTabs } from '@renderer/hooks/useTabs'
import { ErrorCode, isDataApiError, toDataApiError } from '@shared/data/api'
import type { MiniApp } from '@shared/data/types/miniApp'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

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

  const handleTogglePin = () => {
    const nextStatus = isPinned ? 'enabled' : 'pinned'
    updateAppStatus(app.appId, nextStatus).catch(
      reportFailure(isPinned ? 'miniApp.unpin_failed' : 'miniApp.pin_failed')
    )
  }

  const handleHide = () => {
    updateAppStatus(app.appId, 'disabled')
      .then(() => {
        setOpenedKeepAliveMiniApps(openedKeepAliveMiniApps.filter((item) => item.appId !== app.appId))
      })
      .catch(reportFailure('miniApp.hide_failed'))
  }

  const handleRemoveCustom = async () => {
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

  if (!shouldShow) {
    return null
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          onClick={handleClick}
          className="flex min-h-21.25 cursor-pointer flex-col items-center justify-center overflow-hidden">
          <div className="relative flex items-center justify-center">
            <MiniAppIcon size={size} app={app} />
            {isOpened && (
              <div className="-right-0.5 -bottom-0.5 absolute rounded-full bg-background p-0.5">
                <IndicatorLight color="#22c55e" size={6} animation={!isActive} />
              </div>
            )}
          </div>
          <div className="mt-1.25 w-full max-w-20 select-none text-center text-text-soft text-xs">
            <MarqueeText>{displayName}</MarqueeText>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={handleTogglePin}>
          {isPinned
            ? isTopNavbar
              ? t('miniApp.remove_from_launchpad')
              : t('miniApp.remove_from_sidebar')
            : isTopNavbar
              ? t('miniApp.add_to_launchpad')
              : t('miniApp.add_to_sidebar')}
        </ContextMenuItem>
        {!isPinned && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={handleHide}>{t('miniApp.sidebar.hide.title')}</ContextMenuItem>
          </>
        )}
        {app.presetMiniAppId == null && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem variant="destructive" onSelect={handleRemoveCustom}>
              {t('miniApp.sidebar.remove_custom.title')}
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}

export default MiniApp
