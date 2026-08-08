import { Button, Input, Tooltip } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { WebviewAnnotationControls } from '@renderer/components/WebviewAnnotationControls'
import { useMiniApps } from '@renderer/hooks/useMiniApps'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { isDev } from '@renderer/utils/platform'
import { isDataApiError, toDataApiError } from '@shared/data/api/errors'
import { MiniAppUrlSchema } from '@shared/data/api/schemas/miniApps'
import type { MiniApp } from '@shared/data/types/miniApp'
import { WEBVIEW_ANNOTATION_LIMITS } from '@shared/types/webview'
import type { DidNavigateEvent, DidNavigateInPageEvent, WebviewTag } from 'electron'
import { ArrowLeft, ArrowRight, Code, ExternalLink, LayoutGrid, Link, RotateCw } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('MinimalToolbar')

// Constants for timing delays
const WEBVIEW_CHECK_INITIAL_MS = 100 // Initial check interval
const WEBVIEW_CHECK_MAX_MS = 1000 // Maximum check interval (1 second)
const WEBVIEW_CHECK_MULTIPLIER = 2 // Exponential backoff multiplier
const WEBVIEW_CHECK_MAX_ATTEMPTS = 30 // Stop after ~30 seconds total
const NAVIGATION_UPDATE_DELAY_MS = 50
const NAVIGATION_COMPLETE_DELAY_MS = 100
const URL_SCHEME_PATTERN = /^[a-z][a-z\d+.-]*:/i
const LOCAL_ADDRESS_PATTERN = /^(?:localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[?::1\]?)(?::\d+)?(?:[/?#]|$)/i

function normalizeAddress(value: string): string | null {
  const trimmedValue = value.trim()
  if (!trimmedValue) return null

  const url = URL_SCHEME_PATTERN.test(trimmedValue)
    ? trimmedValue
    : `${LOCAL_ADDRESS_PATTERN.test(trimmedValue) ? 'http' : 'https'}://${trimmedValue}`

  return MiniAppUrlSchema.safeParse(url).success ? url : null
}

function isExternalUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

interface Props {
  app: MiniApp
  webviewRef: React.RefObject<WebviewTag | null>
  currentUrl: string | null
  isWebviewReady: boolean
  isHostActive: boolean
  onReload: () => void
  onOpenDevTools: () => void
}

const MinimalToolbar: FC<Props> = ({
  app,
  webviewRef,
  currentUrl,
  isWebviewReady,
  isHostActive,
  onReload,
  onOpenDevTools
}) => {
  const { t } = useTranslation()
  const { pinned, updateAppStatus, allApps } = useMiniApps()
  const [openLinkExternal, setOpenLinkExternal] = usePreference('feature.mini_app.open_link_external')
  const [canGoBack, setCanGoBack] = useState(false)
  const [canGoForward, setCanGoForward] = useState(false)
  const [currentPageUrl, setCurrentPageUrl] = useState(currentUrl || app.url)
  const [addressValue, setAddressValue] = useState(currentUrl || app.url)
  const canPinned = allApps.some((item) => item.appId === app.appId)
  const isPinned = pinned.some((item) => item.appId === app.appId)
  const canOpenExternalLink = isExternalUrl(currentPageUrl)
  const annotationTarget = useMemo(
    () => ({
      id: `mini-app:${app.appId}`,
      label: (app.nameKey ? t(app.nameKey) : app.name).trim().slice(0, WEBVIEW_ANNOTATION_LIMITS.targetLabel)
    }),
    [app.appId, app.name, app.nameKey, t]
  )

  // Ref to track navigation update timeout
  const navigationUpdateTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const addressInputRef = useRef<HTMLInputElement | null>(null)
  const isAddressEditingRef = useRef(false)
  const previousAppIdRef = useRef(app.appId)

  useEffect(() => {
    const appChanged = previousAppIdRef.current !== app.appId
    previousAppIdRef.current = app.appId
    const nextUrl = currentUrl || app.url

    setCurrentPageUrl(nextUrl)
    if (appChanged || !isAddressEditingRef.current) {
      isAddressEditingRef.current = false
      setAddressValue(nextUrl)
    }
  }, [app.appId, app.url, currentUrl])

  const updateCurrentPageUrl = useCallback((url: string) => {
    if (!url) return
    setCurrentPageUrl(url)
    if (!isAddressEditingRef.current) {
      setAddressValue(url)
    }
  }, [])

  const restoreCurrentPageUrl = useCallback(() => {
    let url = currentPageUrl
    try {
      url = webviewRef.current?.getURL() || url
    } catch {
      // The WebView may be detaching; the last committed URL is still safe to display.
    }
    updateCurrentPageUrl(url)
    setAddressValue(url)
  }, [currentPageUrl, updateCurrentPageUrl, webviewRef])

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
        const attachedWebview = webviewRef.current
        // Update state immediately
        updateNavigationState()
        try {
          updateCurrentPageUrl(attachedWebview.getURL())
        } catch {
          logger.debug('WebView not ready for URL state update', { appId: app.appId })
        }

        // Add navigation event listeners
        const handleNavigation = (event: DidNavigateEvent | DidNavigateInPageEvent) => {
          if ('isMainFrame' in event && !event.isMainFrame) return
          updateCurrentPageUrl(event.url)
          scheduleNavigationUpdate(NAVIGATION_UPDATE_DELAY_MS)
        }

        attachedWebview.addEventListener('did-navigate', handleNavigation)
        attachedWebview.addEventListener('did-navigate-in-page', handleNavigation)
        listenersAttached = true

        navigationListener = () => {
          attachedWebview.removeEventListener('did-navigate', handleNavigation)
          attachedWebview.removeEventListener('did-navigate-in-page', handleNavigation)
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
  }, [app.appId, updateCurrentPageUrl, updateNavigationState, scheduleNavigationUpdate]) // webviewRef excluded as it's a ref object

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
    void ipcApi.request('system.shell.open_website', currentPageUrl)
  }, [currentPageUrl])

  const handleAddressSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      const normalizedAddress = normalizeAddress(addressValue)
      if (!normalizedAddress) {
        toast.error(t('settings.miniApps.custom.url_invalid'))
        restoreCurrentPageUrl()
        return
      }

      const webview = webviewRef.current
      if (!webview) {
        toast.error(t('miniApp.error.load_failed'))
        restoreCurrentPageUrl()
        return
      }

      isAddressEditingRef.current = false
      setAddressValue(normalizedAddress)
      addressInputRef.current?.blur()

      try {
        void webview.loadURL(normalizedAddress).catch((error) => {
          logger.error('Failed to navigate WebView from address bar', error as Error)
          restoreCurrentPageUrl()
          toast.error(t('miniApp.error.load_failed'))
        })
      } catch (error) {
        logger.error('Failed to navigate WebView from address bar', error as Error)
        restoreCurrentPageUrl()
        toast.error(t('miniApp.error.load_failed'))
      }
    },
    [addressValue, restoreCurrentPageUrl, t, webviewRef]
  )

  const handleAddressFocus = useCallback((event: React.FocusEvent<HTMLInputElement>) => {
    isAddressEditingRef.current = true
    event.currentTarget.select()
  }, [])

  const handleAddressBlur = useCallback(() => {
    if (!isAddressEditingRef.current) return
    isAddressEditingRef.current = false
    restoreCurrentPageUrl()
  }, [restoreCurrentPageUrl])

  const handleAddressKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      isAddressEditingRef.current = false
      restoreCurrentPageUrl()
      event.currentTarget.blur()
    },
    [restoreCurrentPageUrl]
  )

  return (
    <div className="flex h-8.75 shrink-0 items-center gap-2 bg-background px-3">
      <div className="flex shrink-0 items-center gap-2">
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
        </div>
      </div>

      <form className="mx-1 min-w-0 flex-1" onSubmit={handleAddressSubmit}>
        <Input
          ref={addressInputRef}
          type="text"
          inputMode="url"
          value={addressValue}
          onChange={(event) => setAddressValue(event.target.value)}
          onFocus={handleAddressFocus}
          onBlur={handleAddressBlur}
          onKeyDown={handleAddressKeyDown}
          disabled={!isWebviewReady}
          aria-label={t('settings.miniApps.custom.url')}
          title={currentPageUrl}
          placeholder={t('settings.miniApps.custom.url_placeholder')}
          autoCapitalize="none"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          className="h-7 rounded-md border-input bg-background px-2.5 text-foreground-secondary text-xs shadow-none focus-visible:text-foreground"
        />
      </form>

      <div className="flex shrink-0 items-center">
        <div className="flex items-center gap-0.5">
          <WebviewAnnotationControls
            webviewRef={webviewRef}
            isWebviewReady={isWebviewReady}
            isHostActive={isHostActive}
            target={annotationTarget}
          />

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
                openLinkExternal ? t('miniApp.popup.open_link_external_on') : t('miniApp.popup.open_link_external_off')
              }
              aria-pressed={openLinkExternal}>
              <Link size={14} />
            </Button>
          </Tooltip>

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
