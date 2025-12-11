import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  CodeOutlined,
  ExportOutlined,
  LinkOutlined,
  MinusOutlined,
  PushpinOutlined,
  ReloadOutlined
} from '@ant-design/icons'
import { loggerService } from '@logger'
import { isDev } from '@renderer/config/constant'
import { DEFAULT_MIN_APPS } from '@renderer/config/minapps'
import { useMinapps } from '@renderer/hooks/useMinapps'
import { useSettings } from '@renderer/hooks/useSettings'
import { useAppDispatch } from '@renderer/store'
import { setMinappsOpenLinkExternal } from '@renderer/store/settings'
import type { MinAppType } from '@renderer/types'
import { Tooltip } from 'antd'
import type { WebviewTag } from 'electron'
import type { FC } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import styled from 'styled-components'

const logger = loggerService.withContext('MinimalToolbar')

// Constants for timing delays
const WEBVIEW_CHECK_INITIAL_MS = 100 // Initial check interval
const WEBVIEW_CHECK_MAX_MS = 1000 // Maximum check interval (1 second)
const WEBVIEW_CHECK_MULTIPLIER = 2 // Exponential backoff multiplier
const WEBVIEW_CHECK_MAX_ATTEMPTS = 30 // Stop after ~30 seconds total
const NAVIGATION_UPDATE_DELAY_MS = 50
const NAVIGATION_COMPLETE_DELAY_MS = 100

interface Props {
  app: MinAppType
  webviewRef: React.RefObject<WebviewTag | null>
  currentUrl: string | null
  onReload: () => void
  onOpenDevTools: () => void
}

const MinimalToolbar: FC<Props> = ({ app, webviewRef, currentUrl, onReload, onOpenDevTools }) => {
  const { t } = useTranslation()
  const { pinned, updatePinnedMinapps } = useMinapps()
  const { minappsOpenLinkExternal } = useSettings()
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const [canGoBack, setCanGoBack] = useState(false)
  const [canGoForward, setCanGoForward] = useState(false)
  const canPinned = DEFAULT_MIN_APPS.some((item) => item.id === app.id)
  const isPinned = pinned.some((item) => item.id === app.id)
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
        logger.debug('WebView not ready for navigation state update', { appId: app.id })
        setCanGoBack(false)
        setCanGoForward(false)
      }
    } else {
      setCanGoBack(false)
      setCanGoForward(false)
    }
  }, [app.id, webviewRef])

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

        logger.debug('Navigation listeners attached', { appId: app.id, attempts: attemptCount })
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
                appId: app.id,
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
                appId: app.id,
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
  }, [app.id, updateNavigationState, scheduleNavigationUpdate]) // webviewRef excluded as it's a ref object

  const handleGoBack = useCallback(() => {
    if (webviewRef.current) {
      try {
        if (webviewRef.current.canGoBack()) {
          webviewRef.current.goBack()
          // Delay update to ensure navigation completes
          scheduleNavigationUpdate(NAVIGATION_COMPLETE_DELAY_MS)
        }
      } catch (error) {
        logger.debug('WebView not ready for navigation', { appId: app.id, action: 'goBack' })
      }
    }
  }, [app.id, webviewRef, scheduleNavigationUpdate])

  const handleGoForward = useCallback(() => {
    if (webviewRef.current) {
      try {
        if (webviewRef.current.canGoForward()) {
          webviewRef.current.goForward()
          // Delay update to ensure navigation completes
          scheduleNavigationUpdate(NAVIGATION_COMPLETE_DELAY_MS)
        }
      } catch (error) {
        logger.debug('WebView not ready for navigation', { appId: app.id, action: 'goForward' })
      }
    }
  }, [app.id, webviewRef, scheduleNavigationUpdate])

  const handleMinimize = useCallback(() => {
    navigate('/apps')
  }, [navigate])

  const handleTogglePin = useCallback(() => {
    const newPinned = isPinned ? pinned.filter((item) => item.id !== app.id) : [...pinned, app]
    updatePinnedMinapps(newPinned)
  }, [app, isPinned, pinned, updatePinnedMinapps])

  const handleToggleOpenExternal = useCallback(() => {
    dispatch(setMinappsOpenLinkExternal(!minappsOpenLinkExternal))
  }, [dispatch, minappsOpenLinkExternal])

  const handleOpenLink = useCallback(() => {
    const urlToOpen = currentUrl || app.url
    window.api.openWebsite(urlToOpen)
  }, [currentUrl, app.url])

  return (
    <ToolbarContainer>
      <LeftSection>
        <ButtonGroup>
          <Tooltip title={t('minapp.popup.goBack')} placement="bottom">
            <ToolbarButton
              onClick={handleGoBack}
              $disabled={!canGoBack}
              aria-label={t('minapp.popup.goBack')}
              aria-disabled={!canGoBack}>
              <ArrowLeftOutlined />
            </ToolbarButton>
          </Tooltip>

          <Tooltip title={t('minapp.popup.goForward')} placement="bottom">
            <ToolbarButton
              onClick={handleGoForward}
              $disabled={!canGoForward}
              aria-label={t('minapp.popup.goForward')}
              aria-disabled={!canGoForward}>
              <ArrowRightOutlined />
            </ToolbarButton>
          </Tooltip>

          <Tooltip title={t('minapp.popup.refresh')} placement="bottom">
            <ToolbarButton onClick={onReload} aria-label={t('minapp.popup.refresh')}>
              <ReloadOutlined />
            </ToolbarButton>
          </Tooltip>
        </ButtonGroup>
      </LeftSection>

      <RightSection>
        <ButtonGroup>
          {canOpenExternalLink && (
            <Tooltip title={t('minapp.popup.openExternal')} placement="bottom">
              <ToolbarButton onClick={handleOpenLink} aria-label={t('minapp.popup.openExternal')}>
                <ExportOutlined />
              </ToolbarButton>
            </Tooltip>
          )}

          {canPinned && (
            <Tooltip
              title={isPinned ? t('minapp.remove_from_launchpad') : t('minapp.add_to_launchpad')}
              placement="bottom">
              <ToolbarButton
                onClick={handleTogglePin}
                $active={isPinned}
                aria-label={isPinned ? t('minapp.remove_from_launchpad') : t('minapp.add_to_launchpad')}
                aria-pressed={isPinned}>
                <PushpinOutlined />
              </ToolbarButton>
            </Tooltip>
          )}

          <Tooltip
            title={
              minappsOpenLinkExternal
                ? t('minapp.popup.open_link_external_on')
                : t('minapp.popup.open_link_external_off')
            }
            placement="bottom">
            <ToolbarButton
              onClick={handleToggleOpenExternal}
              $active={minappsOpenLinkExternal}
              aria-label={
                minappsOpenLinkExternal
                  ? t('minapp.popup.open_link_external_on')
                  : t('minapp.popup.open_link_external_off')
              }
              aria-pressed={minappsOpenLinkExternal}>
              <LinkOutlined />
            </ToolbarButton>
          </Tooltip>

          {isDev && (
            <Tooltip title={t('minapp.popup.devtools')} placement="bottom">
              <ToolbarButton onClick={onOpenDevTools} aria-label={t('minapp.popup.devtools')}>
                <CodeOutlined />
              </ToolbarButton>
            </Tooltip>
          )}

          <Tooltip title={t('minapp.popup.minimize')} placement="bottom">
            <ToolbarButton onClick={handleMinimize} aria-label={t('minapp.popup.minimize')}>
              <MinusOutlined />
            </ToolbarButton>
          </Tooltip>
        </ButtonGroup>
      </RightSection>
    </ToolbarContainer>
  )
}

const ToolbarContainer = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 35px;
  padding: 0 12px;
  background-color: var(--color-background);
  flex-shrink: 0;
`

const LeftSection = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`

const RightSection = styled.div`
  display: flex;
  align-items: center;
`

const ButtonGroup = styled.div`
  display: flex;
  align-items: center;
  gap: 2px;
`

const ToolbarButton = styled.button<{
  $disabled?: boolean
  $active?: boolean
}>`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 4px;
  background: ${({ $active }) => ($active ? 'var(--color-primary-bg)' : 'transparent')};
  color: ${({ $disabled, $active }) =>
    $disabled ? 'var(--color-text-3)' : $active ? 'var(--color-primary)' : 'var(--color-text-2)'};
  cursor: ${({ $disabled }) => ($disabled ? 'default' : 'pointer')};
  transition: all 0.2s ease;
  font-size: 12px;

  &:hover {
    background: ${({ $disabled, $active }) =>
      $disabled ? 'transparent' : $active ? 'var(--color-primary-bg)' : 'var(--color-background-soft)'};
    color: ${({ $disabled, $active }) =>
      $disabled ? 'var(--color-text-3)' : $active ? 'var(--color-primary)' : 'var(--color-text-1)'};
  }

  &:active {
    transform: ${({ $disabled }) => ($disabled ? 'none' : 'scale(0.95)')};
  }
`

export default MinimalToolbar
