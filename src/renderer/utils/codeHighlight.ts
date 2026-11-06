import type { ThemedToken } from '@cherrystudio/ui/code-highlight'
import { loadCodeTheme as loadTheme, getTokenStyle } from '@cherrystudio/ui/code-highlight'

export { CODE_THEME_NAMES, DEFAULT_LANGUAGES, normalizeCodeLanguage } from '@cherrystudio/ui/code-highlight'
export const loadCodeTheme = (name: string) => loadTheme(name, 'var(--foreground)')
export const getReactStyleFromToken = (token: ThemedToken, options?: { isDarkTheme?: boolean }) =>
  getTokenStyle(token, { ...options, foreground: 'var(--foreground)' })
