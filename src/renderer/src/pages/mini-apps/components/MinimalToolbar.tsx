import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  CodeOutlined,
  ExportOutlined,
  LinkOutlined,
  PushpinOutlined,
  ReloadOutlined
} from '@ant-design/icons'
import { Button, Tooltip } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { isDev } from '@renderer/config/constant'
import { useMiniApps } from '@renderer/hooks/useMiniApps'
import { isDataApiError, toDataApiError } from '@shared/data/api'
import type { MiniApp } from '@shared/data/types/miniApp'
import type { WebviewTag } from 'electron'
import type { FC } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('MinimalToolbar')

// Constants for timing delays
const WEBVIEW_CHECK_INITIAL_MS = 100 // Initial check interval
const WEBVIEW_CHECK_MAX_MS = 1000 // Maximum check interval (1 second)
const WEBVIEW_CHECK_MULTIPLIER = 2 // Exponential backoff multiplier
const WEBVIEW_CHECK_MAX_ATTEMPTS = 30 // Stop after ~30 seconds total
const NAVIGATION_UPDATE_DELAY_MS = 50
const NAVIGATION_COMPLETE_DELAY_MS = 100

interface Props {
  app: MiniApp
  webviewRef: React.RefObject<WebviewTag | null>
  currentUrl: string | null
  onReload: () => void
  onOpenDevTools: () => void
}

const MinimalToolbar: FC<Props> = ({ app, webviewRef, currentUrl, onReload, onOpenDevTools }) => {
  const { t } = useTranslation()
  const { pinned, updateAppStatus, allApps } = useMiniApps()
  const [openLinkExternal, setOpenLinkExternal] = usePreference('feature.mini_app.open_link_external')
  const [canGoBack, setCanGoBack] = useState(false)
  const [canGoForward, setCanGoForward] = useState(false)
  const canPinned = allApps.some((item) => item.appId === app.appId)
  const isPinned = pinned.some((item) => item.appId === app.appId)
  const canOpenExternalLink = app.url.startsWith('http://') || app.url.startsWith('https://')

  // Ref to track navigation update timeout
  const navigationUpdateTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Update navigation state
  const updateNavigationState = useCallback(() => {
    if (webviewRef.current) {
      try {
        setCanGoBack(webviewRef.current.canGoBack())
        setCanGoForward(webviewRef.current.canGoForward())
      } catch (error) {
        logger.debug('WebView not ready for navigation state update', { appId: app.appId })
        setCanGoBack(false)
        setCanGoForward(false)
      }
    } else {
      setCanGoBack(false)
      setCanGoForward(false)
    }
  }, [app.appId, webviewRef])

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

  // Cleanup navigation timeout on unmount
  useEffect(() => {
    return () => {
      if (navigationUpdateTimeoutRef.current) {
        clearTimeout(navigationUpdateTimeoutRef.current)
      }
    }
  }, [])

  // Monitor webviewRef changes and update navigation state
  useEffect(() => {
    let checkTimeout: NodeJS.Timeout | null = null
    let navigationListener: (() => void) | null = null
    let listenersAttached = false
    let currentInterval = WEBVIEW_CHECK_INITIAL_MS
    let attemptCount = 0

    const attachListeners = () => {
      if (webviewRef.current && !listenersAttached) {
        // Update state immediately
        updateNavigationState()

        // Add navigation event listeners
        const handleNavigation = () => {
          scheduleNavigationUpdate(NAVIGATION_UPDATE_DELAY_MS)
        }

        webviewRef.current.addEventListener('did-navigate', handleNavigation)
        webviewRef.current.addEventListener('did-navigate-in-page', handleNavigation)
        listenersAttached = true

        navigationListener = () => {
          if (webviewRef.current) {
            webviewRef.current.removeEventListener('did-navigate', handleNavigation)
            webviewRef.current.removeEventListener('did-navigate-in-page', handleNavigation)
          }
          listenersAttached = false
        }

        if (checkTimeout) {
          clearTimeout(checkTimeout)
          checkTimeout = null
        }

        logger.debug('Navigation listeners attached', { appId: app.appId, attempts: attemptCount })
        return true
      }
      return false
    }

    const scheduleCheck = () => {
      checkTimeout = setTimeout(() => {
        // Use requestAnimationFrame to avoid blocking the main thread
        requestAnimationFrame(() => {
          attemptCount++
          if (!attachListeners()) {
            // Stop checking after max attempts to prevent infinite loops
            if (attemptCount >= WEBVIEW_CHECK_MAX_ATTEMPTS) {
              logger.warn('WebView attachment timeout', {
                appId: app.appId,
                attempts: attemptCount,
                totalTimeMs: currentInterval * attemptCount
              })
              return
            }

            // Exponential backoff: double the interval up to the maximum
            currentInterval = Math.min(currentInterval * WEBVIEW_CHECK_MULTIPLIER, WEBVIEW_CHECK_MAX_MS)

            // Log only on first few attempts or when interval changes significantly
            if (attemptCount <= 3 || attemptCount % 10 === 0) {
              logger.debug('WebView not ready, scheduling next check', {
                appId: app.appId,
                nextCheckMs: currentInterval,
                attempt: attemptCount
              })
            }

            scheduleCheck()
          }
        })
      }, currentInterval)
    }

    // Check for webview attachment
    if (!webviewRef.current) {
      scheduleCheck()
    } else {
      attachListeners()
    }

    // Cleanup
    return () => {
      if (checkTimeout) clearTimeout(checkTimeout)
      if (navigationListener) navigationListener()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.appId, updateNavigationState, scheduleNavigationUpdate]) // webviewRef excluded as it's a ref object

  const handleGoBack = useCallback(() => {
    if (webviewRef.current) {
      try {
        if (webviewRef.current.canGoBack()) {
          webviewRef.current.goBack()
          // Delay update to ensure navigation completes
          scheduleNavigationUpdate(NAVIGATION_COMPLETE_DELAY_MS)
        }
      } catch (error) {
        logger.debug('WebView not ready for navigation', { appId: app.appId, action: 'goBack' })
      }
    }
  }, [app.appId, webviewRef, scheduleNavigationUpdate])

  const handleGoForward = useCallback(() => {
    if (webviewRef.current) {
      try {
        if (webviewRef.current.canGoForward()) {
          webviewRef.current.goForward()
          // Delay update to ensure navigation completes
          scheduleNavigationUpdate(NAVIGATION_COMPLETE_DELAY_MS)
        }
      } catch (error) {
        logger.debug('WebView not ready for navigation', { appId: app.appId, action: 'goForward' })
      }
    }
  }, [app.appId, webviewRef, scheduleNavigationUpdate])

  const handleTogglePin = useCallback(() => {
    const fallbackKey = isPinned ? 'miniApp.unpin_failed' : 'miniApp.pin_failed'
    updateAppStatus(app.appId, isPinned ? 'enabled' : 'pinned').catch((err) => {
      const e = toDataApiError(err)
      if (isDataApiError(e)) {
        logger.error('togglePin failed', { code: e.code, message: e.message })
        window.toast?.error?.(e.message || t(fallbackKey))
      } else {
        logger.error('togglePin failed', err as Error)
        window.toast?.error?.(t(fallbackKey))
      }
    })
  }, [app.appId, isPinned, updateAppStatus, t])

  const handleToggleOpenExternal = useCallback(() => {
    void setOpenLinkExternal(!openLinkExternal)
  }, [setOpenLinkExternal, openLinkExternal])

  const handleOpenLink = useCallback(() => {
    const urlToOpen = currentUrl || app.url
    void window.api.openWebsite(urlToOpen)
  }, [currentUrl, app.url])

  return (
    <div className="flex h-8.75 shrink-0 items-center justify-between bg-background px-3">
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-0.5">
          <Tooltip content={t('miniApp.popup.goBack')} placement="bottom">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={handleGoBack}
              disabled={!canGoBack}
              aria-label={t('miniApp.popup.goBack')}
              className={cn(
                'text-xs transition-all duration-200',
                !canGoBack && 'cursor-default text-foreground-muted',
                canGoBack && 'text-foreground-secondary hover:bg-accent hover:text-foreground active:scale-95'
              )}>
              <ArrowLeftOutlined />
            </Button>
          </Tooltip>

          <Tooltip content={t('miniApp.popup.goForward')} placement="bottom">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={handleGoForward}
              disabled={!canGoForward}
              aria-label={t('miniApp.popup.goForward')}
              className={cn(
                'text-xs transition-all duration-200',
                !canGoForward && 'cursor-default text-foreground-muted',
                canGoForward && 'text-foreground-secondary hover:bg-accent hover:text-foreground active:scale-95'
              )}>
              <ArrowRightOutlined />
            </Button>
          </Tooltip>

          <Tooltip content={t('miniApp.popup.refresh')} placement="bottom">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onReload}
              aria-label={t('miniApp.popup.refresh')}
              className="text-foreground-secondary text-xs transition-all duration-200 hover:bg-accent hover:text-foreground active:scale-95">
              <ReloadOutlined />
            </Button>
          </Tooltip>
        </div>
      </div>

      <div className="flex items-center">
        <div className="flex items-center gap-0.5">
          {canOpenExternalLink && (
            <Tooltip content={t('miniApp.popup.openExternal')} placement="bottom">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={handleOpenLink}
                aria-label={t('miniApp.popup.openExternal')}
                className="text-foreground-secondary text-xs transition-all duration-200 hover:bg-accent hover:text-foreground active:scale-95">
                <ExportOutlined />
              </Button>
            </Tooltip>
          )}

          {canPinned && (
            <Tooltip
              content={isPinned ? t('miniApp.remove_from_launchpad') : t('miniApp.add_to_launchpad')}
              placement="bottom">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={handleTogglePin}
                aria-label={isPinned ? t('miniApp.remove_from_launchpad') : t('miniApp.add_to_launchpad')}
                aria-pressed={isPinned}
                className={cn(
                  'text-xs transition-all duration-200 active:scale-95',
                  isPinned
                    ? 'text-primary hover:text-primary'
                    : 'text-foreground-secondary hover:bg-accent hover:text-foreground'
                )}>
                <PushpinOutlined />
              </Button>
            </Tooltip>
          )}

          <Tooltip
            content={
              openLinkExternal ? t('miniApp.popup.open_link_external_on') : t('miniApp.popup.open_link_external_off')
            }
            placement="bottom">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={handleToggleOpenExternal}
              aria-label={
                openLinkExternal ? t('miniApp.popup.open_link_external_on') : t('miniApp.popup.open_link_external_off')
              }
              aria-pressed={openLinkExternal}
              className={cn(
                'text-xs transition-all duration-200 active:scale-95',
                openLinkExternal
                  ? 'text-primary hover:text-primary'
                  : 'text-foreground-secondary hover:bg-accent hover:text-foreground'
              )}>
              <LinkOutlined />
            </Button>
          </Tooltip>

          {isDev && (
            <Tooltip content={t('miniApp.popup.devtools')} placement="bottom">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={onOpenDevTools}
                aria-label={t('miniApp.popup.devtools')}
                className="text-foreground-secondary text-xs transition-all duration-200 hover:bg-accent hover:text-foreground active:scale-95">
                <CodeOutlined />
              </Button>
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  )
}

export default MinimalToolbar
