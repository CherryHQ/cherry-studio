import { Button, Input, Tooltip } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import MiniAppDetailPanel from '@renderer/components/MiniApp/MiniAppDetailPanel'
import { WebviewAnnotationControls } from '@renderer/components/WebviewAnnotationControls'
import { useMiniApps } from '@renderer/hooks/useMiniApps'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { isDev } from '@renderer/utils/platform'
import { isDataApiError, toDataApiError } from '@shared/data/api/errors'
import { MiniAppUrlSchema } from '@shared/data/api/schemas/miniApps'
import type { MiniApp } from '@shared/data/types/miniApp'
import { WEBVIEW_ANNOTATION_LIMITS } from '@shared/types/webviewAnnotation'
import type { DidNavigateEvent, DidNavigateInPageEvent, WebviewTag } from 'electron'
import { ArrowLeft, ArrowRight, Code, Columns2, ExternalLink, Info, LayoutGrid, Link, RotateCw, X } from 'lucide-react'
import type { FC, RefObject } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { v5 as uuidv5 } from 'uuid'

const logger = loggerService.withContext('MinimalToolbar')

const NAVIGATION_UPDATE_DELAY_MS = 50
const NAVIGATION_COMPLETE_DELAY_MS = 100
const URL_SCHEME_PATTERN = /^[a-z][a-z\d+.-]*:/i
const HOST_PORT_PATTERN = /^(?:\[[^\]]+\]|[^:/?#\s]+):\d+(?:[/?#]|$)/
const LOCAL_ADDRESS_PATTERN = /^(?:localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[?::1\]?)(?::\d+)?(?:[/?#]|$)/i
const MINI_APP_ANNOTATION_TARGET_PREFIX = 'mini-app:'

function getAnnotationTargetId(appId: string): string {
  const targetId = `${MINI_APP_ANNOTATION_TARGET_PREFIX}${appId}`
  if (targetId.length <= WEBVIEW_ANNOTATION_LIMITS.targetId) return targetId

  return `${MINI_APP_ANNOTATION_TARGET_PREFIX}hashed:${uuidv5(appId, uuidv5.URL)}`
}

function normalizeAddress(value: string): string | null {
  const trimmedValue = value.trim()
  if (!trimmedValue) return null

  const url =
    URL_SCHEME_PATTERN.test(trimmedValue) && !HOST_PORT_PATTERN.test(trimmedValue)
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

/** `open` splits the view in two; `close` is the split pane's way back to one. */
export type SplitMode = 'open' | 'close'

interface Props {
  app: MiniApp
  webviewRef: RefObject<WebviewTag | null>
  webviewRevision: number
  currentUrl: string | null
  isWebviewReady: boolean
  isHostActive: boolean
  onReload: () => void
  onOpenDevTools: () => void
  splitMode: SplitMode
  /** Whether the view is currently split, so the control reads as engaged. */
  splitActive?: boolean
  onSplit: () => void
}

const MinimalToolbar: FC<Props> = ({
  app,
  webviewRef,
  webviewRevision,
  currentUrl,
  isWebviewReady,
  isHostActive,
  onReload,
  onOpenDevTools,
  splitMode,
  splitActive = false,
  onSplit
}) => {
  const webview = webviewRef.current
  const { t } = useTranslation()
  const { pinned, updateAppStatus, allApps } = useMiniApps()
  const [openLinkExternal, setOpenLinkExternal] = usePreference('feature.mini_app.open_link_external')
  const [canGoBack, setCanGoBack] = useState(false)
  const [canGoForward, setCanGoForward] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const [currentPageUrl, setCurrentPageUrl] = useState(currentUrl || app.url)
  const [addressValue, setAddressValue] = useState(currentUrl || app.url)
  // While split, the primary pane's control closes the split rather than being
  // a dead "open it again" button.
  const splitLabelKey = splitMode === 'close' || splitActive ? 'miniApp.split.close' : 'miniApp.split.open'
  const canPinned = allApps.some((item) => item.appId === app.appId)
  const isPinned = pinned.some((item) => item.appId === app.appId)
  const canOpenExternalLink = isExternalUrl(currentPageUrl)
  const annotationTarget = useMemo(
    () => ({
      id: getAnnotationTargetId(app.appId),
      label: ((app.nameKey ? t(app.nameKey) : app.name).trim() || t('common.unnamed')).slice(
        0,
        WEBVIEW_ANNOTATION_LIMITS.targetLabel
      )
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
    if (!isAddressEditingRef.current) setAddressValue(url)
  }, [])

  const restoreCurrentPageUrl = useCallback(() => {
    let url = currentPageUrl
    try {
      url = webview?.getURL() || url
    } catch {
      // The WebView may be detaching; keep the last committed URL.
    }
    updateCurrentPageUrl(url)
    setAddressValue(url)
  }, [currentPageUrl, updateCurrentPageUrl, webview])

  // Update navigation state
  const updateNavigationState = useCallback(
    (attachedWebview: WebviewTag | null) => {
      if (attachedWebview) {
        try {
          setCanGoBack(attachedWebview.canGoBack())
          setCanGoForward(attachedWebview.canGoForward())
        } catch (error) {
          logger.debug('WebView not ready for navigation state update', { appId: app.appId })
          setCanGoBack(false)
          setCanGoForward(false)
        }
      } else {
        setCanGoBack(false)
        setCanGoForward(false)
      }
    },
    [app.appId]
  )

  const clearNavigationUpdate = useCallback(() => {
    if (navigationUpdateTimeoutRef.current) {
      clearTimeout(navigationUpdateTimeoutRef.current)
      navigationUpdateTimeoutRef.current = null
    }
  }, [])

  // Schedule navigation state update with debouncing
  const scheduleNavigationUpdate = useCallback(
    (attachedWebview: WebviewTag, delay: number) => {
      clearNavigationUpdate()
      navigationUpdateTimeoutRef.current = setTimeout(() => {
        updateNavigationState(attachedWebview)
        navigationUpdateTimeoutRef.current = null
      }, delay)
    },
    [clearNavigationUpdate, updateNavigationState]
  )

  // Bind navigation state to the concrete webview identity.
  useEffect(() => {
    clearNavigationUpdate()
    updateNavigationState(webview)
    if (!webview) return

    try {
      updateCurrentPageUrl(webview.getURL())
    } catch {
      logger.debug('WebView not ready for URL state update', { appId: app.appId })
    }

    const handleNavigation = (event: DidNavigateEvent | DidNavigateInPageEvent) => {
      if ('isMainFrame' in event && !event.isMainFrame) return
      updateCurrentPageUrl(event.url)
      scheduleNavigationUpdate(webview, NAVIGATION_UPDATE_DELAY_MS)
    }

    webview.addEventListener('did-navigate', handleNavigation)
    webview.addEventListener('did-navigate-in-page', handleNavigation)

    return () => {
      clearNavigationUpdate()
      webview.removeEventListener('did-navigate', handleNavigation)
      webview.removeEventListener('did-navigate-in-page', handleNavigation)
    }
  }, [
    app.appId,
    clearNavigationUpdate,
    scheduleNavigationUpdate,
    updateCurrentPageUrl,
    updateNavigationState,
    webview,
    webviewRevision
  ])

  const handleGoBack = useCallback(() => {
    if (webview) {
      try {
        if (webview.canGoBack()) {
          webview.goBack()
          // Delay update to ensure navigation completes
          scheduleNavigationUpdate(webview, NAVIGATION_COMPLETE_DELAY_MS)
        }
      } catch (error) {
        logger.debug('WebView not ready for navigation', { appId: app.appId, action: 'goBack' })
      }
    }
  }, [app.appId, scheduleNavigationUpdate, webview])

  const handleGoForward = useCallback(() => {
    if (webview) {
      try {
        if (webview.canGoForward()) {
          webview.goForward()
          // Delay update to ensure navigation completes
          scheduleNavigationUpdate(webview, NAVIGATION_COMPLETE_DELAY_MS)
        }
      } catch (error) {
        logger.debug('WebView not ready for navigation', { appId: app.appId, action: 'goForward' })
      }
    }
  }, [app.appId, scheduleNavigationUpdate, webview])

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
    [addressValue, restoreCurrentPageUrl, t, webview]
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

      {app.kind === 'site' && (
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
            className="h-7 rounded-md border-input bg-background px-2.5 text-muted-foreground text-xs shadow-none focus-visible:text-foreground"
          />
        </form>
      )}

      <div className="ml-auto flex shrink-0 items-center">
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

          {app.kind === 'site' && (
            <WebviewAnnotationControls
              webviewRef={webviewRef}
              webviewRevision={webviewRevision}
              isWebviewReady={isWebviewReady}
              isHostActive={isHostActive}
              target={annotationTarget}
            />
          )}

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
