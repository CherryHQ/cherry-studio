import { type BrowserWindow, nativeTheme, type TitleBarOverlay } from 'electron'

// Glyphs use the `--cs-foreground` light/dark tokens (sRGB). The overlay color stays fully
// transparent so the app's top bar shows through, but Electron reads its RGB (alpha forced
// opaque) as the inverted glyph color on hover for styles like Breeze — so it must contrast.
const LIGHT_THEME_COLORS = { symbolColor: '#191919', color: 'rgba(255, 255, 255, 0)' }
const DARK_THEME_COLORS = { symbolColor: '#e8e8e8', color: 'rgba(25, 25, 25, 0)' }

function getThemeColors(): Pick<TitleBarOverlay, 'color' | 'symbolColor'> {
  return nativeTheme.shouldUseDarkColors ? DARK_THEME_COLORS : LIGHT_THEME_COLORS
}

/**
 * Build the Linux Window Controls Overlay options for a window whose top bar is `height` px tall.
 * @param height - Overlay height in DIPs; match the renderer's title bar height.
 */
export function getLinuxTitleBarOverlay(height: number): TitleBarOverlay {
  return { ...getThemeColors(), height }
}

/**
 * Keep a Linux WCO window's control colors readable across theme switches for its whole lifetime.
 * Only call this for windows created with `titleBarOverlay` — Electron throws otherwise.
 */
export function syncLinuxTitleBarOverlayWithTheme(window: BrowserWindow): void {
  const apply = () => {
    if (!window.isDestroyed()) window.setTitleBarOverlay(getThemeColors())
  }
  apply()
  nativeTheme.on('updated', apply)
  window.once('closed', () => nativeTheme.removeListener('updated', apply))
}
