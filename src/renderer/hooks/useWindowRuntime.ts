import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { cacheService } from '@data/CacheService'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { useAgentSessionAutoRenameSync } from '@renderer/hooks/agent/useSession'
import { useCommandHandler } from '@renderer/hooks/command'
import { useConversationTabTitleChangeSync } from '@renderer/hooks/tab'
import { useBackgroundImage } from '@renderer/hooks/useBackgroundImage'
import { useCustomCss } from '@renderer/hooks/useCustomCss'
import { useLanguageSync } from '@renderer/hooks/useLanguageSync'
import useMacTransparentWindow from '@renderer/hooks/useMacTransparentWindow'
import { useMiniAppListSync } from '@renderer/hooks/useMiniApps'
import { useTopicAutoRenameSync } from '@renderer/hooks/useTopic'
import { useWebSearchFallbackNotice } from '@renderer/hooks/useWebSearchFallbackNotice'
import { setDayjsLocale } from '@renderer/i18n/resolver'
import { ipcApi, useIpcOn } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { setInlineFilePathHomePath } from '@renderer/utils/filePath'
import { isWin } from '@renderer/utils/platform'
import { defaultLanguage } from '@shared/utils/languages'

const logger = loggerService.withContext('useWindowRuntime')

// A macOS transparent window blends the nav area with the vibrancy behind it; every
// other window uses the opaque sidebar token.
const MAC_TRANSPARENT_NAV_BACKGROUND = 'color-mix(in srgb, var(--background) 55%, transparent)'
const DEFAULT_NAV_BACKGROUND = 'var(--sidebar)'

/**
 * The window runtime shared by every full-chrome window (main + subWindow): the
 * window-level side effects both need, identically. It calls the hooks lighter windows
 * also reuse (`useLanguageSync` / `useCustomCss` / `useDayjsLocaleSync` / `useAppPathSnapshot`)
 * and inlines the concerns only main + subWindow have (root background, fullscreen,
 * topic/agent auto-rename).
 *
 * Mount it from a leaf inside the providers but OUTSIDE every `TabRouter`/`<Activity>`
 * — a hidden `<Activity>` subtree destroys effects, so a window-scoped subscription
 * mounted under a tab would drop when that tab is backgrounded.
 *
 * Membership rule: a concern belongs here ONLY if main and subWindow both need it with
 * no per-window difference. Main-only concerns (boot spinner/timer, updater, storage)
 * stay in `MainWindowRuntime`, explicitly OUTSIDE this hook. It takes no config and
 * holds no main-only behavior, so it cannot hide a per-window difference — that is the
 * line between this composition and the retired `useAppInit` grab-bag.
 */
/** dayjs locale — only the windows that render localized dates need it. */
export function useDayjsLocaleSync(): void {
  const [language] = usePreference('app.language')
  useEffect(() => {
    setDayjsLocale(language || navigator.language || defaultLanguage)
  }, [language])
}

/** Snapshot app paths into the inline file-path base + resources cache. Mount-time, non-blocking; failure logs. */
export function useAppPathSnapshot(): void {
  useEffect(() => {
    void ipcApi
      .request('app.get_info')
      .then((info) => {
        setInlineFilePathHomePath(info.homePath)
        cacheService.set('app.path.resources', info.resourcesPath)
      })
      .catch((error) => logger.error('Failed to snapshot app paths', error as Error))
  }, [])
}

export function useWindowRuntime(): void {
  const { t } = useTranslation()
  const [isFullscreen, setIsFullscreen] = useState(false)
  const fullscreenRevision = useRef(0)
  const isMacTransparentWindow = useMacTransparentWindow()
  const navBackground = isMacTransparentWindow ? MAC_TRANSPARENT_NAV_BACKGROUND : DEFAULT_NAV_BACKGROUND

  // Also used by the light windows, so these stay as their own reusable hooks.
  useLanguageSync()
  useWebSearchFallbackNotice()
  useCustomCss()
  useBackgroundImage()
  useDayjsLocaleSync()
  useAppPathSnapshot()

  // Root background (macOS vibrancy / transparent-window aware).
  useEffect(() => {
    window.root.style.background = navBackground
  }, [navBackground])

  // [Windows] hint toast on entering fullscreen (useIpcOn self-cleans on unmount).
  useIpcOn('window.fullscreen_changed', (isFullscreen) => {
    fullscreenRevision.current++
    setIsFullscreen(isFullscreen)
    if (isWin && isFullscreen) {
      toast.info({
        title: t('common.fullscreen'),
        timeout: 3000
      })
    }
  })

  useEffect(() => {
    let active = true
    const revision = fullscreenRevision.current
    void ipcApi
      .request('window.is_full_screen')
      .then((value) => {
        if (active && fullscreenRevision.current === revision) setIsFullscreen(value)
      })
      .catch((error) => logger.error('Failed to query fullscreen state', error as Error))
    return () => {
      active = false
    }
  }, [])

  useCommandHandler('app.fullscreen.exit', () => ipcApi.request('window.set_full_screen', false), {
    allowInKeyboardLayer: true,
    enabled: isFullscreen,
    shouldHandleKeyEvent: (event) => !event.defaultPrevented
  })

  // Each BrowserWindow has its own SWR cache, so both keep their own invalidation.
  useTopicAutoRenameSync()
  useAgentSessionAutoRenameSync()
  // Relabels tabs bound to a renamed conversation, whichever window renamed it.
  useConversationTabTitleChangeSync()

  // Launcher-list convergence after IPC-side writes: exactly once per window,
  // and outside every `<Activity>`.
  useMiniAppListSync()
}
