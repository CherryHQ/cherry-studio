import { loggerService } from '@logger'
import type { DidNavigateEvent, DidNavigateInPageEvent, WebviewTag } from 'electron'
import { useCallback, useEffect, useRef, useState } from 'react'

const logger = loggerService.withContext('useWebviewNavigation')

interface Options {
  webview: WebviewTag | null
  revision: number
  targetId: string
  url: string
}

/** Navigation state follows the concrete guest; address drafts stay local to its toolbar. */
export function useWebviewNavigation({ webview, revision, targetId, url }: Options) {
  const [canGoBack, setCanGoBack] = useState(false)
  const [canGoForward, setCanGoForward] = useState(false)
  const [currentPageUrl, setCurrentPageUrl] = useState(url)
  const [addressValue, setAddressValue] = useState(url)
  const isAddressEditingRef = useRef(false)
  const previousTargetIdRef = useRef(targetId)
  const navigationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const targetChanged = previousTargetIdRef.current !== targetId
    previousTargetIdRef.current = targetId
    setCurrentPageUrl(url)
    if (targetChanged || !isAddressEditingRef.current) {
      isAddressEditingRef.current = false
      setAddressValue(url)
    }
  }, [targetId, url])

  const updateCurrentPageUrl = useCallback((nextUrl: string) => {
    if (!nextUrl) return
    setCurrentPageUrl(nextUrl)
    if (!isAddressEditingRef.current) setAddressValue(nextUrl)
  }, [])

  const restoreCurrentPageUrl = useCallback(() => {
    let nextUrl = currentPageUrl
    try {
      nextUrl = webview?.getURL() || nextUrl
    } catch {
      // A detaching guest may no longer expose its URL; retain the committed address.
    }
    updateCurrentPageUrl(nextUrl)
    setAddressValue(nextUrl)
  }, [currentPageUrl, updateCurrentPageUrl, webview])

  const updateNavigationState = useCallback(() => {
    try {
      setCanGoBack(webview?.canGoBack() ?? false)
      setCanGoForward(webview?.canGoForward() ?? false)
    } catch {
      setCanGoBack(false)
      setCanGoForward(false)
    }
  }, [webview])

  const clearNavigationUpdate = useCallback(() => {
    if (navigationTimerRef.current === null) return
    clearTimeout(navigationTimerRef.current)
    navigationTimerRef.current = null
  }, [])

  const scheduleNavigationUpdate = useCallback(
    (delay: number) => {
      clearNavigationUpdate()
      navigationTimerRef.current = setTimeout(() => {
        navigationTimerRef.current = null
        updateNavigationState()
      }, delay)
    },
    [clearNavigationUpdate, updateNavigationState]
  )

  useEffect(() => {
    if (!webview) {
      updateNavigationState()
      return
    }
    const syncGuest = () => {
      updateNavigationState()
      try {
        updateCurrentPageUrl(webview.getURL())
      } catch {
        // Native contents may not exist until dom-ready.
      }
    }
    syncGuest()
    const handleNavigation = (event: DidNavigateEvent | DidNavigateInPageEvent) => {
      if ('isMainFrame' in event && !event.isMainFrame) return
      updateCurrentPageUrl(event.url)
      scheduleNavigationUpdate(50)
    }
    webview.addEventListener('dom-ready', syncGuest)
    webview.addEventListener('did-navigate', handleNavigation)
    webview.addEventListener('did-navigate-in-page', handleNavigation)
    return () => {
      clearNavigationUpdate()
      webview.removeEventListener('dom-ready', syncGuest)
      webview.removeEventListener('did-navigate', handleNavigation)
      webview.removeEventListener('did-navigate-in-page', handleNavigation)
    }
  }, [
    clearNavigationUpdate,
    revision,
    scheduleNavigationUpdate,
    targetId,
    updateCurrentPageUrl,
    updateNavigationState,
    webview
  ])

  const goBack = useCallback(() => {
    try {
      if (!webview?.canGoBack()) return
      webview.goBack()
      scheduleNavigationUpdate(100)
    } catch {
      logger.debug('WebView is not ready to go back', { targetId })
    }
  }, [scheduleNavigationUpdate, targetId, webview])

  const goForward = useCallback(() => {
    try {
      if (!webview?.canGoForward()) return
      webview.goForward()
      scheduleNavigationUpdate(100)
    } catch {
      logger.debug('WebView is not ready to go forward', { targetId })
    }
  }, [scheduleNavigationUpdate, targetId, webview])

  return {
    canGoBack,
    canGoForward,
    currentPageUrl,
    addressValue,
    setAddressValue,
    isAddressEditingRef,
    restoreCurrentPageUrl,
    goBack,
    goForward
  }
}
