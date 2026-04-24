import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mutable platform flags — flipped per test via `platform.isMac = true` etc.
const platform = vi.hoisted(() => ({
  isMac: false,
  isWin: false,
  isLinux: false,
  isDev: false
}))
vi.mock('@main/constant', () => platform)

import type { WindowTypeMetadata } from '../types'

const { mergeWindowOptions } = await import('../windowRegistry')
const { WINDOW_TYPE_REGISTRY } = await import('../windowRegistry')
const { WindowType } = await import('../types')

type RegistryEntry = WindowTypeMetadata

// Inject test fixtures into the real registry (isolated by setting unique WindowType keys).
// Using SelectionAction/SelectionToolbar entries already shipped by the registry would couple
// these tests to their current config. Instead, we swap them out for minimal fixtures per test.
const fixtureKey = WindowType.SelectionToolbar // reuse the enum value; we overwrite the entry below

function setFixture(entry: RegistryEntry): void {
  ;(WINDOW_TYPE_REGISTRY as Record<string, RegistryEntry>)[fixtureKey] = entry
}

function resetPlatform(): void {
  platform.isMac = false
  platform.isWin = false
  platform.isLinux = false
}

describe('mergeWindowOptions', () => {
  beforeEach(() => {
    resetPlatform()
  })

  it('returns the baseOptions when no platformOverrides are set', () => {
    setFixture({
      type: fixtureKey,
      lifecycle: 'singleton',
      htmlPath: 'x.html',
      windowOptions: { width: 100, height: 200 }
    })
    platform.isMac = true

    const result = mergeWindowOptions(fixtureKey)

    expect(result.width).toBe(100)
    expect(result.height).toBe(200)
    expect('platformOverrides' in result).toBe(false)
  })

  it('applies the mac branch of platformOverrides when isMac is true', () => {
    setFixture({
      type: fixtureKey,
      lifecycle: 'singleton',
      htmlPath: 'x.html',
      windowOptions: {
        width: 100,
        height: 200,
        platformOverrides: {
          mac: { width: 999, frame: false },
          win: { width: 555 },
          linux: { width: 333 }
        }
      }
    })
    platform.isMac = true

    const result = mergeWindowOptions(fixtureKey)

    expect(result.width).toBe(999)
    expect(result.frame).toBe(false)
    expect(result.height).toBe(200)
  })

  it('applies the win branch when isWin is true', () => {
    setFixture({
      type: fixtureKey,
      lifecycle: 'singleton',
      htmlPath: 'x.html',
      windowOptions: {
        width: 100,
        platformOverrides: {
          mac: { width: 999 },
          win: { width: 555, focusable: false }
        }
      }
    })
    platform.isWin = true

    const result = mergeWindowOptions(fixtureKey)

    expect(result.width).toBe(555)
    expect(result.focusable).toBe(false)
  })

  it('applies the linux branch when isLinux is true', () => {
    setFixture({
      type: fixtureKey,
      lifecycle: 'singleton',
      htmlPath: 'x.html',
      windowOptions: {
        width: 100,
        platformOverrides: {
          linux: { width: 333 }
        }
      }
    })
    platform.isLinux = true

    const result = mergeWindowOptions(fixtureKey)

    expect(result.width).toBe(333)
  })

  it('leaves the baseOptions unchanged when no override matches the current platform', () => {
    setFixture({
      type: fixtureKey,
      lifecycle: 'singleton',
      htmlPath: 'x.html',
      windowOptions: {
        width: 100,
        platformOverrides: {
          mac: { width: 999 }
          // no win/linux — on Windows the baseOptions wins
        }
      }
    })
    platform.isWin = true

    const result = mergeWindowOptions(fixtureKey)

    expect(result.width).toBe(100)
  })

  it('strips platformOverrides from the returned config (never leaks to BrowserWindow)', () => {
    setFixture({
      type: fixtureKey,
      lifecycle: 'singleton',
      htmlPath: 'x.html',
      windowOptions: {
        width: 100,
        platformOverrides: {
          mac: { frame: false }
        }
      }
    })
    platform.isMac = true

    const result = mergeWindowOptions(fixtureKey)

    expect('platformOverrides' in result).toBe(false)
  })

  it('deep-merges webPreferences across base, platform base, caller, and caller platform', () => {
    setFixture({
      type: fixtureKey,
      lifecycle: 'singleton',
      htmlPath: 'x.html',
      windowOptions: {
        webPreferences: { contextIsolation: true, nodeIntegration: false },
        platformOverrides: {
          mac: {
            webPreferences: { backgroundThrottling: false }
          }
        }
      }
    })
    platform.isMac = true

    const result = mergeWindowOptions(fixtureKey, {
      webPreferences: { devTools: true },
      platformOverrides: {
        mac: { webPreferences: { nodeIntegration: true } }
      }
    })

    // All four sources combined; caller-platform wins on key collisions.
    expect(result.webPreferences).toEqual({
      contextIsolation: true,
      nodeIntegration: true,
      backgroundThrottling: false,
      devTools: true
    })
  })

  it('applies caller overrides over baseConfig, and caller.platformOverrides over all', () => {
    setFixture({
      type: fixtureKey,
      lifecycle: 'singleton',
      htmlPath: 'x.html',
      windowOptions: {
        width: 100,
        height: 200,
        platformOverrides: {
          mac: { width: 999 }
        }
      }
    })
    platform.isMac = true

    const result = mergeWindowOptions(fixtureKey, {
      width: 500, // overrides base
      platformOverrides: {
        mac: { height: 777 } // overrides base-platform's absence; wins over caller's width since
        // caller-platform is applied after caller (we only put height here, so width stays 500)
      }
    })

    expect(result.width).toBe(500)
    expect(result.height).toBe(777)
  })
})

describe('settings window registry', () => {
  it('declares the settings window as a manually shown singleton popup', () => {
    const settings = WINDOW_TYPE_REGISTRY[WindowType.Settings]

    expect(settings).toMatchObject({
      type: WindowType.Settings,
      lifecycle: 'singleton',
      htmlPath: 'settings.html',
      showMode: 'manual',
      behavior: expect.objectContaining({ closeToHide: true })
    })
    expect(settings?.windowOptions.title).toBeUndefined()
  })
})
