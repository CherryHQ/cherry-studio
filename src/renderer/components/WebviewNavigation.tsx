import { Button, Input, Popover, PopoverAnchor, PopoverContent, Tooltip } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { useQuery } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import type { WebviewAnnotationTarget } from '@shared/types/webviewAnnotation'
import type { DidNavigateEvent, DidNavigateInPageEvent, WebviewTag } from 'electron'
import { ArrowLeft, ArrowRight, ExternalLink, History, RotateCw } from 'lucide-react'
import type { ReactNode, RefObject } from 'react'
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
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
  pageTitle?: string
  historyEnabled?: boolean
  isWebviewReady: boolean
  isHostActive: boolean
  target: WebviewAnnotationTarget
  onReload?: () => void
  onNavigate?: (url: string) => void
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

function compactAddress(value: string): string {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.host : value
  } catch {
    return value
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
  pageTitle,
  historyEnabled = false,
  isWebviewReady,
  isHostActive,
  target,
  onReload,
  onNavigate,
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
  const [isAddressFocused, setIsAddressFocused] = useState(false)
  const previousTargetIdRef = useRef(target.id)
  const historyListId = useId()
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historySearch, setHistorySearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [activeSuggestion, setActiveSuggestion] = useState(-1)
  const showHistory = historyEnabled && historyOpen && isHostActive && isWebviewReady
  const search = historySearch.trim().slice(0, 500)
  useEffect(() => {
    if (!showHistory) return
    const timer = setTimeout(() => setDebouncedSearch(search), 200)
    return () => clearTimeout(timer)
  }, [search, showHistory])
  const {
    data: history,
    isLoading: historyLoading,
    error: historyError
  } = useQuery('/browser-visits', {
    query: { search: debouncedSearch, offset: 0, limit: 20 },
    enabled: showHistory && search === debouncedSearch,
    swrOptions: { keepPreviousData: false }
  })
  const suggestions =
    search === debouncedSearch
      ? (history?.items ?? [])
          .filter((visit, index, visits) => visits.findIndex((item) => item.url === visit.url) === index)
          .slice(0, 8)
      : []
  const selectedSuggestion = showHistory ? suggestions[activeSuggestion] : undefined

  useEffect(() => {
    if (showHistory && activeSuggestion >= 0)
      document.getElementById(`${historyListId}-${activeSuggestion}`)?.scrollIntoView?.({ block: 'nearest' })
  }, [activeSuggestion, historyListId, showHistory])

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
    void ipcApi.request('system.shell.open_external_website', currentPageUrl)
  }, [currentPageUrl])

  const navigateToAddress = useCallback(
    (address: string) => {
      const normalizedAddress = normalizeWebviewAddress(address)
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
      setHistoryOpen(false)
      setAddressValue(normalizedAddress)
      addressInputRef.current?.blur()

      try {
        if (onNavigate) {
          onNavigate(normalizedAddress)
          return
        }
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
    [onNavigate, restoreCurrentPageUrl, t, target.id, webviewRef]
  )

  useLayoutEffect(() => {
    if (isAddressFocused) addressInputRef.current?.select()
  }, [isAddressFocused])

  const handleAddressFocus = useCallback(() => {
    isAddressEditingRef.current = true
    setIsAddressFocused(true)
    setHistoryOpen(true)
    setHistorySearch('')
    setActiveSuggestion(-1)
  }, [])

  const handleAddressBlur = useCallback(() => {
    setIsAddressFocused(false)
    setHistoryOpen(false)
    if (!isAddressEditingRef.current) return
    isAddressEditingRef.current = false
    restoreCurrentPageUrl()
  }, [restoreCurrentPageUrl])

  const handleAddressKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.nativeEvent.isComposing) {
        if (event.key === 'Enter') event.preventDefault()
        return
      }
      if (showHistory && suggestions.length && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
        event.preventDefault()
        setActiveSuggestion((current) =>
          event.key === 'ArrowDown'
            ? (current + 1) % suggestions.length
            : current < 0
              ? suggestions.length - 1
              : (current - 1 + suggestions.length) % suggestions.length
        )
        return
      }
      if (event.key === 'Enter' && selectedSuggestion) {
        event.preventDefault()
        navigateToAddress(selectedSuggestion.url)
        return
      }
      if (event.key !== 'Escape') return
      setHistoryOpen(false)
      event.preventDefault()
      isAddressEditingRef.current = false
      restoreCurrentPageUrl()
      event.currentTarget.blur()
    },
    [navigateToAddress, restoreCurrentPageUrl, selectedSuggestion, showHistory, suggestions.length]
  )

  const canOpenExternal = isExternalUrl(currentPageUrl)
  const addressHost = compactAddress(addressValue)
  const addressTitle =
    addressValue === currentPageUrl && pageTitle !== addressValue && pageTitle !== addressHost ? pageTitle : undefined
  const addressDisplay = addressTitle ? `${addressHost} / ${addressTitle}` : addressHost

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

      <Popover open={showHistory} onOpenChange={setHistoryOpen}>
        <PopoverAnchor asChild>
          <form
            className="relative mx-1 min-w-0 flex-1"
            onSubmit={(event) => {
              event.preventDefault()
              navigateToAddress(addressValue)
            }}>
            <Input
              ref={addressInputRef}
              type="text"
              inputMode="url"
              value={isAddressFocused ? addressValue : addressDisplay}
              onChange={(event) => {
                setAddressValue(event.target.value)
                setHistorySearch(event.target.value)
                setActiveSuggestion(-1)
                setHistoryOpen(true)
              }}
              onFocus={handleAddressFocus}
              onBlur={handleAddressBlur}
              onKeyDown={handleAddressKeyDown}
              disabled={!isWebviewReady}
              aria-label={t('webview.navigation.address')}
              role={historyEnabled ? 'combobox' : undefined}
              aria-autocomplete={historyEnabled ? 'list' : undefined}
              aria-expanded={historyEnabled ? showHistory : undefined}
              aria-controls={showHistory ? historyListId : undefined}
              aria-activedescendant={selectedSuggestion ? `${historyListId}-${activeSuggestion}` : undefined}
              title={currentPageUrl}
              placeholder={t(
                historyEnabled ? 'webview.navigation.history_placeholder' : 'webview.navigation.address_placeholder'
              )}
              autoCapitalize="none"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              className={cn(
                'h-7 truncate rounded-md border-input bg-background px-2.5 text-xs shadow-none',
                isAddressFocused ? 'text-foreground' : 'text-transparent'
              )}
            />
            {!isAddressFocused && (
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 flex items-center gap-1.5 overflow-hidden px-2.5 text-xs md:text-sm">
                <span className="truncate text-muted-foreground">{addressHost}</span>
                {addressTitle && (
                  <>
                    <span className="shrink-0 text-foreground-tertiary">/</span>
                    <span className="min-w-0 truncate text-foreground">{addressTitle}</span>
                  </>
                )}
              </span>
            )}
          </form>
        </PopoverAnchor>
        <PopoverContent
          align="start"
          className="w-(--radix-popover-trigger-width) p-1"
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onInteractOutside={(event) => {
            if (event.target === addressInputRef.current) event.preventDefault()
          }}>
          <div
            id={historyListId}
            role="listbox"
            aria-label={t('settings.browser.history')}
            className="max-h-80 overflow-y-auto">
            {suggestions.map((visit, index) => (
              <Button
                key={visit.url}
                id={`${historyListId}-${index}`}
                role="option"
                aria-selected={index === activeSuggestion}
                tabIndex={-1}
                type="button"
                variant="ghost"
                className={cn(
                  'h-auto w-full justify-start gap-2 px-2 py-2 text-start',
                  index === activeSuggestion && 'bg-accent'
                )}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => navigateToAddress(visit.url)}>
                <History aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{visit.title || visit.url}</span>
                  <span className="block truncate text-muted-foreground text-xs">{visit.url}</span>
                </span>
              </Button>
            ))}
          </div>
          {!suggestions.length && (
            <p role="status" className="px-3 py-4 text-muted-foreground text-sm">
              {t(
                historyError
                  ? 'settings.browser.error'
                  : historyLoading || search !== debouncedSearch
                    ? 'common.loading'
                    : 'settings.browser.noResults'
              )}
            </p>
          )}
        </PopoverContent>
      </Popover>

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
