import { EventEmitter } from 'node:events'

import type { BrowserWindow } from 'electron'
import { nativeTheme } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { syncTitleBarOverlayWithTheme } from '../titleBarOverlay'

function createWindow() {
  const win = new EventEmitter() as EventEmitter & {
    setTitleBarOverlay: ReturnType<typeof vi.fn>
    isDestroyed: () => boolean
  }
  win.setTitleBarOverlay = vi.fn()
  win.isDestroyed = () => false
  return win
}

function emitThemeUpdated() {
  for (const [event, listener] of vi.mocked(nativeTheme.on).mock.calls) {
    if (event === 'updated') listener()
  }
}

describe('syncTitleBarOverlayWithTheme', () => {
  beforeEach(() => {
    vi.mocked(nativeTheme.on).mockClear()
    vi.mocked(nativeTheme.removeListener).mockClear()
    ;(nativeTheme as { shouldUseDarkColors: boolean }).shouldUseDarkColors = false
  })

  // Electron draws the overlay color as-is but uses its RGB (alpha forced opaque) as the inverted
  // glyph color on hover (e.g. Breeze), so it must be invisible yet contrast with the glyph.
  it.each([
    ['light', false],
    ['dark', true]
  ])('keeps hover-inverted glyphs visible in the %s theme', (_name, dark) => {
    ;(nativeTheme as { shouldUseDarkColors: boolean }).shouldUseDarkColors = !dark
    const win = createWindow()
    syncTitleBarOverlayWithTheme(win as unknown as BrowserWindow)

    ;(nativeTheme as { shouldUseDarkColors: boolean }).shouldUseDarkColors = dark
    emitThemeUpdated()
    const { calls } = win.setTitleBarOverlay.mock
    const { color, symbolColor } = calls[calls.length - 1][0]

    const [r, g, b, a] = color.match(/[\d.]+/g).map(Number)
    const glyph = parseInt(symbolColor.slice(1, 3), 16)
    expect(a).toBe(0)
    expect(Math.abs((r + g + b) / 3 - glyph)).toBeGreaterThan(160)
  })

  it('stops following the theme once the window is closed', () => {
    const win = createWindow()
    syncTitleBarOverlayWithTheme(win as unknown as BrowserWindow)
    const listener = vi.mocked(nativeTheme.on).mock.calls[0][1]

    win.emit('closed')

    expect(nativeTheme.removeListener).toHaveBeenCalledWith('updated', listener)
  })
})
