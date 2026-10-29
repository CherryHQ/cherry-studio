import type { ThemedToken, Theme } from '@pierre/highlights'
import { themes } from '@pierre/highlights/themes/loader'

import { resolveCodeTheme } from './catalog'

const WHITE_COLOR = /^(?:white|#fff|#ffffff|#ffffffff)$/i

export const CHERRY_CODE_THEME = 'cherry'

/**
 * The default code theme. Colors are `--cherry-code-*` suffixes that `product.css` resolves per app mode;
 * `defaults` repeat the light values so HTML exported without application CSS stays colored.
 */
export const cherryCodeTheme: Theme = {
  name: CHERRY_CODE_THEME,
  appearance: 'light',
  cssVariables: {
    prefix: '--cherry-code-',
    defaults: {
      background: 'transparent',
      foreground: 'oklch(0.213 0 0)',
      muted: 'oklch(0.556 0 0)',
      selection: 'oklch(0.54 0.215 263 / 0.2)',
      keyword: 'oklch(0.49 0.242 292)',
      string: 'oklch(0.5 0.104 166)',
      constant: 'oklch(0.55 0.145 49)',
      type: 'oklch(0.52 0.093 223)',
      function: 'oklch(0.54 0.215 263)',
      tag: 'oklch(0.52 0.199 17)',
      link: 'oklch(0.54 0.215 263)',
      inserted: 'oklch(0.52 0.137 150)',
      deleted: 'oklch(0.58 0.214 27)'
    }
  },
  style: {
    'editor.foreground': 'foreground',
    'editor.background': 'background',
    players: [{ cursor: 'foreground', selection: 'selection' }],
    syntax: {
      attribute: 'constant',
      boolean: 'constant',
      comment: { color: 'muted', font_style: 'italic' },
      constant: 'constant',
      constructor: 'type',
      'diff.minus': 'deleted',
      'diff.plus': 'inserted',
      emphasis: { color: 'foreground', font_style: 'italic' },
      'emphasis.strong': { color: 'foreground', font_weight: 700 },
      enum: 'type',
      error: 'deleted',
      function: 'function',
      hint: 'muted',
      keyword: 'keyword',
      label: 'keyword',
      link_text: 'link',
      link_uri: 'link',
      namespace: 'type',
      number: 'constant',
      operator: 'foreground',
      predictive: 'muted',
      preproc: 'keyword',
      property: 'foreground',
      punctuation: 'muted',
      selector: 'tag',
      'selector.class': 'type',
      string: 'string',
      'string.escape': 'constant',
      'string.special.symbol': 'constant',
      tag: 'tag',
      'tag.component.jsx': 'type',
      'text.literal': 'string',
      title: { color: 'foreground', font_weight: 700 },
      type: 'type',
      variable: 'foreground',
      'variable.special': 'keyword',
      variant: 'type'
    }
  }
}

export async function loadCodeTheme(name: string, foreground?: string): Promise<Theme> {
  if (name === CHERRY_CODE_THEME) return cherryCodeTheme
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
