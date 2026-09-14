import type { WebviewTag } from 'electron'
import {
  ArrowLeft,
  ArrowRight,
  Code,
  Columns2,
  ExternalLink,
  Info,
  LayoutGrid,
  Link,
  RotateCcw,
  RotateCw,
  X
} from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Tooltip } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import MiniAppDetailPanel from '@renderer/components/MiniApp/MiniAppDetailPanel'
import { useMiniApps } from '@renderer/hooks/useMiniApps'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { isDev } from '@renderer/utils/platform'
import { isDataApiError, toDataApiError } from '@shared/data/api/errors'
import type { MiniApp } from '@shared/data/types/miniApp'

const logger = loggerService.withContext('MinimalToolbar')

const NAVIGATION_UPDATE_DELAY_MS = 50
const NAVIGATION_COMPLETE_DELAY_MS = 100

/** `open` splits the view in two; `close` is the split pane's way back to one. */
export type SplitMode = 'open' | 'close'

interface Props {
  app: MiniApp
  webview: WebviewTag | null
  currentUrl: string | null
  onReload: () => void
  onRestart: () => void
  onOpenDevTools: () => void
  splitMode: SplitMode
  /** Whether the view is currently split, so the control reads as engaged. */
  splitActive?: boolean
  onSplit: () => void
}

const MinimalToolbar: FC<Props> = ({
  app,
  webview,
  currentUrl,
  onReload,
  onRestart,
  onOpenDevTools,
  splitMode,
  splitActive = false,
  onSplit
}) => {
  const { t } = useTranslation()
  const { pinned, updateAppStatus, allApps } = useMiniApps()
  const [openLinkExternal, setOpenLinkExternal] = usePreference('feature.mini_app.open_link_external')
  const [canGoBack, setCanGoBack] = useState(false)
  const [canGoForward, setCanGoForward] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  // While split, the primary pane's control closes the split rather than being
  // a dead "open it again" button.
  const splitLabelKey = splitMode === 'close' || splitActive ? 'miniApp.split.close' : 'miniApp.split.open'
  const canPinned = allApps.some((item) => item.appId === app.appId)
  const isPinned = pinned.some((item) => item.appId === app.appId)
  const canOpenExternalLink = app.url.startsWith('http://') || app.url.startsWith('https://')

  // Ref to track navigation update timeout
  const navigationUpdateTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Update navigation state
  const updateNavigationState = useCallback(() => {
    if (webview) {
      try {
        setCanGoBack(webview.canGoBack())
        setCanGoForward(webview.canGoForward())
      } catch (error) {
        logger.debug('WebView not ready for navigation state update', { appId: app.appId })
        setCanGoBack(false)
        setCanGoForward(false)
      }
    } else {
      setCanGoBack(false)
      setCanGoForward(false)
    }
  }, [app.appId, webview])

  // Schedule navigation state update with debouncing
  const scheduleNavigationUpdate = useCallback(
    (delay: number) => {
      if (navigationUpdateTimeoutRef.current) {
        clearTimeout(navigationUpdateTimeoutRef.current)
      }
      navigationUpdateTimeoutRef.current = setTimeout(() => {
        updateNavigationState()
        navigationUpdateTimeoutRef.current = null
      }, delay)
    },
    [updateNavigationState]
  )

  // Navigation listeners belong to the attached guest, which restart replaces.
  useEffect(() => {
    updateNavigationState()
    if (!webview) return

    const handleNavigation = () => scheduleNavigationUpdate(NAVIGATION_UPDATE_DELAY_MS)
    webview.addEventListener('did-navigate', handleNavigation)
    webview.addEventListener('did-navigate-in-page', handleNavigation)

    return () => {
      webview.removeEventListener('did-navigate', handleNavigation)
      webview.removeEventListener('did-navigate-in-page', handleNavigation)
      if (navigationUpdateTimeoutRef.current) {
        clearTimeout(navigationUpdateTimeoutRef.current)
        navigationUpdateTimeoutRef.current = null
      }
    }
  }, [webview, updateNavigationState, scheduleNavigationUpdate])

  const handleGoBack = useCallback(() => {
    if (webview) {
      try {
        if (webview.canGoBack()) {
          webview.goBack()
          // Delay update to ensure navigation completes
          scheduleNavigationUpdate(NAVIGATION_COMPLETE_DELAY_MS)
        }
      } catch (error) {
        logger.debug('WebView not ready for navigation', { appId: app.appId, action: 'goBack' })
      }
    }
  }, [app.appId, webview, scheduleNavigationUpdate])

  const handleGoForward = useCallback(() => {
    if (webview) {
      try {
        if (webview.canGoForward()) {
          webview.goForward()
          // Delay update to ensure navigation completes
          scheduleNavigationUpdate(NAVIGATION_COMPLETE_DELAY_MS)
        }
      } catch (error) {
        logger.debug('WebView not ready for navigation', { appId: app.appId, action: 'goForward' })
      }
    }
  }, [app.appId, webview, scheduleNavigationUpdate])

  const handleTogglePin = useCallback(() => {
    const fallbackKey = isPinned ? 'miniApp.unpin_failed' : 'miniApp.pin_failed'
    updateAppStatus(app.appId, isPinned ? 'enabled' : 'pinned').catch((err) => {
      const e = toDataApiError(err)
      if (isDataApiError(e)) {
        logger.error('togglePin failed', { code: e.code, message: e.message })
        toast.error(e.message || t(fallbackKey))
      } else {
        logger.error('togglePin failed', err as Error)
        toast.error(t(fallbackKey))
      }
    })
  }, [app.appId, isPinned, updateAppStatus, t])

  const handleToggleOpenExternal = useCallback(() => {
    void setOpenLinkExternal(!openLinkExternal)
  }, [setOpenLinkExternal, openLinkExternal])

  const handleOpenLink = useCallback(() => {
    const urlToOpen = currentUrl || app.url
    void ipcApi.request('system.shell.open_website', urlToOpen)
  }, [currentUrl, app.url])

  return (
    <div className="flex h-8.75 shrink-0 items-center justify-between bg-background px-3">
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-0.5">
          <Tooltip content={t('miniApp.popup.goBack')} placement="bottom">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={handleGoBack}
              className={toolbarButtonClassName({ disabled: !canGoBack })}
              aria-label={t('miniApp.popup.goBack')}
              aria-disabled={!canGoBack}>
              <ArrowLeft size={14} />
            </Button>
          </Tooltip>

          <Tooltip content={t('miniApp.popup.goForward')} placement="bottom">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={handleGoForward}
              className={toolbarButtonClassName({ disabled: !canGoForward })}
              aria-label={t('miniApp.popup.goForward')}
              aria-disabled={!canGoForward}>
              <ArrowRight size={14} />
            </Button>
          </Tooltip>

          <Tooltip content={t('miniApp.popup.refresh')} placement="bottom">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={onReload}
              className={toolbarButtonClassName()}
              aria-label={t('miniApp.popup.refresh')}>
              <RotateCw size={14} />
            </Button>
          </Tooltip>

          <Tooltip content={t('miniApp.popup.restart')} placement="bottom">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={onRestart}
              className={toolbarButtonClassName()}
              aria-label={t('miniApp.popup.restart')}>
              <RotateCcw size={14} />
            </Button>
          </Tooltip>
        </div>
      </div>

      <div className="flex items-center">
        <div className="flex items-center gap-0.5">
          <Tooltip content={t(splitLabelKey)} placement="bottom">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={onSplit}
              className={toolbarButtonClassName({ active: splitActive })}
              aria-label={t(splitLabelKey)}
              aria-pressed={splitMode === 'open' ? splitActive : undefined}>
              {splitMode === 'open' ? <Columns2 size={14} /> : <X size={14} />}
            </Button>
          </Tooltip>

          {canOpenExternalLink && (
            <Tooltip content={t('miniApp.popup.openExternal')} placement="bottom">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={handleOpenLink}
                className={toolbarButtonClassName()}
                aria-label={t('miniApp.popup.openExternal')}>
                <ExternalLink size={14} />
              </Button>
            </Tooltip>
          )}

          {canPinned && (
            <Tooltip
              content={isPinned ? t('miniApp.remove_from_launchpad') : t('miniApp.add_to_launchpad')}
              placement="bottom">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={handleTogglePin}
                className={toolbarButtonClassName({ active: isPinned })}
                aria-label={isPinned ? t('miniApp.remove_from_launchpad') : t('miniApp.add_to_launchpad')}
                aria-pressed={isPinned}>
                <LayoutGrid size={14} />
              </Button>
            </Tooltip>
          )}

          {/* Sites only: a local app can open nothing outside itself, so the switch would lie. */}
          {app.kind === 'site' && (
            <Tooltip
              content={
                openLinkExternal ? t('miniApp.popup.open_link_external_on') : t('miniApp.popup.open_link_external_off')
              }
              placement="bottom">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={handleToggleOpenExternal}
                className={toolbarButtonClassName({ active: openLinkExternal })}
                aria-label={
                  openLinkExternal
                    ? t('miniApp.popup.open_link_external_on')
                    : t('miniApp.popup.open_link_external_off')
                }
                aria-pressed={openLinkExternal}>
                <Link size={14} />
              </Button>
            </Tooltip>
          )}

          {/* The same panel the launcher tile's context menu opens; sites have no package to describe. */}
          {app.kind === 'app' && (
            <Tooltip content={t('miniApp.detail.open')} placement="bottom">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => setDetailOpen(true)}
                className={toolbarButtonClassName()}
                aria-label={t('miniApp.detail.open')}>
                <Info size={14} />
              </Button>
            </Tooltip>
          )}

          {isDev && (
            <Tooltip content={t('miniApp.popup.devtools')} placement="bottom">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={onOpenDevTools}
                className={toolbarButtonClassName()}
                aria-label={t('miniApp.popup.devtools')}>
                <Code size={14} />
              </Button>
            </Tooltip>
          )}
        </div>
      </div>
      {detailOpen && <MiniAppDetailPanel appId={app.appId} onClose={() => setDetailOpen(false)} />}
    </div>
  )
}

const toolbarButtonClassName = ({ disabled = false, active = false }: { disabled?: boolean; active?: boolean } = {}) =>
  cn(
    'rounded shadow-none active:scale-95',
    disabled
      ? 'cursor-default text-foreground-disabled hover:bg-transparent hover:text-foreground-disabled active:scale-100'
      : active
        ? 'text-primary hover:text-primary'
        : 'text-muted-foreground hover:text-foreground'
  )

export default MinimalToolbar
