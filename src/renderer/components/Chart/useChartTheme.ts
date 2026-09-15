import { useMemo, useSyncExternalStore } from 'react'

export interface ChartTheme {
  background: string
  border: string
  colors: string[]
  foregroundTertiary: string
  muted: string
  mutedForeground: string
  popover: string
  popoverForeground: string
}

const COLOR_TOKENS = {
  background: '--background',
  border: '--border',
  colors: ['--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5'],
  foregroundTertiary: '--foreground-tertiary',
  muted: '--muted',
  mutedForeground: '--muted-foreground',
  popover: '--popover',
  popoverForeground: '--popover-foreground'
} as const

const THEME_TOKENS = [
  COLOR_TOKENS.background,
  COLOR_TOKENS.border,
  ...COLOR_TOKENS.colors,
  COLOR_TOKENS.foregroundTertiary,
  COLOR_TOKENS.muted,
  COLOR_TOKENS.mutedForeground,
  COLOR_TOKENS.popover,
  COLOR_TOKENS.popoverForeground
] as const

type ThemeToken = (typeof THEME_TOKENS)[number]

function resolveColor(context: CanvasRenderingContext2D, value: string): string {
  context.clearRect(0, 0, 1, 1)
  context.fillStyle = value
  context.fillRect(0, 0, 1, 1)
  const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data
  return `rgba(${red}, ${green}, ${blue}, ${alpha / 255})`
}

function readThemeSnapshot(): string {
  const styles = getComputedStyle(document.documentElement)
  const values = Object.fromEntries(THEME_TOKENS.map((token) => [token, styles.getPropertyValue(token).trim()]))
  return JSON.stringify(values)
}

function subscribeToThemeTokens(onStoreChange: () => void): () => void {
  const observer = new MutationObserver(onStoreChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] })
  return () => observer.disconnect()
}

function createChartTheme(snapshot: string): ChartTheme {
  const values = JSON.parse(snapshot) as Record<ThemeToken, string>
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const context = canvas.getContext('2d')
  const resolveToken = context
    ? (token: ThemeToken) => resolveColor(context, values[token])
    : (token: ThemeToken) => values[token]

  return {
    background: resolveToken(COLOR_TOKENS.background),
    border: resolveToken(COLOR_TOKENS.border),
    colors: COLOR_TOKENS.colors.map(resolveToken),
    foregroundTertiary: resolveToken(COLOR_TOKENS.foregroundTertiary),
    muted: resolveToken(COLOR_TOKENS.muted),
    mutedForeground: resolveToken(COLOR_TOKENS.mutedForeground),
    popover: resolveToken(COLOR_TOKENS.popover),
    popoverForeground: resolveToken(COLOR_TOKENS.popoverForeground)
  }
}

export function useChartTheme(): ChartTheme {
  const snapshot = useSyncExternalStore(subscribeToThemeTokens, readThemeSnapshot)
  return useMemo(() => createChartTheme(snapshot), [snapshot])
}
