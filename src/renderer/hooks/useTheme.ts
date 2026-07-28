import { ThemeMode } from '@shared/data/preference/preferenceTypes'
import { createContext, use } from 'react'

interface ThemeContextType {
  theme: ThemeMode
  settedTheme: ThemeMode
  toggleTheme: () => void
  setTheme: (theme: ThemeMode) => void
}

export const ThemeContext = createContext<ThemeContextType>({
  theme: ThemeMode.system,
  settedTheme: ThemeMode.dark,
  toggleTheme: () => {},
  setTheme: () => {}
})

export const useTheme = () => use(ThemeContext)
