import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import MiniAppIcon from '@renderer/components/Icons/MiniAppIcon'
import IndicatorLight from '@renderer/components/IndicatorLight'
import MarqueeText from '@renderer/components/MarqueeText'
import { useMiniApps } from '@renderer/hooks/useMiniApps'
import { useNavbarPosition } from '@renderer/hooks/useNavbar'
import { useTabs } from '@renderer/hooks/useTabs'
import { ErrorCode, isDataApiError, toDataApiError } from '@shared/data/api'
import type { MiniApp } from '@shared/data/types/miniApp'
import type { FC, KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface Props {
  app: MiniApp
  onClick?: () => void
  size?: number
  isLast?: boolean
  variant?: 'default' | 'launchpad'
}

const logger = loggerService.withContext('App')

const MiniApp: FC<Props> = ({ app, onClick, size = 60, isLast, variant = 'default' }) => {
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

  const togglePinLabel = isPinned
    ? isTopNavbar
      ? t('miniApp.remove_from_launchpad')
      : t('miniApp.remove_from_sidebar')
    : isTopNavbar
      ? t('miniApp.add_to_launchpad')
      : t('miniApp.add_to_sidebar')

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

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <Container $variant={variant} onClick={handleClick} {...activationProps}>
          <IconContainer className="mini-app-icon-frame" $variant={variant}>
            <MiniAppIcon size={size} app={app} appearance={variant === 'launchpad' ? 'plain' : 'avatar'} />
            {isOpened && (
              <StyledIndicator $variant={variant}>
                <IndicatorLight color="#22c55e" size={6} animation={!isActive} />
              </StyledIndicator>
            )}
          </IconContainer>
          <AppTitle $variant={variant}>
            {variant === 'launchpad' ? displayName : <MarqueeText>{displayName}</MarqueeText>}
          </AppTitle>
        </Container>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={handleTogglePin}>{togglePinLabel}</ContextMenuItem>
        {!isPinned && <ContextMenuItem onSelect={handleHide}>{t('miniApp.sidebar.hide.title')}</ContextMenuItem>}
        {app.presetMiniAppId == null && (
          <ContextMenuItem variant="destructive" onSelect={handleRemoveCustom}>
            {t('miniApp.sidebar.remove_custom.title')}
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}

const Container = styled.div<{ $variant: 'default' | 'launchpad' }>`
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  cursor: pointer;
  overflow: hidden;
  min-height: ${({ $variant }) => ($variant === 'launchpad' ? '104px' : '85px')};
  outline: none;

  ${({ $variant }) =>
    $variant === 'launchpad'
      ? `
        width: 92px;
        padding: 4px 0 0;
        background: transparent;

        &:hover .mini-app-icon-frame {
          background: var(--color-ghost-hover);
        }

        &:focus-visible .mini-app-icon-frame {
          border-color: var(--color-border-active);
          box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-ring) 30%, transparent);
        }
      `
      : ''}
`

const IconContainer = styled.div<{ $variant: 'default' | 'launchpad' }>`
  position: relative;
  display: flex;
  justify-content: center;
  align-items: center;

  ${({ $variant }) =>
    $variant === 'launchpad'
      ? `
        width: 58px;
        height: 58px;
        border-radius: 14px;
        border: 1px solid var(--color-border-subtle);
        background: transparent;
        transition: border-color 160ms ease, background-color 160ms ease;

        @media (prefers-reduced-motion: reduce) {
          transition: none;
        }
      `
      : ''}
`

const StyledIndicator = styled.div<{ $variant: 'default' | 'launchpad' }>`
  position: absolute;
  right: ${({ $variant }) => ($variant === 'launchpad' ? '-3px' : '-2px')};
  bottom: ${({ $variant }) => ($variant === 'launchpad' ? '-3px' : '-2px')};
  padding: ${({ $variant }) => ($variant === 'launchpad' ? '3px' : '2px')};
  background: var(--color-background);
  border-radius: 50%;
  box-shadow: ${({ $variant }) => ($variant === 'launchpad' ? '0 0 0 1px var(--color-border-subtle)' : 'none')};
`

const AppTitle = styled.div<{ $variant: 'default' | 'launchpad' }>`
  font-size: ${({ $variant }) => ($variant === 'launchpad' ? '13px' : '12px')};
  margin-top: ${({ $variant }) => ($variant === 'launchpad' ? '8px' : '5px')};
  color: var(--color-foreground-secondary);
  width: 100%;
  max-width: ${({ $variant }) => ($variant === 'launchpad' ? '92px' : '80px')};
  line-height: ${({ $variant }) => ($variant === 'launchpad' ? '18px' : 'normal')};
  text-align: center;
  user-select: none;

  ${({ $variant }) =>
    $variant === 'launchpad'
      ? `
        min-height: 36px;
        overflow: hidden;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        white-space: normal;
        overflow-wrap: anywhere;
      `
      : ''}
`

export default MiniApp
