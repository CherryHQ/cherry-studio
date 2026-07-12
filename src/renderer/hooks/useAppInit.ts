import { cacheService } from '@data/CacheService'
import { usePreference } from '@data/hooks/usePreference'
import { useAgentSessionAutoRenameSync } from '@renderer/hooks/agent/useSession'
import { useTopicAutoRenameSync } from '@renderer/hooks/useTopic'
import i18n, { setDayjsLocale } from '@renderer/i18n/resolver'
import { ipcApi } from '@renderer/ipc'
import { setInlineFilePathHomePath } from '@renderer/utils/filePath'
import { defaultLanguage } from '@shared/utils/languages'
import { useEffect } from 'react'

import useFullScreenNotice from './useFullScreenNotice'
import useNavBackgroundColor from './useNavBackgroundColor'

/**
 * REFACTOR(window-runtime-init) — KNOWN TECH DEBT; awaiting a dedicated refactor. Do NOT extend.
 *
 * A grab-bag of unrelated "mount = behavior" side effects (spinner teardown,
 * i18n/dayjs locale, custom-CSS injection, app-path cache, nav
 * background, fullscreen notice + ESC-to-exit, topic/agent auto-rename sync). This
 * is the same god-component pattern that made the retired full-screen view stack
 * unmaintainable — retiring that stack only RELOCATED these effects here (out of its
 * former `useAppInit` plus the sibling auto-rename/ESC hooks), it did not dissolve
 * them. The name is kept as `useAppInit` on purpose: it is a misnomer — this runs
 * once PER WINDOW (the main, settings and subWindow roots each mount it), not once
 * for "the app" — and that mismatch is the smell flagging the work still to be done.
 *
 * Intended end state: each concern owned by its proper module / init lifecycle
 * instead of lumped into one opaque hook. Until then, mount it from a leaf that sits
 * inside the window's providers, and keep window-specific hooks at their own root
 * (app-update + storage-monitor on main, data-path navigation on settings) rather
 * than adding them here.
 */
export function useAppInit() {
  const [language] = usePreference('app.language')
  const [customCss] = usePreference('ui.custom_css')
  const [exitFullscreenPref] = usePreference('shortcut.app.fullscreen.exit')
  const enableQuitFullScreen = exitFullscreenPref?.enabled !== false

  const navBackgroundColor = useNavBackgroundColor()

  useFullScreenNotice()
  useTopicAutoRenameSync()
  useAgentSessionAutoRenameSync()

  useEffect(() => {
    document.getElementById('spinner')?.remove()
    // Paired with `console.time('init')` in index.html's bootstrap script; a
    // DevTools timer for dev DX, not a production log — loggerService is not apt.
    // eslint-disable-next-line no-restricted-syntax
    console.timeEnd('init')
  }, [])

  useEffect(() => {
    const currentLanguage = language || navigator.language || defaultLanguage
    void i18n.changeLanguage(currentLanguage)
    setDayjsLocale(currentLanguage)
  }, [language])

  useEffect(() => {
    window.root.style.background = navBackgroundColor
  }, [navBackgroundColor])

  useEffect(() => {
    // set app paths
    void window.api.getAppInfo().then((info) => {
      setInlineFilePathHomePath(info.homePath)
      cacheService.set('app.path.resources', info.resourcesPath)
    })
  }, [])

  useEffect(() => {
    let customCssElement = document.getElementById('user-defined-custom-css') as HTMLStyleElement
    if (customCssElement) {
      customCssElement.remove()
    }

    if (customCss) {
      customCssElement = document.createElement('style')
      customCssElement.id = 'user-defined-custom-css'
      customCssElement.textContent = customCss
      document.head.appendChild(customCssElement)
    }
  }, [customCss])

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
}
