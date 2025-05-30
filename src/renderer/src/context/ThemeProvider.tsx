import { isMac } from '@renderer/config/constant'
import useUserTheme from '@renderer/hooks/useUserTheme'
import { useSettings } from '@renderer/hooks/useSettings'
import { ThemeMode } from '@renderer/types'
import { IpcChannel } from '@shared/IpcChannel'
import React, { createContext, PropsWithChildren, use, useEffect, useState } from 'react'

interface ThemeContextType {
  theme: ThemeMode
  actualTheme: ThemeMode
  toggleTheme: () => void
  setTheme: (theme: ThemeMode) => void
}

const ThemeContext = createContext<ThemeContextType>({
  theme: ThemeMode.system,
  actualTheme: ThemeMode.dark,
  toggleTheme: () => {},
  setTheme: () => {}
})

interface ThemeProviderProps extends PropsWithChildren {
  defaultTheme?: ThemeMode
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({ children }) => {
  const { theme, setTheme } = useSettings()
  const [actualTheme, setActualTheme] = useState(
    window.matchMedia('(prefers-color-scheme: dark)').matches ? ThemeMode.dark : ThemeMode.light
  )
  const { initUserTheme } = useUserTheme()

  const toggleTheme = () => {
    const nextTheme = {
      [ThemeMode.light]: ThemeMode.dark,
      [ThemeMode.dark]: ThemeMode.system,
      [ThemeMode.system]: ThemeMode.light
    }[theme]
    setTheme(nextTheme || ThemeMode.system)
  }

  useEffect(() => {
    // Set initial theme and OS attributes on body
    document.body.setAttribute('os', isMac ? 'mac' : 'windows')
    document.body.setAttribute('theme-mode', actualTheme)

    // if theme is old auto, then set theme to system
    // we can delete this after next big release
    if (theme !== ThemeMode.dark && theme !== ThemeMode.light && theme !== ThemeMode.system) {
      setTheme(ThemeMode.system)
    }

    initUserTheme()

    // listen for theme updates from main process
    const cleanup = window.electron.ipcRenderer.on(IpcChannel.ThemeUpdated, (_, actualTheme: ThemeMode) => {
      document.body.setAttribute('theme-mode', actualTheme)
      setActualTheme(actualTheme)
    })

    return cleanup
  }, [])

  useEffect(() => {
    window.api.setTheme(theme)
  }, [theme])

  return <ThemeContext value={{ theme, actualTheme, toggleTheme, setTheme }}>{children}</ThemeContext>
}

export const useTheme = () => use(ThemeContext)
