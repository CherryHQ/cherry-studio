import type { PropsWithChildren } from 'react'
import React, { useEffect, useState } from 'react'

import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { ThemeContext } from '@renderer/hooks/useTheme'
import useUserTheme from '@renderer/hooks/useUserTheme'
import { ipcApi, useIpcOn } from '@renderer/ipc'
import { isMac, isWin } from '@renderer/utils/platform'
import { ThemeMode } from '@shared/data/preference/preferenceTypes'

interface ThemeProviderProps extends PropsWithChildren {
  defaultTheme?: ThemeMode
}

const logger = loggerService.withContext('ThemeProvider')
const THEME_PREFERENCE_OPTIONS = { optimistic: false } as const

const tailwindThemeChange = (theme: ThemeMode) => {
  const root = window.document.documentElement
  root.classList.remove('light', 'dark')
  root.classList.add(theme)
}

const getSystemTheme = () =>
  window.matchMedia('(prefers-color-scheme: dark)').matches ? ThemeMode.dark : ThemeMode.light

export const ThemeProvider: React.FC<ThemeProviderProps> = ({ children }) => {
  const [settedTheme, setSettedTheme] = usePreference('ui.theme_mode', THEME_PREFERENCE_OPTIONS)
  const [language] = usePreference('app.language')

  // Derive the first frame from the saved theme — the entry points await the preference
  // preload before rendering, so waiting for the sync-up effect below would commit one
  // OS-theme frame first (a visible flash when the saved theme differs from the OS).
  const [actualTheme, setActualTheme] = useState<ThemeMode>(() =>
    settedTheme === ThemeMode.light || settedTheme === ThemeMode.dark ? settedTheme : getSystemTheme()
  )
  const { initUserTheme } = useUserTheme()

  // listen for theme updates from main process
  useIpcOn('system.native_theme_updated', (actualTheme) => setActualTheme(actualTheme))

  const toggleTheme = () => {
    const nextTheme = {
      [ThemeMode.light]: ThemeMode.dark,
      [ThemeMode.dark]: ThemeMode.system,
      [ThemeMode.system]: ThemeMode.light
    }[settedTheme]
    void setSettedTheme(nextTheme || ThemeMode.system)
  }

  useEffect(() => {
    // Set initial theme and OS attributes on body
    document.body.setAttribute('os', isMac ? 'mac' : isWin ? 'windows' : 'linux')
    if (actualTheme === ThemeMode.dark) {
      document.body.classList.remove('light')
      document.body.classList.add('dark')
    } else {
      document.body.classList.remove('dark')
      document.body.classList.add('light')
    }
    document.documentElement.lang = language || navigator.language

    // if theme is old auto, then set theme to system
    // we can delete this after next big release
    if (settedTheme !== ThemeMode.dark && settedTheme !== ThemeMode.light && settedTheme !== ThemeMode.system) {
      void setSettedTheme(ThemeMode.system)
    }

    initUserTheme()
  }, [actualTheme, initUserTheme, language, setSettedTheme, settedTheme])

  useEffect(() => {
    tailwindThemeChange(actualTheme)
  }, [actualTheme])

  useEffect(() => {
    if (settedTheme === ThemeMode.light || settedTheme === ThemeMode.dark) {
      setActualTheme(settedTheme)
      return
    }

    if (settedTheme !== ThemeMode.system) {
      return
    }

    let active = true
    void ipcApi
      .request('system.get_native_theme')
      .then((theme) => {
        if (active) {
          setActualTheme(theme)
        }
      })
      .catch((error) => logger.error('Failed to resolve system theme', error as Error))

    return () => {
      active = false
    }
  }, [settedTheme])

  return (
    <ThemeContext value={{ theme: actualTheme, settedTheme: settedTheme, toggleTheme, setTheme: setSettedTheme }}>
      {children}
    </ThemeContext>
  )
}
