/**
 * Tests for CacheService subscription APIs and value-equality semantics.
 *
 * Covers:
 *  - subscribeChange (internal cache, exact key only)
 *  - subscribeSharedChange (shared cache, exact + template)
 *  - isEqual short-circuit on all 5 mutation points
 *  - IPC-origin writes fire main-process subscribers
 *  - Re-entrance, error isolation, Set-iteration safety
 *  - Lifecycle cleanup on onStop
 */
import { IpcChannel } from '@shared/IpcChannel'
import type { IpcMainEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Undo the global mock from main.setup.ts — we want the REAL CacheService
vi.unmock('@main/data/CacheService')

// Mock lifecycle decorators so `new CacheService()` works without the container.
// The mocked BaseService captures ipcMain handlers we can invoke directly.
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
// The global electron mock already makes BrowserWindow a vi.fn — we just need
// getAllWindows/fromWebContents as static helpers.
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

const SHARED_EXACT = 'web_search.provider.last_used_key.google' as const
const SHARED_OTHER = 'web_search.provider.last_used_key.openrouter' as const
const SHARED_TEMPLATE = 'web_search.provider.last_used_key.${providerId}' as const

describe('CacheService subscription', () => {
  let service: any

  beforeEach(async () => {
    vi.clearAllMocks()
    ipcListeners.clear()
    ipcHandlers.clear()

    const { CacheService } = await import('../CacheService')
    service = new CacheService()
    await service.onInit()
  })

  afterEach(async () => {
    if (service) await service.onStop()
    vi.restoreAllMocks()
  })

  // ---------------------------------------------------------------------------
  // Internal cache (subscribeChange)
  // ---------------------------------------------------------------------------

  describe('subscribeChange (internal cache)', () => {
    it('fires with (newValue, oldValue) on set', () => {
      const cb = vi.fn()
      service.subscribeChange('k1', cb)
      service.set('k1', 'a')
      expect(cb).toHaveBeenCalledWith('a', undefined)

      service.set('k1', 'b')
      expect(cb).toHaveBeenLastCalledWith('b', 'a')
    })

    it('does not fire when new value deep-equals existing value', () => {
      const cb = vi.fn()
      service.set('k1', { a: 1, b: [1, 2] })
      service.subscribeChange('k1', cb)
      service.set('k1', { a: 1, b: [1, 2] }) // new reference, same content
      expect(cb).not.toHaveBeenCalled()
    })

    it('does not fire on TTL-only refresh', () => {
      const cb = vi.fn()
      service.set('k1', 'v', 1000)
      service.subscribeChange('k1', cb)
      service.set('k1', 'v', 5000) // same value, different TTL
      expect(cb).not.toHaveBeenCalled()
    })

    it('fires on delete with newValue=undefined', () => {
      const cb = vi.fn()
      service.set('k1', 'v')
      service.subscribeChange('k1', cb)
      service.delete('k1')
      expect(cb).toHaveBeenCalledWith(undefined, 'v')
    })

    it('does not fire when delete target never existed', () => {
      const cb = vi.fn()
      service.subscribeChange('absent', cb)
      service.delete('absent')
      expect(cb).not.toHaveBeenCalled()
    })

    it('does not fire immediately on subscribe (consumer must call get)', () => {
      const cb = vi.fn()
      service.set('k1', 'v')
      service.subscribeChange('k1', cb)
      expect(cb).not.toHaveBeenCalled()
    })

    it('stops firing after unsubscribe', () => {
      const cb = vi.fn()
      const unsub = service.subscribeChange('k1', cb)
      service.set('k1', 'a')
      unsub()
      service.set('k1', 'b')
      expect(cb).toHaveBeenCalledTimes(1)
    })

    it('isolates a throwing callback from other subscribers', async () => {
      const { mockMainLoggerService } = await import('../../../../tests/__mocks__/MainLoggerService')
      const logger = mockMainLoggerService.withContext()
      const errorSpy = vi.spyOn(logger, 'error')

      const bad = vi.fn(() => {
        throw new Error('boom')
      })
      const good = vi.fn()
      service.subscribeChange('k1', bad)
      service.subscribeChange('k1', good)

      service.set('k1', 'v')

      expect(bad).toHaveBeenCalled()
      expect(good).toHaveBeenCalledWith('v', undefined)
      expect(errorSpy).toHaveBeenCalled()
      const firstErrorMsg = errorSpy.mock.calls[0][0] as string
      expect(firstErrorMsg).toContain('k1')
    })

    it('callback unsubscribing itself during fire does not break other callbacks', () => {
      const seen: string[] = []
      let unsubA: () => void = () => {}
      const a = vi.fn(() => {
        seen.push('a')
        unsubA()
      })
      const b = vi.fn(() => seen.push('b'))
      unsubA = service.subscribeChange('k1', a)
      service.subscribeChange('k1', b)

      service.set('k1', 'v')
      expect(seen).toEqual(['a', 'b'])

      service.set('k1', 'w')
      // 'a' should not fire again after it unsubscribed itself
      expect(a).toHaveBeenCalledTimes(1)
      expect(b).toHaveBeenCalledTimes(2)
    })
  })

  // ---------------------------------------------------------------------------
  // Shared cache — exact key
  // ---------------------------------------------------------------------------

  describe('subscribeSharedChange (exact keys)', () => {
    it('fires on setShared and deleteShared', () => {
      const cb = vi.fn()
      service.subscribeSharedChange(SHARED_EXACT, cb)

      service.setShared(SHARED_EXACT, 'api-key-1')
      expect(cb).toHaveBeenCalledWith('api-key-1', undefined, SHARED_EXACT)

      service.deleteShared(SHARED_EXACT)
      expect(cb).toHaveBeenLastCalledWith(undefined, 'api-key-1', SHARED_EXACT)
    })

    it('skips broadcast and fire when value deep-equals existing', async () => {
      const { BrowserWindow } = (await import('electron')) as any
      const webContents = { send: vi.fn() }
      BrowserWindow.getAllWindows.mockReturnValue([{ isDestroyed: () => false, id: 99, webContents }])

      const cb = vi.fn()
      service.setShared(SHARED_EXACT, 'api-key-1')
      service.subscribeSharedChange(SHARED_EXACT, cb)

      webContents.send.mockClear()
      service.setShared(SHARED_EXACT, 'api-key-1') // same value
      expect(cb).not.toHaveBeenCalled()
      expect(webContents.send).not.toHaveBeenCalled()
    })

    it('fires when IPC Cache_Sync arrives from renderer', () => {
      const cb = vi.fn()
      service.subscribeSharedChange(SHARED_EXACT, cb)

      const listener = ipcListeners.get(IpcChannel.Cache_Sync)!
      expect(listener).toBeDefined()
      const event = { sender: {} } as IpcMainEvent
      listener(event, { type: 'shared', key: SHARED_EXACT, value: 'from-renderer' })

      expect(cb).toHaveBeenCalledWith('from-renderer', undefined, SHARED_EXACT)
    })

    it('treats expired entries as undefined for oldValue', () => {
      const cb = vi.fn()
      // TTL=1ms so the entry is already expired by the time we write again
      service.setShared(SHARED_EXACT, 'stale', 1)
      const nowSpy = vi.spyOn(Date, 'now')
      nowSpy.mockReturnValue(Date.now() + 100)

      service.subscribeSharedChange(SHARED_EXACT, cb)
      service.setShared(SHARED_EXACT, 'fresh')

      expect(cb).toHaveBeenCalledWith('fresh', undefined, SHARED_EXACT)
      nowSpy.mockRestore()
    })
  })

  // ---------------------------------------------------------------------------
  // Shared cache — template key
  // ---------------------------------------------------------------------------

  describe('subscribeSharedChange (template keys)', () => {
    it('fires for any concrete key matching the template', () => {
      const cb = vi.fn()
      service.subscribeSharedChange(SHARED_TEMPLATE, cb)

      service.setShared(SHARED_EXACT, 'k1')
      expect(cb).toHaveBeenLastCalledWith('k1', undefined, SHARED_EXACT)

      service.setShared(SHARED_OTHER, 'k2')
      expect(cb).toHaveBeenLastCalledWith('k2', undefined, SHARED_OTHER)

      expect(cb).toHaveBeenCalledTimes(2)
    })

    it('exact and template subscriptions coexist on the same concrete key', () => {
      const exactCb = vi.fn()
      const tplCb = vi.fn()
      service.subscribeSharedChange(SHARED_EXACT, exactCb)
      service.subscribeSharedChange(SHARED_TEMPLATE, tplCb)

      service.setShared(SHARED_EXACT, 'v')

      expect(exactCb).toHaveBeenCalledWith('v', undefined, SHARED_EXACT)
      expect(tplCb).toHaveBeenCalledWith('v', undefined, SHARED_EXACT)
    })

    it('placeholder variable name does not affect matching', () => {
      const cb = vi.fn()
      service.subscribeSharedChange('web_search.provider.last_used_key.${foo}' as any, cb)
      service.setShared(SHARED_EXACT, 'v')
      expect(cb).toHaveBeenCalledWith('v', undefined, SHARED_EXACT)
    })

    it('contract: non-ASCII concrete keys do not match templates (locks [\\w\\-]+ charset)', () => {
      const cb = vi.fn()
      service.subscribeSharedChange(SHARED_TEMPLATE, cb)
      // Write via the IPC path since a TS-typed setShared would reject non-ASCII.
      const listener = ipcListeners.get(IpcChannel.Cache_Sync)!
      listener({ sender: {} } as IpcMainEvent, {
        type: 'shared',
        key: 'web_search.provider.last_used_key.中文id',
        value: 'v'
      })
      expect(cb).not.toHaveBeenCalled()
    })
  })

  // ---------------------------------------------------------------------------
  // Re-entrance
  // ---------------------------------------------------------------------------

  describe('re-entrance', () => {
    it('callback writing same value terminates via isEqual short-circuit', () => {
      const cb = vi.fn((newValue: any) => {
        // same value → short-circuits, no infinite loop
        service.setShared(SHARED_EXACT, newValue)
      })
      service.subscribeSharedChange(SHARED_EXACT, cb)
      service.setShared(SHARED_EXACT, 'once')
      expect(cb).toHaveBeenCalledTimes(1)
    })

    it('callback writing different value fires again then terminates when values converge', () => {
      let writes = 0
      const cb = vi.fn(() => {
        writes++
        // toggle once then stop (same value on 2nd fire)
        if (writes === 1) service.setShared(SHARED_EXACT, 'second')
      })
      service.subscribeSharedChange(SHARED_EXACT, cb)
      service.setShared(SHARED_EXACT, 'first')
      expect(cb).toHaveBeenCalledTimes(2)
      expect(service.getShared(SHARED_EXACT)).toBe('second')
    })
  })

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  describe('onStop', () => {
    it('clears subscriptions so new writes after stop do not fire old subscribers', async () => {
      const cb = vi.fn()
      service.subscribeSharedChange(SHARED_EXACT, cb)
      await service.onStop()

      // After stop, new writes should not fire old subscribers.
      service.setShared(SHARED_EXACT, 'x')
      expect(cb).not.toHaveBeenCalled()
    })
  })
})
