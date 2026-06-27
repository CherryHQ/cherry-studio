/**
 * Tests for renderer-side CacheService value-equality semantics.
 *
 * This is the first unit test for the renderer CacheService itself (prior
 * coverage was limited to useCache hook type tests). It locks down the
 * Object.is → lodash.isEqual upgrade for setInternal / setSharedInternal,
 * and the deepEqual → isEqual refactor for setPersist, focusing on the
 * scenarios the upgrade actually changes: object/array/record values that
 * are reconstructed as new references on every write.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Undo the global mock from renderer.setup.ts — we want the REAL CacheService
vi.unmock('@data/CacheService')

const broadcastSync = vi.fn()
const onSync = vi.fn()
const getAllShared = vi.fn(async () => ({}))

beforeEach(() => {
  broadcastSync.mockClear()
  onSync.mockClear()
  getAllShared.mockClear()

  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      cache: {
        broadcastSync,
        onSync,
        getAllShared
      }
    }
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

async function createService() {
  const { CacheService } = await import('../CacheService')
  return new CacheService()
}

describe('renderer CacheService equality semantics', () => {
  describe('setInternal (memory cache)', () => {
    it('skips subscriber notification when object value has same content (new reference)', async () => {
      const service = await createService()
      const sub = vi.fn()
      const key = 'agent.session.waiting_id_map'

      service.set(key, { a: true, b: false })
      service.subscribe(key, sub)
      sub.mockClear()

      service.set(key, { a: true, b: false }) // new reference, same content
      expect(sub).not.toHaveBeenCalled()
    })

    it('notifies subscribers when content actually changes', async () => {
      const service = await createService()
      const sub = vi.fn()
      const key = 'agent.session.waiting_id_map'

      service.set(key, { a: true })
      service.subscribe(key, sub)
      sub.mockClear()

      service.set(key, { a: true, b: false })
      expect(sub).toHaveBeenCalledTimes(1)
    })
  })

  describe('setSharedInternal (shared cache)', () => {
    it('skips cross-window broadcast when Record value has same content (new reference)', async () => {
      const service = await createService()
      const key = 'chat.web_search.active_searches'
      // `chat.web_search.active_searches` is `Record<string, ...>` — exactly the
      // case the Object.is → isEqual upgrade is meant to fix.
      service.setShared(key, { topic1: { status: 'running' } } as any)
      broadcastSync.mockClear()

      service.setShared(key, { topic1: { status: 'running' } } as any) // new ref, same content
      expect(broadcastSync).not.toHaveBeenCalled()
    })

    it('broadcasts when Record value content actually changes', async () => {
      const service = await createService()
      const key = 'chat.web_search.active_searches'
      service.setShared(key, { topic1: { status: 'running' } } as any)
      broadcastSync.mockClear()

      service.setShared(key, { topic1: { status: 'done' } } as any)
      expect(broadcastSync).toHaveBeenCalledTimes(1)
    })
  })

  describe('setPersist', () => {
    it('skips persist save when array value has same content (new reference)', async () => {
      const service = await createService()
      const key = 'ui.tab.pinned_tabs'

      service.setPersist(key, [{ id: 't1' }] as any)
      broadcastSync.mockClear()

      service.setPersist(key, [{ id: 't1' }] as any) // new ref, same content
      expect(broadcastSync).not.toHaveBeenCalled()
    })

    it('broadcasts when array content actually changes', async () => {
      const service = await createService()
      const key = 'ui.tab.pinned_tabs'

      service.setPersist(key, [{ id: 't1' }] as any)
      broadcastSync.mockClear()

      service.setPersist(key, [{ id: 't1' }, { id: 't2' }] as any)
      expect(broadcastSync).toHaveBeenCalledTimes(1)
    })
  })

  // hasPersist answers "has this key been overridden" (effective value differs
  // from the schema default), NOT "is the key in the backing store" — mirrors the
  // main-process tier. loadPersistCache seeds every key, so membership is always
  // true and would carry no information.
  describe('hasPersist (differs-from-default)', () => {
    it('is false when the value equals the schema default (never set)', async () => {
      const service = await createService()
      expect(service.hasPersist('ui.sidebar.width')).toBe(false)
    })

    it('is true once an overriding (non-default) value is set', async () => {
      const service = await createService()
      service.setPersist('ui.sidebar.width', 999)
      expect(service.hasPersist('ui.sidebar.width')).toBe(true)
    })

    it('is false when the set value happens to equal the default', async () => {
      const service = await createService()
      service.setPersist('ui.sidebar.width', 50) // 50 is the schema default
      expect(service.hasPersist('ui.sidebar.width')).toBe(false)
    })
  })

  describe('deletePersist (reset-to-default)', () => {
    it('resets an overridden value back to the schema default', async () => {
      const service = await createService()
      service.setPersist('ui.sidebar.width', 999)
      service.deletePersist('ui.sidebar.width')
      expect(service.getPersist('ui.sidebar.width')).toBe(50)
      expect(service.hasPersist('ui.sidebar.width')).toBe(false)
    })

    it('broadcasts the reset to other windows', async () => {
      const service = await createService()
      service.setPersist('ui.sidebar.width', 999)
      broadcastSync.mockClear()

      service.deletePersist('ui.sidebar.width')
      expect(broadcastSync).toHaveBeenCalledTimes(1)
    })

    it('is a no-op when the value is already the default', async () => {
      const service = await createService()
      broadcastSync.mockClear()
      service.deletePersist('ui.sidebar.width') // already default
      expect(broadcastSync).not.toHaveBeenCalled()
    })
  })
})
