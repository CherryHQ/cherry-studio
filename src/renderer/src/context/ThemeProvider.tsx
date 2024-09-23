import { isMac } from '@renderer/config/constant'
import { useSettings } from '@renderer/hooks/useSettings'
import { ThemeMode } from '@renderer/types'
import React, { createContext, PropsWithChildren, useContext, useEffect, useState } from 'react'

interface ThemeContextType {
  theme: ThemeMode
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextType>({
  theme: ThemeMode.light,
  toggleTheme: () => {}
})

export const ThemeProvider: React.FC<PropsWithChildren> = ({ children }) => {
  const { theme, setTheme } = useSettings()
  const [_theme, _setTheme] = useState(theme)

  const toggleTheme = () => {
    setTheme(theme === ThemeMode.dark ? ThemeMode.light : ThemeMode.dark)
  }

  useEffect((): any => {
    if (theme === ThemeMode.auto) {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
      _setTheme(mediaQuery.matches ? ThemeMode.dark : ThemeMode.light)
      const handleChange = (e: MediaQueryListEvent) => _setTheme(e.matches ? ThemeMode.dark : ThemeMode.light)
      mediaQuery.addEventListener('change', handleChange)
      return () => mediaQuery.removeEventListener('change', handleChange)
    } else {
      _setTheme(theme)
    }
  }, [theme])

  useEffect(() => {
    document.body.setAttribute('theme-mode', _theme)
    window.api?.setTheme(_theme === ThemeMode.dark ? 'dark' : 'light')
  }, [_theme])

  useEffect(() => {
    document.body.setAttribute('os', isMac ? 'mac' : 'windows')
  }, [])

  return <ThemeContext.Provider value={{ theme: _theme, toggleTheme }}>{children}</ThemeContext.Provider>
}

export const useTheme = () => useContext(ThemeContext)
