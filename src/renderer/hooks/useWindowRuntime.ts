import { cacheService } from '@data/CacheService'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { useAgentSessionAutoRenameSync } from '@renderer/hooks/agent/useSession'
import { useCustomCss } from '@renderer/hooks/useCustomCss'
import { useLanguageSync } from '@renderer/hooks/useLanguageSync'
import useMacTransparentWindow from '@renderer/hooks/useMacTransparentWindow'
import { useTopicAutoRenameSync } from '@renderer/hooks/useTopic'
import { setDayjsLocale } from '@renderer/i18n/resolver'
import { ipcApi, useIpcOn } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { setInlineFilePathHomePath } from '@renderer/utils/filePath'
import { isWin } from '@renderer/utils/platform'
import { defaultLanguage } from '@shared/utils/languages'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('useWindowRuntime')

// A macOS transparent window blends the nav area with the vibrancy behind it; every
// other window uses the opaque sidebar token.
const MAC_TRANSPARENT_NAV_BACKGROUND = 'color-mix(in srgb, var(--background) 55%, transparent)'
const DEFAULT_NAV_BACKGROUND = 'var(--sidebar)'

/**
 * The window runtime shared by every full-chrome window (main + subWindow): the
 * window-level side effects both need, identically. It calls the two hooks the light
 * windows also reuse (`useLanguageSync` / `useCustomCss`) and inlines the concerns
 * only main + subWindow have (dayjs locale, root background, app-path snapshot,
 * fullscreen, topic/agent auto-rename).
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
export function useWindowRuntime(): void {
  const { t } = useTranslation()
  const [language] = usePreference('app.language')
  const [exitFullscreenPref] = usePreference('shortcut.app.fullscreen.exit')
  const enableQuitFullScreen = exitFullscreenPref?.enabled !== false
  const isMacTransparentWindow = useMacTransparentWindow()
  const navBackground = isMacTransparentWindow ? MAC_TRANSPARENT_NAV_BACKGROUND : DEFAULT_NAV_BACKGROUND

  // Also used by the light windows, so these stay as their own reusable hooks.
  useLanguageSync()
  useCustomCss()

  // dayjs locale — only the windows that render localized dates need it.
  useEffect(() => {
    setDayjsLocale(language || navigator.language || defaultLanguage)
  }, [language])

  // Root background (macOS vibrancy / transparent-window aware).
  useEffect(() => {
    window.root.style.background = navBackground
  }, [navBackground])

  // Snapshot app paths into the inline file-path base + resources cache. Mount-time,
  // non-blocking; failure logs rather than throwing.
  useEffect(() => {
    void ipcApi
      .request('app.get_info')
      .then((info) => {
        setInlineFilePathHomePath(info.homePath)
        cacheService.set('app.path.resources', info.resourcesPath)
      })
      .catch((error) => logger.error('Failed to snapshot app paths', error as Error))
  }, [])

  // [Windows] hint toast on entering fullscreen (useIpcOn self-cleans on unmount).
  useIpcOn('window.fullscreen_changed', (isFullscreen) => {
    if (isWin && isFullscreen) {
      toast.info({
        title: t('common.fullscreen'),
        timeout: 3000
      })
    }
  })

  // ESC exits fullscreen (all platforms), gated by the shortcut preference.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!enableQuitFullScreen) return

      if (e.key === 'Escape' && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        void ipcApi.request('window.set_full_screen', false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [enableQuitFullScreen])

  // Each BrowserWindow has its own SWR cache, so both keep their own invalidation.
  useTopicAutoRenameSync()
  useAgentSessionAutoRenameSync()
}
