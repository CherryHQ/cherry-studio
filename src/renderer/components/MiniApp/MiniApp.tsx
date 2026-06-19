import { cn } from '@cherrystudio/ui/lib/utils'
import { loggerService } from '@logger'
import { CommandContextMenu, type CommandContextMenuExtraItem } from '@renderer/components/command'
import MiniAppIcon from '@renderer/components/Icons/MiniAppIcon'
import IndicatorLight from '@renderer/components/IndicatorLight'
import MarqueeText from '@renderer/components/MarqueeText'
import { useMiniApps } from '@renderer/hooks/useMiniApps'
import { useTabs } from '@renderer/hooks/useTabs'
import { ErrorCode, isDataApiError, toDataApiError } from '@shared/data/api'
import type { MiniApp } from '@shared/data/types/miniApp'
import type { FC, KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  app: MiniApp
  onClick?: () => void
  onOpen?: (app: MiniApp, displayName: string) => void
  size?: number
  isLast?: boolean
  variant?: 'default' | 'launchpad'
}

const logger = loggerService.withContext('App')

const MiniApp: FC<Props> = ({ app, onClick, onOpen, size = 60, isLast, variant = 'default' }) => {
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

  // Calculate display name
  const displayName = isLast ? t('settings.miniApps.custom.title') : app.nameKey ? t(app.nameKey) : app.name

  const handleClick = () => {
    if (onOpen) {
      onOpen(app, displayName)
    } else {
      openTab(`/app/mini-app/${app.appId}`, { title: displayName, icon: app.logo })
    }
    onClick?.()
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    handleClick()
  }
  const activationProps =
    variant === 'launchpad'
      ? ({
          onKeyDown: handleKeyDown,
          tabIndex: 0,
          role: 'button',
          'aria-label': displayName
        } as const)
      : {}

  const reportFailure = (fallbackKey: string) => (err: unknown) => {
    const e = toDataApiError(err)
    if (isDataApiError(e)) {
      logger.error('mutation failed', { code: e.code, message: e.message })
      window.toast.error(e.message || t(fallbackKey))
    } else {
      logger.error('mutation failed', err as Error)
      window.toast.error(t(fallbackKey))
    }
  }

  const togglePinLabel = isPinned ? t('miniApp.remove_from_launchpad') : t('miniApp.add_to_launchpad')

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
      if (isDataApiError(error) && error.code === ErrorCode.NOT_FOUND) {
        window.toast.warning(t('miniApp.error.not_found'))
      } else {
        window.toast.error(t('settings.miniApps.custom.remove_error'))
      }
      logger.error('Failed to remove custom mini app:', error as Error)
    }
  }

  if (!shouldShow) {
    return null
  }

  const isLaunchpad = variant === 'launchpad'

  const contextMenuItems: CommandContextMenuExtraItem[] = [
    { type: 'item', id: 'mini-app.toggle-pin', label: togglePinLabel, onSelect: handleTogglePin },
    ...(!isPinned
      ? ([
          { type: 'item', id: 'mini-app.hide', label: t('miniApp.sidebar.hide.title'), onSelect: handleHide }
        ] satisfies CommandContextMenuExtraItem[])
      : []),
    ...(app.presetMiniAppId == null
      ? ([
          {
            type: 'item',
            id: 'mini-app.remove-custom',
            label: t('miniApp.sidebar.remove_custom.title'),
            destructive: true,
            onSelect: handleRemoveCustom
          }
        ] satisfies CommandContextMenuExtraItem[])
      : [])
  ]

  return (
    <CommandContextMenu location="webcontents.context" extraItems={contextMenuItems}>
      <div
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center overflow-hidden outline-none',
          isLaunchpad
            ? 'min-h-[104px] w-[92px] bg-transparent pt-1 hover:[&_.mini-app-icon-frame]:bg-ghost-hover focus-visible:[&_.mini-app-icon-frame]:border-border-active focus-visible:[&_.mini-app-icon-frame]:shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-ring)_30%,transparent)]'
            : 'min-h-[85px]'
        )}
        onClick={handleClick}
        {...activationProps}>
        <div
          className={cn(
            'mini-app-icon-frame relative flex items-center justify-center',
            isLaunchpad &&
              'size-[58px] rounded-[14px] border border-border-subtle bg-transparent transition-[border-color,background-color] duration-[160ms] ease-in-out motion-reduce:transition-none'
          )}>
          <MiniAppIcon size={size} app={app} appearance={isLaunchpad ? 'plain' : 'avatar'} />
          {isOpened && (
            <div
              className={cn(
                'absolute rounded-full bg-background',
                isLaunchpad
                  ? '-right-[3px] -bottom-[3px] p-[3px] shadow-[0_0_0_1px_var(--color-border-subtle)]'
                  : '-right-0.5 -bottom-0.5 p-0.5'
              )}>
              <IndicatorLight color="#22c55e" size={6} animation={!isActive} />
            </div>
          )}
        </div>
        <div
          className={cn(
            'w-full select-none text-center text-foreground-secondary',
            isLaunchpad
              ? 'mt-2 min-h-9 max-w-[92px] overflow-hidden whitespace-normal text-[13px] leading-[18px] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] [display:-webkit-box] [overflow-wrap:anywhere]'
              : 'mt-[5px] max-w-20 text-xs leading-normal'
          )}>
          {isLaunchpad ? displayName : <MarqueeText>{displayName}</MarqueeText>}
        </div>
      </div>
    </CommandContextMenu>
  )
}

export default MiniApp
