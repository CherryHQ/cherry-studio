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

    vi.advanceTimersByTime(200)

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
    vi.advanceTimersByTime(200)

    expect(saveSpy).toHaveBeenCalledTimes(1)
    expect(service.getPersist(PROBE)).toBe(3)
  })

  it('skips scheduling a write when setting the same value (isEqual)', async () => {
    await initService()
    service.setPersist(PROBE, 5)
    vi.advanceTimersByTime(200)

    const schedSpy = vi.spyOn(service, 'schedulePersistSave')
    service.setPersist(PROBE, 5) // same value — no-op
    expect(schedSpy).not.toHaveBeenCalled()

    service.setPersist(PROBE, 6) // different value schedules a write
    expect(schedSpy).toHaveBeenCalledTimes(1)
  })

  it('reloads persisted values on a fresh service instance', async () => {
    await initService()
    service.setPersist(PROBE, 7)
    vi.advanceTimersByTime(200)
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
    vi.advanceTimersByTime(200)

    expect(BrowserWindow.getAllWindows).not.toHaveBeenCalled()
  })

  it('prunes unknown/stale keys present in the file (fixed-keys contract)', async () => {
    fs.writeFileSync(cacheFile, JSON.stringify({ [PROBE]: 3, 'stale.removed_key': 9 }), 'utf-8')
    await initService()
    expect(service.getPersist(PROBE)).toBe(3)

    // A subsequent save must not re-persist the unknown key.
    service.setPersist(PROBE, 4)
    vi.advanceTimersByTime(200)

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

    expect(() => vi.advanceTimersByTime(200)).not.toThrow() // savePersistSync swallows it
    expect(service.getPersist(PROBE)).toBe(5) // in-memory value intact
  })
})
