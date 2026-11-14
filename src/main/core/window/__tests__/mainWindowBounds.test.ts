import type { Display } from 'electron'
import { screen } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { WindowType, type WindowOptions } from '@main/core/window/types'

import { fitMainWindowBounds, resolveMainWindowOptions } from '../mainWindowBounds'
import { injectSavedBounds } from '../windowBoundsTracker'

vi.mock('electron', () => ({ screen: { getPrimaryDisplay: vi.fn(), getDisplayMatching: vi.fn() } }))

function display(width = 1920, height = 1040, x = 0, y = 0): Display {
  return { bounds: { x, y, width, height }, workArea: { x, y, width, height } } as Display
}

beforeEach(() => {
  vi.mocked(screen.getPrimaryDisplay).mockReturnValue(display())
  vi.mocked(screen.getDisplayMatching).mockReturnValue(display())
  application.get('CacheService').setPersist('window.bounds', {})
})

describe('main window initial bounds', () => {
  it.each([
    [1920, 1040, 1440, 900],
    [1440, 875, 1296, 787],
    [1366, 728, 1229, 655],
    [800, 540, 800, 540],
    [3840, 2120, 1440, 900],
    [900, 1400, 900, 900]
  ])('fits a %i × %i work area', (width, height, expectedWidth, expectedHeight) => {
    vi.mocked(screen.getPrimaryDisplay).mockReturnValue(display(width, height, 40, 25))
    const config: WindowOptions = { width: 1440, height: 900 }
    resolveMainWindowOptions(config)
    expect(config).toEqual({
      x: 40 + Math.floor((width - expectedWidth) / 2),
      y: 25 + Math.floor((height - expectedHeight) / 2),
      width: expectedWidth,
      height: expectedHeight,
      minWidth: Math.min(960, width),
      minHeight: Math.min(600, height),
      maxWidth: width,
      maxHeight: height
    })
  })

  it('preserves a valid remembered size and negative coordinates', () => {
    const secondary = display(1920, 1040, -1920, -1080)
    vi.mocked(screen.getDisplayMatching).mockReturnValue(secondary)
    application.get('CacheService').setPersist('window.bounds', {
      [WindowType.Main]: {
        x: -1800,
        y: -1000,
        width: 1100,
        height: 700,
        isMaximized: false,
        displayBounds: secondary.bounds
      }
    })
    const config: WindowOptions = { width: 1440, height: 900 }
    injectSavedBounds(WindowType.Main, config)
    resolveMainWindowOptions(config)
    expect(config).toMatchObject({ x: -1800, y: -1000, width: 1100, height: 700 })
  })

  it('fits remembered geometry and its minimum size onto a smaller surviving display', () => {
    vi.mocked(screen.getDisplayMatching).mockReturnValue(display(800, 540, -800, 25))
    application.get('CacheService').setPersist('window.bounds', {
      [WindowType.Main]: {
        x: 2000,
        y: 100,
        width: 1600,
        height: 1000,
        isMaximized: true,
        displayBounds: display().bounds
      }
    })
    const config: WindowOptions = { width: 1440, height: 900 }
    injectSavedBounds(WindowType.Main, config)
    resolveMainWindowOptions(config)
    expect(config).toEqual({
      x: -800,
      y: 25,
      width: 800,
      height: 540,
      minWidth: 800,
      minHeight: 540,
      maxWidth: 800,
      maxHeight: 540
    })
  })

  it('uses the larger default when remembered bounds are corrupt', () => {
    application.get('CacheService').setPersist('window.bounds', {
      [WindowType.Main]: { x: NaN, y: 0, width: 0, height: 600, isMaximized: false, displayBounds: display().bounds }
    })
    const config: WindowOptions = { width: 1440, height: 900 }
    injectSavedBounds(WindowType.Main, config)
    resolveMainWindowOptions(config)
    expect(config).toMatchObject({ x: 240, y: 70, width: 1440, height: 900 })
  })

  it('repositions after raising a remembered size to the minimum', () => {
    expect(fitMainWindowBounds({ x: 1700, y: 900, width: 520, height: 300 }, display().workArea)).toEqual({
      x: 960,
      y: 440,
      width: 960,
      height: 600
    })
  })
})
