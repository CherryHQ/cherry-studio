import { isMac, isWin } from '@renderer/config/constant'
import { useNavbarPosition, useSettings } from '@renderer/hooks/useSettings'
import useUserTheme from '@renderer/hooks/useUserTheme'
import { ThemeMode } from '@renderer/types'
import { IpcChannel } from '@shared/IpcChannel'
import React, { createContext, PropsWithChildren, use, useEffect, useState } from 'react'

interface ThemeContextType {
  theme: ThemeMode
  settedTheme: ThemeMode
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextType>({
  theme: ThemeMode.system,
  settedTheme: ThemeMode.dark,
  toggleTheme: () => {}
})

interface ThemeProviderProps extends PropsWithChildren {
  defaultTheme?: ThemeMode
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({ children }) => {
  // 用户设置的主题
  const { theme: settedTheme, setTheme: setSettedTheme } = useSettings()
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
    return window.electron.ipcRenderer.on(IpcChannel.ThemeUpdated, (_, actualTheme: ThemeMode) => {
      document.body.setAttribute('theme-mode', actualTheme)
      setActualTheme(actualTheme)
    })
  }, [actualTheme, initUserTheme, navbarPosition, setSettedTheme, settedTheme])

  useEffect(() => {
    window.api.setTheme(settedTheme)
  }, [settedTheme])

  return <ThemeContext value={{ theme: actualTheme, settedTheme, toggleTheme }}>{children}</ThemeContext>
}

export const useTheme = () => use(ThemeContext)
