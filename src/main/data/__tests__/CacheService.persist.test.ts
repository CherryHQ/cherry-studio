/**
 * Tests for the main-process persist cache tier of CacheService.
 *
 * Covers the typed public API round-trip, default fallback, file
 * load/merge/corruption handling, debounced + coalesced atomic writes,
 * isEqual no-op skip, flush-on-stop, and isolation from the IPC relay.
 *
 * Uses a real temp file (authentic temp-then-rename round-trip) plus fake
 * timers to drive the debounce, and points CacheService at the temp path by
 * overriding the globally-mocked `application.getPath`.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { application } from '@application'
import type { IpcMainEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Undo the global mock from main.setup.ts — we want the REAL CacheService.
vi.unmock('@main/data/CacheService')

// Mock lifecycle decorators so `new CacheService()` works without the container.
const ipcListeners = new Map<string, (event: IpcMainEvent, ...args: any[]) => void>()
const ipcHandlers = new Map<string, (event: IpcMainEvent, ...args: any[]) => unknown>()

vi.mock('@main/core/lifecycle', () => ({
  BaseService: class {
    protected ipcOn(channel: string, listener: (event: IpcMainEvent, ...args: any[]) => void) {
      ipcListeners.set(channel, listener)
      return { dispose: () => ipcListeners.delete(channel) }
    }
    protected ipcHandle(channel: string, handler: (event: IpcMainEvent, ...args: any[]) => unknown) {
      ipcHandlers.set(channel, handler)
      return { dispose: () => ipcHandlers.delete(channel) }
    }
    protected registerDisposable(d: unknown) {
      return d
    }
    protected registerInterval() {
      return { dispose: () => {} }
    }
    get isReady() {
      return true
    }
  },
  Injectable: () => () => {},
  ServicePhase: () => () => {},
  DependsOn: () => () => {},
  Phase: { BeforeReady: 'BeforeReady', WhenReady: 'WhenReady' }
}))

// Test-controllable BrowserWindow so we can assert the persist path never broadcasts.
vi.mock('electron', async () => {
  const actual = await vi.importActual<any>('electron')
  const fakeBrowserWindow: any = vi.fn()
  fakeBrowserWindow.getAllWindows = vi.fn(() => [] as any[])
  fakeBrowserWindow.fromWebContents = vi.fn(() => null)
  return { ...actual, BrowserWindow: fakeBrowserWindow }
})

const PROBE = 'internal.persist_probe' as const

describe('CacheService persist tier', () => {
  let service: any
  let tmpDir: string
  let cacheFile: string

  const initService = async () => {
    const { CacheService } = await import('../CacheService')
    service = new CacheService()
    await service.onInit()
  }

  beforeEach(() => {
    vi.useFakeTimers()
    ipcListeners.clear()
    ipcHandlers.clear()
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-persist-'))
    cacheFile = path.join(tmpDir, 'cache.json')
    vi.mocked(application.getPath).mockReturnValue(cacheFile)
  })

  afterEach(async () => {
    if (service) await service.onStop()
    service = undefined
    vi.restoreAllMocks()
    vi.useRealTimers()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns the schema default before anything is set', async () => {
    await initService()
    expect(service.getPersist(PROBE)).toBe(0)
  })

  it('round-trips a value through the typed public API', async () => {
    await initService()
    service.setPersist(PROBE, 42)
    expect(service.getPersist(PROBE)).toBe(42)
    expect(service.hasPersist(PROBE)).toBe(true)
  })

  it('does not write until the debounce elapses, then persists atomically', async () => {
    await initService()
    service.setPersist(PROBE, 7)
    expect(fs.existsSync(cacheFile)).toBe(false) // still debounced

    vi.advanceTimersByTime(350)

    expect(fs.existsSync(cacheFile)).toBe(true)
    expect(fs.existsSync(`${cacheFile}.tmp`)).toBe(false) // temp renamed away
    expect(JSON.parse(fs.readFileSync(cacheFile, 'utf-8'))[PROBE]).toBe(7)
  })

  it('coalesces rapid writes into a single disk flush', async () => {
    await initService()
    const saveSpy = vi.spyOn(service, 'savePersistSync')

    service.setPersist(PROBE, 1)
    service.setPersist(PROBE, 2)
    service.setPersist(PROBE, 3)
    vi.advanceTimersByTime(350)

    expect(saveSpy).toHaveBeenCalledTimes(1)
    expect(service.getPersist(PROBE)).toBe(3)
  })

  it('skips scheduling a write when setting the same value (isEqual)', async () => {
    await initService()
    service.setPersist(PROBE, 5)
    vi.advanceTimersByTime(350)

    const schedSpy = vi.spyOn(service, 'schedulePersistSave')
    service.setPersist(PROBE, 5) // same value — no-op
    expect(schedSpy).not.toHaveBeenCalled()

    service.setPersist(PROBE, 6) // different value schedules a write
    expect(schedSpy).toHaveBeenCalledTimes(1)
  })

  it('reloads persisted values on a fresh service instance', async () => {
    await initService()
    service.setPersist(PROBE, 7)
    vi.advanceTimersByTime(350)
    await service.onStop()

    await initService() // new instance reads the same file
    expect(service.getPersist(PROBE)).toBe(7)
  })

  it('merges an existing file over the schema defaults', async () => {
    fs.writeFileSync(cacheFile, JSON.stringify({ [PROBE]: 99 }), 'utf-8')
    await initService()
    expect(service.getPersist(PROBE)).toBe(99)
  })

  it('falls back to defaults on a corrupt file without throwing', async () => {
    fs.writeFileSync(cacheFile, '{ not valid json', 'utf-8')
    await initService() // loadPersist must swallow the parse error
    expect(service.getPersist(PROBE)).toBe(0)
  })

  it('flushes a pending debounced write on stop', async () => {
    await initService()
    service.setPersist(PROBE, 3)
    expect(fs.existsSync(cacheFile)).toBe(false) // pending

    await service.onStop()
    service = undefined // prevent afterEach double-stop

    expect(fs.existsSync(cacheFile)).toBe(true)
    expect(JSON.parse(fs.readFileSync(cacheFile, 'utf-8'))[PROBE]).toBe(3)
  })

  it('does not broadcast over IPC when persisting', async () => {
    await initService()
    const { BrowserWindow } = await import('electron')
    vi.mocked(BrowserWindow.getAllWindows).mockClear()

    service.setPersist(PROBE, 1)
    vi.advanceTimersByTime(350)

    expect(BrowserWindow.getAllWindows).not.toHaveBeenCalled()
  })

  it('prunes unknown/stale keys present in the file (fixed-keys contract)', async () => {
    fs.writeFileSync(cacheFile, JSON.stringify({ [PROBE]: 3, 'stale.removed_key': 9 }), 'utf-8')
    await initService()
    expect(service.getPersist(PROBE)).toBe(3)

    // A subsequent save must not re-persist the unknown key.
    service.setPersist(PROBE, 4)
    vi.advanceTimersByTime(350)

    const onDisk = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'))
    expect(onDisk).not.toHaveProperty('stale.removed_key')
    expect(onDisk[PROBE]).toBe(4)
  })

  it.each(['5', '"text"', '[1,2,3]', 'null'])(
    'falls back to defaults when the file parses to a non-object (%s)',
    async (raw) => {
      fs.writeFileSync(cacheFile, raw, 'utf-8')
      await initService()
      expect(service.getPersist(PROBE)).toBe(0)
    }
  )

  it('swallows a write failure without throwing and keeps the in-memory value', async () => {
    // Parent of the cache file is a regular file → writeFileSync(`${path}.tmp`) throws ENOTDIR.
    const blocker = path.join(tmpDir, 'blocker')
    fs.writeFileSync(blocker, 'x', 'utf-8')
    vi.mocked(application.getPath).mockReturnValue(path.join(blocker, 'cache.json'))

    await initService() // loadPersist: file absent → defaults, no throw
    service.setPersist(PROBE, 5)

    expect(() => vi.advanceTimersByTime(350)).not.toThrow() // savePersistSync swallows it
    expect(service.getPersist(PROBE)).toBe(5) // in-memory value intact
  })

  // ---------- hasPersist: differs-from-default semantics ----------
  //
  // `hasPersist` answers "has this key been overridden", i.e. does the effective
  // value DIFFER from the schema default — NOT "is the key present in the backing
  // store". Because loadPersist seeds every schema key, store membership is always
  // true and would carry no information.
  describe('hasPersist (differs-from-default)', () => {
    it('is false when the value equals the schema default (never set)', async () => {
      await initService()
      expect(service.hasPersist(PROBE)).toBe(false)
    })

    it('is true once an overriding (non-default) value is set', async () => {
      await initService()
      service.setPersist(PROBE, 42)
      expect(service.hasPersist(PROBE)).toBe(true)
    })

    it('is false when the set value happens to equal the default', async () => {
      await initService()
      service.setPersist(PROBE, 0) // 0 is the schema default
      expect(service.hasPersist(PROBE)).toBe(false)
    })

    it('is false for a file whose stored value equals the default (not "present on disk")', async () => {
      // The discriminating case: old membership-based semantics would report true.
      fs.writeFileSync(cacheFile, JSON.stringify({ [PROBE]: 0 }), 'utf-8')
      await initService()
      expect(service.getPersist(PROBE)).toBe(0)
      expect(service.hasPersist(PROBE)).toBe(false)
    })
  })

  // ---------- deletePersist: reset-to-default semantics ----------
  describe('deletePersist (reset-to-default)', () => {
    it('resets an overridden value back to the schema default', async () => {
      await initService()
      service.setPersist(PROBE, 42)
      service.deletePersist(PROBE)
      expect(service.getPersist(PROBE)).toBe(0)
      expect(service.hasPersist(PROBE)).toBe(false)
    })

    it('schedules a debounced save so the reset reaches disk', async () => {
      await initService()
      service.setPersist(PROBE, 42)
      vi.advanceTimersByTime(350)

      service.deletePersist(PROBE)
      vi.advanceTimersByTime(350)
      expect(JSON.parse(fs.readFileSync(cacheFile, 'utf-8'))[PROBE]).toBe(0)
    })

    it('is a no-op when the value is already the default', async () => {
      await initService()
      const schedSpy = vi.spyOn(service, 'schedulePersistSave')
      service.deletePersist(PROBE) // already default → nothing to drop
      expect(schedSpy).not.toHaveBeenCalled()
    })
  })

  // ---------- subscribePersistChange: main-local change notifications ----------
  //
  // Same model as subscribeChange (internal tier): main-only, never relayed to
  // renderers, fires only on actual value changes.
  describe('subscribePersistChange', () => {
    it('fires with (newValue, oldValue) when a value changes', async () => {
      await initService()
      const cb = vi.fn()
      service.subscribePersistChange(PROBE, cb)

      service.setPersist(PROBE, 42)
      expect(cb).toHaveBeenCalledWith(42, 0)
    })

    it('does not fire when setting the same value (isEqual short-circuit)', async () => {
      await initService()
      service.setPersist(PROBE, 42)
      const cb = vi.fn()
      service.subscribePersistChange(PROBE, cb)

      service.setPersist(PROBE, 42) // same value
      expect(cb).not.toHaveBeenCalled()
    })

    it('fires on deletePersist with the default as the new value', async () => {
      await initService()
      service.setPersist(PROBE, 42)
      const cb = vi.fn()
      service.subscribePersistChange(PROBE, cb)

      service.deletePersist(PROBE)
      expect(cb).toHaveBeenCalledWith(0, 42)
    })

    it('stops firing after unsubscribe', async () => {
      await initService()
      const cb = vi.fn()
      const unsub = service.subscribePersistChange(PROBE, cb)
      unsub()

      service.setPersist(PROBE, 42)
      expect(cb).not.toHaveBeenCalled()
    })

    it('does not retroactively fire for subscribers attached after load', async () => {
      fs.writeFileSync(cacheFile, JSON.stringify({ [PROBE]: 7 }), 'utf-8')
      await initService() // load installs the override silently
      const cb = vi.fn()
      service.subscribePersistChange(PROBE, cb)
      expect(cb).not.toHaveBeenCalled()
    })

    it('does not broadcast over IPC when notifying persist subscribers', async () => {
      await initService()
      const { BrowserWindow } = await import('electron')
      vi.mocked(BrowserWindow.getAllWindows).mockClear()
      service.subscribePersistChange(PROBE, vi.fn())

      service.setPersist(PROBE, 1)
      expect(BrowserWindow.getAllWindows).not.toHaveBeenCalled()
    })
  })

  // ---------- window.bounds: the first real record-typed consumer key ----------
  //
  // Unlike the scalar PROBE, window.bounds is a Record<WindowType, WindowBoundsState>.
  // The windowBoundsTracker "deletes" a single window's slot by rewriting the whole
  // record (the tier has no per-slot delete), so these cases exercise that
  // read / write / rewrite path on a real object-valued key.
  describe('window.bounds (record-typed key)', () => {
    const BOUNDS = 'window.bounds' as const
    const rect = (x: number) => ({
      x,
      y: 0,
      width: 800,
      height: 600,
      isMaximized: false,
      displayBounds: { x: 0, y: 0, width: 1920, height: 1080 }
    })

    it('defaults to an empty record before anything is set', async () => {
      await initService()
      expect(service.getPersist(BOUNDS)).toEqual({})
    })

    it('round-trips a per-type record and reloads it on a fresh instance', async () => {
      await initService()
      service.setPersist(BOUNDS, { main: rect(100), quickAssistant: rect(200) })
      vi.advanceTimersByTime(350)
      await service.onStop()

      await initService() // new instance reads the same file
      expect(service.getPersist(BOUNDS)).toEqual({ main: rect(100), quickAssistant: rect(200) })
    })

    it('persists a slot removal by rewriting the record (leaving other types intact)', async () => {
      await initService()
      service.setPersist(BOUNDS, { main: rect(100), quickAssistant: rect(200) })
      service.setPersist(BOUNDS, { quickAssistant: rect(200) }) // main slot dropped
      vi.advanceTimersByTime(350)

      const onDisk = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'))[BOUNDS]
      expect(onDisk).toEqual({ quickAssistant: rect(200) })
    })

    it('reports hasPersist false for the empty default and true once a record is stored', async () => {
      await initService()
      expect(service.hasPersist(BOUNDS)).toBe(false) // equals the default {}
      service.setPersist(BOUNDS, { main: rect(100) })
      expect(service.hasPersist(BOUNDS)).toBe(true)
    })
  })
})
