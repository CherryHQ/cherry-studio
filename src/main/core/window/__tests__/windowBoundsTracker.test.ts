import { application } from '@application'
import type { WindowOptions } from '@main/core/window/types'
import { WindowType } from '@main/core/window/types'
import type { WindowBoundsState } from '@shared/data/cache/cacheValueTypes'
import type { BrowserWindow } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The global main test setup mocks `electron` without `screen.getDisplayMatching`.
// Override it file-locally with a configurable matcher (vi.hoisted avoids the
// temporal-dead-zone trap of referencing a top-level const inside the hoisted
// vi.mock factory). The CacheService comes from the global @application mock.
const { getDisplayMatching } = vi.hoisted(() => ({ getDisplayMatching: vi.fn() }))
vi.mock('electron', () => ({ screen: { getDisplayMatching } }))

const { injectSavedBounds, peekSavedState, persistNow, clearSavedBounds } = await import('../windowBoundsTracker')

// ─── Display fixtures ──────────────────────────────────────────
// PRIMARY at the origin; SECONDARY to its right. workArea is slightly shorter
// than bounds (a 40px taskbar) so "fully inside" vs "clamp" cases are distinct.
const PRIMARY = {
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  workArea: { x: 0, y: 0, width: 1920, height: 1040 }
}
const SECONDARY = {
  bounds: { x: 1920, y: 0, width: 1920, height: 1080 },
  workArea: { x: 1920, y: 0, width: 1920, height: 1040 }
}

const cache = () => application.get('CacheService')

function seedBounds(record: Record<string, WindowBoundsState>): void {
  cache().setPersist('window.bounds', record)
  vi.mocked(cache().setPersist).mockClear()
}

function savedRect(overrides: Partial<WindowBoundsState> = {}): WindowBoundsState {
  return {
    x: 100,
    y: 100,
    width: 800,
    height: 600,
    isMaximized: false,
    displayBounds: PRIMARY.bounds,
    ...overrides
  }
}

function mockWindow(overrides: Partial<Record<keyof BrowserWindow, unknown>> = {}): BrowserWindow {
  return {
    isDestroyed: vi.fn(() => false),
    getNormalBounds: vi.fn(() => ({ x: 50, y: 60, width: 700, height: 500 })),
    isMaximized: vi.fn(() => false),
    ...overrides
  } as unknown as BrowserWindow
}

beforeEach(() => {
  // Clear any window.bounds left by a prior test, then reset spy history.
  cache().setPersist('window.bounds', {})
  vi.clearAllMocks()
})

describe('injectSavedBounds', () => {
  it('restores an in-bounds saved rect verbatim onto its display', () => {
    seedBounds({ [WindowType.Main]: savedRect({ x: 100, y: 100, width: 800, height: 600 }) })
    getDisplayMatching.mockReturnValue(PRIMARY)

    const config: WindowOptions = {}
    injectSavedBounds(WindowType.Main, config)

    expect(getDisplayMatching).toHaveBeenCalledWith(PRIMARY.bounds)
    expect(config).toMatchObject({ x: 100, y: 100, width: 800, height: 600 })
  })

  it('clamps a saved rect that overflows the work area (origin pulled in, size kept if it fits)', () => {
    seedBounds({ [WindowType.Main]: savedRect({ x: 1900, y: 1000, width: 800, height: 600 }) })
    getDisplayMatching.mockReturnValue(PRIMARY)

    const config: WindowOptions = {}
    injectSavedBounds(WindowType.Main, config)

    // width/height fit the 1920x1040 work area, so only the origin is clamped:
    // x: max(1900,0) then min(.,1920-800)=1120; y: max(1000,0) then min(.,1040-600)=440.
    expect(config).toMatchObject({ x: 1120, y: 440, width: 800, height: 600 })
  })

  it('restores onto the nearest surviving display (not the primary origin) when the saved display is gone', () => {
    // Saved on SECONDARY, but it has been unplugged → getDisplayMatching returns PRIMARY.
    seedBounds({
      [WindowType.Main]: savedRect({ x: 2000, y: 100, width: 800, height: 600, displayBounds: SECONDARY.bounds })
    })
    getDisplayMatching.mockReturnValue(PRIMARY)

    const config: WindowOptions = {}
    injectSavedBounds(WindowType.Main, config)

    expect(getDisplayMatching).toHaveBeenCalledWith(SECONDARY.bounds)
    // x is clamped into PRIMARY's work area (1120, not reset to 0); y already fits.
    expect(config).toMatchObject({ x: 1120, y: 100, width: 800, height: 600 })
  })

  it('shrinks a saved rect larger than the work area, then clamps the origin', () => {
    seedBounds({ [WindowType.Main]: savedRect({ x: -50, y: -50, width: 4000, height: 3000 }) })
    getDisplayMatching.mockReturnValue(PRIMARY)

    const config: WindowOptions = {}
    injectSavedBounds(WindowType.Main, config)

    // size shrinks to the work area; origin clamps to its top-left.
    expect(config).toMatchObject({ x: 0, y: 0, width: 1920, height: 1040 })
  })

  it('clamps onto a display positioned LEFT of the primary (negative origin work area)', () => {
    const LEFT = {
      bounds: { x: -1920, y: 0, width: 1920, height: 1080 },
      workArea: { x: -1920, y: 0, width: 1920, height: 1040 }
    }
    seedBounds({
      [WindowType.Main]: savedRect({ x: -3000, y: 100, width: 800, height: 600, displayBounds: LEFT.bounds })
    })
    getDisplayMatching.mockReturnValue(LEFT)

    const config: WindowOptions = {}
    injectSavedBounds(WindowType.Main, config)

    // x clamps to the left display's negative origin (-1920), not 0 — the lower
    // bound is `area.x`, which the placement math must honor for displays left of primary.
    expect(config).toMatchObject({ x: -1920, y: 100, width: 800, height: 600 })
  })

  it('leaves config untouched when there is no saved record', () => {
    getDisplayMatching.mockReturnValue(PRIMARY)
    const config: WindowOptions = { width: 550, height: 400 }
    injectSavedBounds(WindowType.Main, config)
    expect(config).toEqual({ width: 550, height: 400 })
    expect(getDisplayMatching).not.toHaveBeenCalled()
  })

  it.each([
    ['zero width', savedRect({ width: 0 })],
    ['negative height', savedRect({ height: -10 })],
    ['NaN x', savedRect({ x: Number.NaN })],
    // A corrupt/partial displayBounds must be rejected too: injectSavedBounds runs
    // before BrowserWindow construction and feeds it to getDisplayMatching, which
    // would otherwise throw and block the window from opening.
    ['malformed displayBounds', savedRect({ displayBounds: { x: Number.NaN, y: 0, width: 0, height: 0 } })]
  ])('leaves config untouched for invalid saved bounds (%s)', (_label, saved) => {
    seedBounds({ [WindowType.Main]: saved })
    getDisplayMatching.mockReturnValue(PRIMARY)
    const config: WindowOptions = { width: 550, height: 400 }
    injectSavedBounds(WindowType.Main, config)
    expect(config).toEqual({ width: 550, height: 400 })
    expect(getDisplayMatching).not.toHaveBeenCalled()
  })
})

describe('peekSavedState', () => {
  it('returns the saved record for a type', () => {
    const saved = savedRect()
    seedBounds({ [WindowType.Main]: saved })
    expect(peekSavedState(WindowType.Main)).toEqual(saved)
  })

  it('returns undefined when nothing is saved for the type', () => {
    seedBounds({ [WindowType.QuickAssistant]: savedRect() })
    expect(peekSavedState(WindowType.Main)).toBeUndefined()
  })

  it('returns undefined for a corrupt record (so consumers never see a half-valid value)', () => {
    seedBounds({ [WindowType.Main]: savedRect({ displayBounds: { x: Number.NaN, y: 0, width: 0, height: 0 } }) })
    expect(peekSavedState(WindowType.Main)).toBeUndefined()
  })
})

describe('persistNow', () => {
  it('captures normal bounds, maximized flag, and the current display, merging with other types', () => {
    seedBounds({ [WindowType.QuickAssistant]: savedRect({ x: 5, y: 5 }) })
    getDisplayMatching.mockReturnValue(PRIMARY)
    const window = mockWindow({ isMaximized: vi.fn(() => true) })

    persistNow(window, WindowType.Main)

    expect(window.getNormalBounds).toHaveBeenCalled()
    expect(cache().setPersist).toHaveBeenCalledWith('window.bounds', {
      [WindowType.QuickAssistant]: savedRect({ x: 5, y: 5 }),
      [WindowType.Main]: {
        x: 50,
        y: 60,
        width: 700,
        height: 500,
        isMaximized: true,
        displayBounds: PRIMARY.bounds
      }
    })
  })

  it('does nothing for a destroyed window', () => {
    const window = mockWindow({ isDestroyed: vi.fn(() => true) })
    persistNow(window, WindowType.Main)
    expect(cache().setPersist).not.toHaveBeenCalled()
  })
})

describe('clearSavedBounds', () => {
  it("removes only the target type's slot, leaving other types intact", () => {
    const qa = savedRect({ x: 5, y: 5 })
    seedBounds({ [WindowType.Main]: savedRect(), [WindowType.QuickAssistant]: qa })

    clearSavedBounds(WindowType.Main)

    expect(cache().setPersist).toHaveBeenCalledWith('window.bounds', { [WindowType.QuickAssistant]: qa })
  })

  it('is a no-op when the type has no saved slot', () => {
    seedBounds({ [WindowType.QuickAssistant]: savedRect() })
    clearSavedBounds(WindowType.Main)
    expect(cache().setPersist).not.toHaveBeenCalled()
  })
})
