/**
 * Tests for the shared-tier TTL synchronization contract (issue #17050).
 *
 * Covers:
 *  - fix A1: setShared treats expireAt as part of the entry state — an
 *    equal-value write whose TTL moved (add / extend / shorten / remove)
 *    broadcasts the full entry to renderer mirrors but never fires main
 *    value-subscribers; re-setting an EXPIRED entry with the same value is an
 *    absent → value transition (broadcast + subscriber fire).
 *  - fix A2: every Main-origin runtime eviction (getShared / hasShared / GC
 *    sweep / getAllShared / deleteShared-on-expired) physically deletes the
 *    entry and broadcasts exactly one deletion tombstone, so renderer mirrors
 *    (which have no GC of their own) converge; TTL cleanup never fires main
 *    value-subscribers.
 *  - boundaries: the renderer-origin relay path and onStop stay outside the
 *    unified eviction outlet (no double broadcast, no teardown broadcast).
 */
import type { CacheSyncMessage } from '@shared/data/cache/cacheTypes'
import { IpcChannel } from '@shared/IpcChannel'
import type { IpcMainEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Undo the global mock from main.setup.ts — we want the REAL CacheService
vi.unmock('@main/data/CacheService')

// Mock lifecycle decorators so `new CacheService()` works without the container.
// The mocked BaseService captures ipcMain handlers and interval callbacks so
// tests can invoke the relay path and the GC sweep directly.
const ipcListeners = new Map<string, (event: IpcMainEvent, ...args: any[]) => void>()
const ipcHandlers = new Map<string, (event: IpcMainEvent, ...args: any[]) => unknown>()
const intervalCallbacks: Array<() => void> = []

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
    protected registerInterval(callback: () => void) {
      intervalCallbacks.push(callback)
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

// Override electron BrowserWindow with a test-controllable mock.
vi.mock('electron', async () => {
  const actual = await vi.importActual<any>('electron')
  const fakeBrowserWindow: any = vi.fn()
  fakeBrowserWindow.getAllWindows = vi.fn(() => [] as any[])
  fakeBrowserWindow.fromWebContents = vi.fn(() => null)
  return {
    ...actual,
    BrowserWindow: fakeBrowserWindow
  }
})

// JobManager's live keys — the standing consumer of TTL'd main-owned entries.
const STATE_KEY = 'jobs.state.job-1' as const
const PROGRESS_KEY = 'jobs.progress.job-1' as const

const BASE = 1_000_000
const TTL = 60_000

describe('CacheService shared-tier TTL sync', () => {
  let service: any
  let send: ReturnType<typeof vi.fn>
  let now: number

  const lastMessage = (): CacheSyncMessage => send.mock.calls.at(-1)![1] as CacheSyncMessage

  beforeEach(async () => {
    vi.clearAllMocks()
    ipcListeners.clear()
    ipcHandlers.clear()
    intervalCallbacks.length = 0

    now = BASE
    vi.spyOn(Date, 'now').mockImplementation(() => now)

    const { BrowserWindow } = (await import('electron')) as any
    send = vi.fn()
    BrowserWindow.getAllWindows.mockReturnValue([{ isDestroyed: () => false, id: 99, webContents: { send } }])

    const { CacheService } = await import('../CacheService')
    service = new CacheService()
    await service.onInit()
    send.mockClear()
  })

  afterEach(async () => {
    if (service) await service.onStop()
    vi.restoreAllMocks()
  })

  // ---------------------------------------------------------------------------
  // fix A1 — setShared TTL metadata sync
  // ---------------------------------------------------------------------------

  describe('setShared with an equal value (fix A1)', () => {
    it.each([
      ['adds a TTL', undefined, TTL],
      ['extends the TTL', TTL, TTL * 2],
      ['shortens the TTL', TTL, 1_000],
      ['removes the TTL', TTL, undefined]
    ])('broadcasts the full entry once when the write %s', (_label, firstTtl, secondTtl) => {
      service.setShared(PROGRESS_KEY, { progress: 50 }, firstTtl)
      send.mockClear()

      service.setShared(PROGRESS_KEY, { progress: 50 }, secondTtl)

      expect(send).toHaveBeenCalledTimes(1)
      expect(lastMessage()).toEqual({
        type: 'shared',
        key: PROGRESS_KEY,
        value: { progress: 50 },
        expireAt: secondTtl ? now + secondTtl : undefined
      })
    })

    it('does not fire main value-subscribers on a TTL-only update', () => {
      service.setShared(PROGRESS_KEY, { progress: 50 }, TTL)
      const cb = vi.fn()
      service.subscribeSharedChange(PROGRESS_KEY, cb)

      now = BASE + 10_000
      service.setShared(PROGRESS_KEY, { progress: 50 }, TTL) // heartbeat: same value, renewed TTL

      expect(cb).not.toHaveBeenCalled()
      expect(send).toHaveBeenCalledTimes(2) // initial set + TTL-only sync
    })

    it('is a full no-op when value and expireAt are both unchanged', () => {
      service.setShared(PROGRESS_KEY, { progress: 50 }, TTL)
      send.mockClear()

      service.setShared(PROGRESS_KEY, { progress: 50 }, TTL) // same tick → same expireAt

      expect(send).not.toHaveBeenCalled()
    })

    it('treats re-setting an EXPIRED entry with the same value as absent → value (resurrection)', () => {
      service.setShared(PROGRESS_KEY, { progress: 100 }, 1_000)
      const cb = vi.fn()
      service.subscribeSharedChange(PROGRESS_KEY, cb)
      now = BASE + 5_000 // entry expired
      send.mockClear()

      service.setShared(PROGRESS_KEY, { progress: 100 }, 1_000)

      // Full broadcast + subscriber fire with oldValue=undefined — NOT a
      // silent TTL-only sync (would happen if the implementation compared
      // against the raw entry instead of the TTL-aware peek).
      expect(send).toHaveBeenCalledTimes(1)
      expect(lastMessage()).toEqual({
        type: 'shared',
        key: PROGRESS_KEY,
        value: { progress: 100 },
        expireAt: now + 1_000
      })
      expect(cb).toHaveBeenCalledWith({ progress: 100 }, undefined, PROGRESS_KEY)
    })
  })

  // ---------------------------------------------------------------------------
  // fix A2 — unified Main-origin eviction outlet (5 paths)
  // ---------------------------------------------------------------------------

  describe('expired-entry eviction broadcasts a tombstone (fix A2)', () => {
    const expectSingleTombstone = (key: string) => {
      expect(send).toHaveBeenCalledTimes(1)
      expect(lastMessage()).toEqual({ type: 'shared', key, value: undefined })
    }

    beforeEach(() => {
      service.setShared(STATE_KEY, { id: 'job-1', status: 'completed' }, TTL)
      now = BASE + TTL + 1 // entry expired
      send.mockClear()
    })

    it('path 1: getShared on an expired entry', () => {
      expect(service.getShared(STATE_KEY)).toBeUndefined()
      expectSingleTombstone(STATE_KEY)

      // Entry is physically gone — a second read broadcasts nothing more.
      send.mockClear()
      expect(service.getShared(STATE_KEY)).toBeUndefined()
      expect(send).not.toHaveBeenCalled()
    })

    it('path 2: hasShared on an expired entry', () => {
      expect(service.hasShared(STATE_KEY)).toBe(false)
      expectSingleTombstone(STATE_KEY)
    })

    it('path 3: the GC sweep', () => {
      expect(intervalCallbacks.length).toBeGreaterThan(0)
      intervalCallbacks.forEach((run) => run())
      expectSingleTombstone(STATE_KEY)
    })

    it('path 4: getAllShared (renderer init sync)', () => {
      const handler = ipcHandlers.get(IpcChannel.Cache_GetAllShared)!
      const all = handler({} as IpcMainEvent) as Record<string, unknown>

      expect(all[STATE_KEY]).toBeUndefined()
      expectSingleTombstone(STATE_KEY)
    })

    it('path 5: deleteShared hitting an already-expired entry', () => {
      expect(service.deleteShared(STATE_KEY)).toBe(true)
      expectSingleTombstone(STATE_KEY)
    })

    it('deleteShared on a truly absent key broadcasts nothing', () => {
      service.deleteShared('jobs.state.never-existed')
      expect(send).not.toHaveBeenCalled()
    })

    it('TTL eviction never fires main value-subscribers', () => {
      const cb = vi.fn()
      service.subscribeSharedChange(STATE_KEY, cb)

      expect(service.getShared(STATE_KEY)).toBeUndefined()
      intervalCallbacks.forEach((run) => run())

      expect(cb).not.toHaveBeenCalled()
    })

    it('deleteShared on an expired entry does not fire subscribers; on a live entry it still does', () => {
      const cb = vi.fn()
      service.subscribeSharedChange(STATE_KEY, cb)

      service.deleteShared(STATE_KEY) // expired → tombstone only
      expect(cb).not.toHaveBeenCalled()

      service.setShared(STATE_KEY, { id: 'job-1', status: 'running' })
      cb.mockClear()
      service.deleteShared(STATE_KEY) // live → tombstone + subscriber fire
      expect(cb).toHaveBeenCalledWith(undefined, { id: 'job-1', status: 'running' }, STATE_KEY)
    })

    it('JobManager scenario: terminal job entries are tombstoned to every window by the next GC sweep', () => {
      // (state entry from beforeEach is already expired; add the progress twin)
      service.setShared(PROGRESS_KEY, { progress: 100 }, TTL)
      now = BASE + 2 * TTL + 2
      send.mockClear()

      intervalCallbacks.forEach((run) => run())

      const messages = send.mock.calls.map((call) => call[1] as CacheSyncMessage)
      expect(messages).toContainEqual({ type: 'shared', key: STATE_KEY, value: undefined })
      expect(messages).toContainEqual({ type: 'shared', key: PROGRESS_KEY, value: undefined })
      expect(messages).toHaveLength(2)
    })
  })

  // ---------------------------------------------------------------------------
  // A2 boundaries — paths that must NOT use the unified eviction outlet
  // ---------------------------------------------------------------------------

  describe('eviction outlet boundaries', () => {
    it('renderer-origin tombstone relay excludes the sender and is not double-broadcast', async () => {
      const { BrowserWindow } = (await import('electron')) as any
      const senderSend = vi.fn()
      const otherSend = vi.fn()
      BrowserWindow.getAllWindows.mockReturnValue([
        { isDestroyed: () => false, id: 1, webContents: { send: senderSend } },
        { isDestroyed: () => false, id: 2, webContents: { send: otherSend } }
      ])
      BrowserWindow.fromWebContents.mockReturnValue({ id: 1 })

      service.setShared(STATE_KEY, { id: 'job-1', status: 'running' })
      const cb = vi.fn()
      service.subscribeSharedChange(STATE_KEY, cb)
      senderSend.mockClear()
      otherSend.mockClear()

      const listener = ipcListeners.get(IpcChannel.Cache_Sync)!
      listener({ sender: {} } as IpcMainEvent, { type: 'shared', key: STATE_KEY, value: undefined })

      expect(senderSend).not.toHaveBeenCalled() // sender excluded
      expect(otherSend).toHaveBeenCalledTimes(1) // relayed exactly once — no extra eviction broadcast
      expect(cb).toHaveBeenCalledTimes(1)
      expect(cb).toHaveBeenCalledWith(undefined, { id: 'job-1', status: 'running' }, STATE_KEY)
    })

    it('onStop clears entries without broadcasting', async () => {
      service.setShared(STATE_KEY, { id: 'job-1', status: 'running' }, TTL)
      send.mockClear()

      await service.onStop()

      expect(send).not.toHaveBeenCalled()
    })
  })
})
