import type { ThemedToken, Theme } from '@pierre/highlights'
import { themes } from '@pierre/highlights/themes/loader'

import { resolveCodeTheme } from './catalog'

const WHITE_COLOR = /^(?:white|#fff|#ffffff|#ffffffff)$/i

export async function loadCodeTheme(name: string, foreground?: string): Promise<Theme> {
  const { default: theme } = await themes[resolveCodeTheme(name)]()
  if (theme.appearance !== 'light' || !foreground) return theme
  return {
    ...theme,
    style: {
      ...theme.style,
      syntax: Object.fromEntries(
        Object.entries(theme.style.syntax ?? {}).map(([scope, settings]) => {
          if (typeof settings === 'string') {
            return [scope, WHITE_COLOR.test(settings) ? foreground : settings]
          }
          return [
            scope,
            settings.color && WHITE_COLOR.test(settings.color) ? { ...settings, color: foreground } : settings
          ]
        })
      )
    }
  }
}

export function getReactStyleFromToken(
  token: ThemedToken,
  options?: { isDarkTheme?: boolean; foreground?: string }
): Record<string, string> {
  const flags = token.fontStyle ?? 0
  const style = token.htmlStyle ?? {
    ...(token.color ? { color: token.color } : {}),
    ...(token.bgColor ? { 'background-color': token.bgColor } : {}),
    ...(flags & 1 ? { 'font-style': 'italic' } : {}),
    ...(flags & 2 ? { 'font-weight': 'bold' } : {}),
    ...(flags & 12
      ? { 'text-decoration': [flags & 4 ? 'underline' : '', flags & 8 ? 'line-through' : ''].filter(Boolean).join(' ') }
      : {})
  }
  return Object.fromEntries(
    Object.entries(style).map(([key, value]) => [
      key.startsWith('--') ? key : key.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase()),
      key === 'color' && !options?.isDarkTheme && options?.foreground && WHITE_COLOR.test(value)
        ? options.foreground
        : value
    ])
  )
}
