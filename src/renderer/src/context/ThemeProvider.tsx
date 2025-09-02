import { usePreference } from '@data/hooks/usePreference'
import { isMac, isWin } from '@renderer/config/constant'
import { useNavbarPosition } from '@renderer/hooks/useNavbar'
import useUserTheme from '@renderer/hooks/useUserTheme'
import { ThemeMode } from '@shared/data/preferenceTypes'
import { IpcChannel } from '@shared/IpcChannel'
import React, { createContext, PropsWithChildren, use, useEffect, useState } from 'react'
interface ThemeContextType {
  theme: ThemeMode
  settedTheme: ThemeMode
  toggleTheme: () => void
  setTheme: (theme: ThemeMode) => void
}

const ThemeContext = createContext<ThemeContextType>({
  theme: ThemeMode.system,
  settedTheme: ThemeMode.dark,
  toggleTheme: () => {},
  setTheme: () => {}
})

interface ThemeProviderProps extends PropsWithChildren {
  defaultTheme?: ThemeMode
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({ children }) => {
  // 用户设置的主题
  // const { theme: settedTheme, setTheme: setSettedTheme } = useSettings()

  const [settedTheme, setSettedTheme] = usePreference('ui.theme_mode')

  const [actualTheme, setActualTheme] = useState<ThemeMode>(
    window.matchMedia('(prefers-color-scheme: dark)').matches ? ThemeMode.dark : ThemeMode.light
  )
  const { initUserTheme } = useUserTheme()
  const { navbarPosition } = useNavbarPosition()

  const toggleTheme = () => {
    const nextTheme = {
      [ThemeMode.light]: ThemeMode.dark,
      [ThemeMode.dark]: ThemeMode.system,
      [ThemeMode.system]: ThemeMode.light
    }[settedTheme]
    setSettedTheme(nextTheme || ThemeMode.system)
  }

  useEffect(() => {
    // Set initial theme and OS attributes on body
    document.body.setAttribute('os', isMac ? 'mac' : isWin ? 'windows' : 'linux')
    document.body.setAttribute('theme-mode', actualTheme)
    document.body.setAttribute('navbar-position', navbarPosition)

    // if theme is old auto, then set theme to system
    // we can delete this after next big release
    if (settedTheme !== ThemeMode.dark && settedTheme !== ThemeMode.light && settedTheme !== ThemeMode.system) {
      setSettedTheme(ThemeMode.system)
    }

    initUserTheme()

    // listen for theme updates from main process
    return window.electron.ipcRenderer.on(IpcChannel.NativeThemeUpdated, (_, actualTheme: ThemeMode) => {
      document.body.setAttribute('theme-mode', actualTheme)
      setActualTheme(actualTheme)
    })
  }, [actualTheme, initUserTheme, navbarPosition, setSettedTheme, settedTheme])

  return (
    <ThemeContext value={{ theme: actualTheme, settedTheme: settedTheme, toggleTheme, setTheme: setSettedTheme }}>
      {children}
    </ThemeContext>
  )
}

export const useTheme = () => use(ThemeContext)
