import { Button, Input, Tooltip } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import type { WebviewAnnotationTarget } from '@shared/types/webviewAnnotation'
import type { DidNavigateEvent, DidNavigateInPageEvent, WebviewTag } from 'electron'
import { ArrowLeft, ArrowRight, ExternalLink, RotateCw } from 'lucide-react'
import type { ReactNode, RefObject } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { WebviewAnnotationControls, type WebviewAnnotationSavedPayload } from './WebviewAnnotationControls'

const logger = loggerService.withContext('WebviewNavigation')
const WEBVIEW_CHECK_INITIAL_MS = 100
const WEBVIEW_CHECK_MAX_MS = 1_000
const WEBVIEW_CHECK_MAX_ATTEMPTS = 30
const NAVIGATION_UPDATE_DELAY_MS = 50
const NAVIGATION_COMPLETE_DELAY_MS = 100
const URL_SCHEME_PATTERN = /^[a-z][a-z\d+.-]*:/i
const LOCAL_ADDRESS_PATTERN = /^(?:localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[?::1\]?)(?::\d+)?(?:[/?#]|$)/i
const ALLOWED_PROTOCOLS = new Set(['file:', 'http:', 'https:'])

interface Props {
  webviewRef: RefObject<WebviewTag | null>
  webviewRevision: number
  initialUrl: string
  currentUrl?: string | null
  isWebviewReady: boolean
  isHostActive: boolean
  target: WebviewAnnotationTarget
  onReload?: () => void
  onAnnotationSaved?: (payload: WebviewAnnotationSavedPayload) => void
  toolbarActions?: ReactNode
}

export function normalizeWebviewAddress(value: string): string | null {
  const trimmedValue = value.trim()
  if (!trimmedValue) return null

  const candidate = LOCAL_ADDRESS_PATTERN.test(trimmedValue)
    ? `http://${trimmedValue}`
    : URL_SCHEME_PATTERN.test(trimmedValue)
      ? trimmedValue
      : `https://${trimmedValue}`

  try {
    const url = new URL(candidate)
    return ALLOWED_PROTOCOLS.has(url.protocol) ? url.toString() : null
  } catch {
    return null
  }
}

function isExternalUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

export function WebviewNavigation({
  webviewRef,
  webviewRevision,
  initialUrl,
  currentUrl,
  isWebviewReady,
  isHostActive,
  target,
  onReload,
  onAnnotationSaved,
  toolbarActions
}: Props) {
  const { t } = useTranslation()
  const [canGoBack, setCanGoBack] = useState(false)
  const [canGoForward, setCanGoForward] = useState(false)
  const [currentPageUrl, setCurrentPageUrl] = useState(currentUrl || initialUrl)
  const [addressValue, setAddressValue] = useState(currentUrl || initialUrl)
  const navigationUpdateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const addressInputRef = useRef<HTMLInputElement | null>(null)
  const isAddressEditingRef = useRef(false)
  const previousTargetIdRef = useRef(target.id)

  useEffect(() => {
    const targetChanged = previousTargetIdRef.current !== target.id
    previousTargetIdRef.current = target.id
    const nextUrl = currentUrl || initialUrl

    setCurrentPageUrl(nextUrl)
    if (targetChanged || !isAddressEditingRef.current) {
      isAddressEditingRef.current = false
      setAddressValue(nextUrl)
    }
  }, [currentUrl, initialUrl, target.id])

  const updateCurrentPageUrl = useCallback((url: string) => {
    if (!url) return
    setCurrentPageUrl(url)
    if (!isAddressEditingRef.current) setAddressValue(url)
  }, [])

  const restoreCurrentPageUrl = useCallback(() => {
    let url = currentPageUrl
    try {
      url = webviewRef.current?.getURL() || url
    } catch {
      // The guest may be detaching; the last committed URL remains the best display value.
    }
    updateCurrentPageUrl(url)
    setAddressValue(url)
  }, [currentPageUrl, updateCurrentPageUrl, webviewRef])

  const updateNavigationState = useCallback(() => {
    const webview = webviewRef.current
    if (!webview) {
      setCanGoBack(false)
      setCanGoForward(false)
      return
    }

    try {
      setCanGoBack(webview.canGoBack())
      setCanGoForward(webview.canGoForward())
    } catch {
      logger.debug('WebView is not ready for navigation state', { targetId: target.id })
      setCanGoBack(false)
      setCanGoForward(false)
    }
  }, [target.id, webviewRef])

  const scheduleNavigationUpdate = useCallback(
    (delay: number) => {
      if (navigationUpdateTimeoutRef.current) clearTimeout(navigationUpdateTimeoutRef.current)
      navigationUpdateTimeoutRef.current = setTimeout(() => {
        updateNavigationState()
        navigationUpdateTimeoutRef.current = null
      }, delay)
    },
    [updateNavigationState]
  )

  useEffect(
    () => () => {
      if (navigationUpdateTimeoutRef.current) clearTimeout(navigationUpdateTimeoutRef.current)
    },
    []
  )

  useEffect(() => {
    let checkTimeout: ReturnType<typeof setTimeout> | null = null
    let detachListeners: (() => void) | null = null
    let currentInterval = WEBVIEW_CHECK_INITIAL_MS
    let attemptCount = 0

    const attachListeners = () => {
      const webview = webviewRef.current
      if (!webview || detachListeners) return Boolean(detachListeners)

      updateNavigationState()
      try {
        updateCurrentPageUrl(webview.getURL())
      } catch {
        logger.debug('WebView is not ready for URL state', { targetId: target.id })
      }

      const handleNavigation = (event: DidNavigateEvent | DidNavigateInPageEvent) => {
        if ('isMainFrame' in event && !event.isMainFrame) return
        updateCurrentPageUrl(event.url)
        scheduleNavigationUpdate(NAVIGATION_UPDATE_DELAY_MS)
      }
      webview.addEventListener('did-navigate', handleNavigation)
      webview.addEventListener('did-navigate-in-page', handleNavigation)
      detachListeners = () => {
        webview.removeEventListener('did-navigate', handleNavigation)
        webview.removeEventListener('did-navigate-in-page', handleNavigation)
      }
      return true
    }

    const scheduleCheck = () => {
      checkTimeout = setTimeout(() => {
        attemptCount += 1
        if (attachListeners() || attemptCount >= WEBVIEW_CHECK_MAX_ATTEMPTS) return
        currentInterval = Math.min(currentInterval * 2, WEBVIEW_CHECK_MAX_MS)
        scheduleCheck()
      }, currentInterval)
    }

    if (!attachListeners() && isHostActive) scheduleCheck()

    return () => {
      if (checkTimeout) clearTimeout(checkTimeout)
      detachListeners?.()
    }
  }, [isHostActive, scheduleNavigationUpdate, target.id, updateCurrentPageUrl, updateNavigationState, webviewRef])

  const handleGoBack = useCallback(() => {
    try {
      if (!webviewRef.current?.canGoBack()) return
      webviewRef.current.goBack()
      scheduleNavigationUpdate(NAVIGATION_COMPLETE_DELAY_MS)
    } catch {
      logger.debug('WebView is not ready to go back', { targetId: target.id })
    }
  }, [scheduleNavigationUpdate, target.id, webviewRef])

  const handleGoForward = useCallback(() => {
    try {
      if (!webviewRef.current?.canGoForward()) return
      webviewRef.current.goForward()
      scheduleNavigationUpdate(NAVIGATION_COMPLETE_DELAY_MS)
    } catch {
      logger.debug('WebView is not ready to go forward', { targetId: target.id })
    }
  }, [scheduleNavigationUpdate, target.id, webviewRef])

  const handleReload = useCallback(() => {
    if (onReload) {
      onReload()
      return
    }
    try {
      webviewRef.current?.reload()
    } catch {
      logger.debug('WebView is not ready to reload', { targetId: target.id })
    }
  }, [onReload, target.id, webviewRef])

  const handleOpenExternal = useCallback(() => {
    void ipcApi.request('system.shell.open_website', currentPageUrl)
  }, [currentPageUrl])

  const handleAddressSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      const normalizedAddress = normalizeWebviewAddress(addressValue)
      if (!normalizedAddress) {
        toast.error(t('webview.navigation.invalid_address'))
        restoreCurrentPageUrl()
        return
      }

      const webview = webviewRef.current
      if (!webview) {
        toast.error(t('webview.navigation.load_failed'))
        restoreCurrentPageUrl()
        return
      }

      isAddressEditingRef.current = false
      setAddressValue(normalizedAddress)
      addressInputRef.current?.blur()

      try {
        void webview.loadURL(normalizedAddress).catch((error) => {
          logger.error('Failed to navigate WebView from address bar', error as Error, { targetId: target.id })
          restoreCurrentPageUrl()
          toast.error(t('webview.navigation.load_failed'))
        })
      } catch (error) {
        logger.error('Failed to navigate WebView from address bar', error as Error, { targetId: target.id })
        restoreCurrentPageUrl()
        toast.error(t('webview.navigation.load_failed'))
      }
    },
    [addressValue, restoreCurrentPageUrl, t, target.id, webviewRef]
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

  const canOpenExternal = isExternalUrl(currentPageUrl)

  return (
    <div className="flex h-8.75 shrink-0 items-center gap-2 border-border-subtle border-b bg-background px-2">
      <div className="flex shrink-0 items-center gap-0.5">
        <Tooltip content={t('webview.navigation.back')} placement="bottom">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={!isWebviewReady || !canGoBack}
            onClick={handleGoBack}
            className={navigationButtonClassName}
            aria-label={t('webview.navigation.back')}>
            <ArrowLeft size={14} />
          </Button>
        </Tooltip>
        <Tooltip content={t('webview.navigation.forward')} placement="bottom">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={!isWebviewReady || !canGoForward}
            onClick={handleGoForward}
            className={navigationButtonClassName}
            aria-label={t('webview.navigation.forward')}>
            <ArrowRight size={14} />
          </Button>
        </Tooltip>
        <Tooltip content={t('webview.navigation.reload')} placement="bottom">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={!isWebviewReady}
            onClick={handleReload}
            className={navigationButtonClassName}
            aria-label={t('webview.navigation.reload')}>
            <RotateCw size={14} />
          </Button>
        </Tooltip>
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
          aria-label={t('webview.navigation.address')}
          title={currentPageUrl}
          placeholder={t('webview.navigation.address_placeholder')}
          autoCapitalize="none"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          className="h-7 rounded-md border-input bg-background px-2.5 text-muted-foreground text-xs shadow-none focus-visible:text-foreground"
        />
      </form>

      <div className="flex shrink-0 items-center gap-0.5">
        <WebviewAnnotationControls
          webviewRef={webviewRef}
          webviewRevision={webviewRevision}
          isWebviewReady={isWebviewReady}
          isHostActive={isHostActive}
          target={target}
          onAnnotationSaved={onAnnotationSaved}
        />
        {canOpenExternal ? (
          <Tooltip content={t('webview.navigation.open_external')} placement="bottom">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={handleOpenExternal}
              className={navigationButtonClassName}
              aria-label={t('webview.navigation.open_external')}>
              <ExternalLink size={14} />
            </Button>
          </Tooltip>
        ) : null}
        {toolbarActions}
      </div>
    </div>
  )
}

const navigationButtonClassName = cn(
  'rounded text-muted-foreground shadow-none active:scale-95',
  'hover:text-foreground disabled:cursor-default disabled:active:scale-100 disabled:hover:bg-transparent'
)
