import { isMac } from '@renderer/config/constant'
import { useSettings } from '@renderer/hooks/useSettings'
import { ThemeMode } from '@renderer/types'
import { IpcChannel } from '@shared/IpcChannel'
import React, { createContext, PropsWithChildren, use, useEffect, useState } from 'react'

interface ThemeContextType {
  theme: ThemeMode
  settingTheme: ThemeMode
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextType>({
  theme: ThemeMode.auto,
  settingTheme: ThemeMode.auto,
  toggleTheme: () => {}
})

interface ThemeProviderProps extends PropsWithChildren {
  defaultTheme?: ThemeMode
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({ children, defaultTheme }) => {
  const { theme, setTheme } = useSettings()
  const [effectiveTheme, setEffectiveTheme] = useState(theme)

  const toggleTheme = () => {
    // 主题顺序是light, dark, auto, 所以需要先判断当前主题，然后取下一个主题
    const nextTheme =
      theme === ThemeMode.light ? ThemeMode.dark : theme === ThemeMode.dark ? ThemeMode.auto : ThemeMode.light
    setTheme(nextTheme)
  }

  useEffect(() => {
    window.api?.setTheme(defaultTheme || theme)
  }, [defaultTheme, theme])

  useEffect(() => {
    document.body.setAttribute('theme-mode', effectiveTheme)
  }, [effectiveTheme])

  useEffect(() => {
    document.body.setAttribute('os', isMac ? 'mac' : 'windows')
    const themeChangeListenerRemover = window.electron.ipcRenderer.on(
      IpcChannel.ThemeChange,
      (_, realTheam: ThemeMode) => {
        setEffectiveTheme(realTheam)
      }
    )
    return () => {
      themeChangeListenerRemover()
    }
  })

  return <ThemeContext value={{ theme: effectiveTheme, settingTheme: theme, toggleTheme }}>{children}</ThemeContext>
}

export const useTheme = () => use(ThemeContext)
