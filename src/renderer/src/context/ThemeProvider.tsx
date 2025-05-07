import { isMac } from '@renderer/config/constant'
import { useSettings } from '@renderer/hooks/useSettings'
import useUserTheme from '@renderer/hooks/useUserTheme'
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
  const { initUserTheme } = useUserTheme()

  const toggleTheme = () => {
    // 主题顺序是light, dark, auto, 所以需要先判断当前主题，然后取下一个主题
    switch (theme) {
      case ThemeMode.light:
        setTheme(ThemeMode.dark)
        break
      case ThemeMode.dark:
        setTheme(ThemeMode.auto)
        break
      case ThemeMode.auto:
        setTheme(ThemeMode.light)
        break
    }
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

  useEffect(() => {
    initUserTheme()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <ThemeContext value={{ theme: effectiveTheme, settingTheme: theme, toggleTheme }}>{children}</ThemeContext>
}

export const useTheme = () => use(ThemeContext)
