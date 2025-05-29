import { isMac } from '@renderer/config/constant'
import { useSettings } from '@renderer/hooks/useSettings'
import { ThemeMode } from '@renderer/types'
import { IpcChannel } from '@shared/IpcChannel'
import React, { createContext, PropsWithChildren, use, useEffect, useState } from 'react'

const defaultTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? ThemeMode.dark : ThemeMode.light
interface ThemeContextType {
  theme: ThemeMode
  actualTheme: ThemeMode
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextType>({
  theme: ThemeMode.system,
  actualTheme: defaultTheme,
  toggleTheme: () => {}
})

interface ThemeProviderProps extends PropsWithChildren {
  defaultTheme?: ThemeMode
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({ children }) => {
  const { theme, setTheme } = useSettings()
  const [actualTheme, setActualTheme] = useState(defaultTheme)

  const toggleTheme = () => {
    const nextTheme = {
      [ThemeMode.light]: ThemeMode.dark,
      [ThemeMode.dark]: ThemeMode.system,
      [ThemeMode.system]: ThemeMode.light
    }[theme]
    setTheme(nextTheme)
  }

  useEffect(() => {
    window.api.setTheme(theme)
  }, [theme])

  useEffect(() => {
    document.body.setAttribute('os', isMac ? 'mac' : 'windows')

    // listen for theme updates from main process
    const cleanup = window.electron.ipcRenderer.on(IpcChannel.ThemeUpdated, (_, actualTheme: ThemeMode) => {
      document.body.setAttribute('theme-mode', actualTheme)
      setActualTheme(actualTheme)
    })

    return cleanup
  }, [])

  return <ThemeContext value={{ theme, actualTheme, toggleTheme }}>{children}</ThemeContext>
}

export const useTheme = () => use(ThemeContext)
