import { isMac } from '@renderer/config/constant'
import { useSettings } from '@renderer/hooks/useSettings'
import { ThemeMode } from '@renderer/types'
import { IpcChannel } from '@shared/IpcChannel'
import React, { createContext, PropsWithChildren, use, useEffect, useState } from 'react'

const defaultShowTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? ThemeMode.dark : ThemeMode.light
interface ThemeContextType {
  theme: ThemeMode.dark | ThemeMode.light
  settingTheme: ThemeMode
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextType>({
  theme: defaultShowTheme,
  settingTheme: ThemeMode.auto,
  toggleTheme: () => {}
})

interface ThemeProviderProps extends PropsWithChildren {
  defaultTheme?: ThemeMode
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({ children }) => {
  const { settingTheme, setSettingTheme } = useSettings()
  const [showTheme, setShowTheme] = useState(defaultShowTheme)

  const toggleTheme = () => {
    const nextTheme = {
      [ThemeMode.light]: ThemeMode.dark,
      [ThemeMode.dark]: ThemeMode.auto,
      [ThemeMode.auto]: ThemeMode.light
    }[theme]
    setTheme(nextTheme)
  }

  useEffect(() => {
    window.api.setTheme(theme)
  }, [theme])

  useEffect(() => {
    document.body.setAttribute('os', isMac ? 'mac' : 'windows')

    // listen for theme updates from main process
    const cleanup = window.electron.ipcRenderer.on(IpcChannel.ThemeUpdated, (_, updatedTheme: ThemeMode) => {
      document.body.setAttribute('theme-mode', updatedTheme)
      setShowTheme(updatedTheme)
    })

    return cleanup
  }, [])

  return <ThemeContext.Provider value={{ theme: showTheme, theme, toggleTheme }}>{children}</ThemeContext.Provider>
}

export const useTheme = () => use(ThemeContext)
