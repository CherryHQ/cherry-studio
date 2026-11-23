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

import type { IpcMain, IpcMainEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { DefaultMainPersistCache } from '@shared/data/cache/cacheSchemas'
import type { MainPersistCacheKey, MainPersistCacheSchema } from '@shared/data/cache/cacheSchemas'
import type { MarketplaceSkillDetail, SkillSubscriptionSnapshot } from '@shared/types/skillMarketplace'

// Undo the global mock from main.setup.ts — we want the REAL CacheService.
vi.unmock('@main/data/CacheService')

// Mock lifecycle decorators so `new CacheService()` works without the container.
const ipcListeners = new Map<string, (event: IpcMainEvent, ...args: any[]) => void>()
const ipcHandlers = new Map<string, Parameters<IpcMain['handle']>[1]>()

vi.mock('@main/core/lifecycle', () => ({
  BaseService: class {
    protected ipcOn(channel: string, listener: (event: IpcMainEvent, ...args: any[]) => void) {
      ipcListeners.set(channel, listener)
      return { dispose: () => ipcListeners.delete(channel) }
    }
    protected ipcHandle(channel: string, handler: Parameters<IpcMain['handle']>[1]) {
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

const PROBE = 'internal.persist_probe' as const

const subscriptionSkill: MarketplaceSkillDetail = {
  id: 'feed:root',
  name: { en: 'Root skill', zh: null },
  description: { en: '', zh: null },
  longDescription: { en: '', zh: null },
  domain: 'Other',
  author: '',
  version: '',
  tags: [],
  githubRepoUrl: null,
  sourceUrl: 'https://github.com/example/skills',
  icon: null,
  packageName: null,
  packageSize: null,
  hasPackage: true,
  downloadUrl: null,
  downloads: null,
  releaseDate: '',
  subscription: { sourceId: 'feed', kind: 'github', url: 'https://github.com/example/skills' },
  members: [{ path: '', name: 'Root skill' }],
  membersKnown: true,
  isCollection: false
}

const subscriptionSnapshot: SkillSubscriptionSnapshot = {
  source: { id: 'feed', url: 'https://example.com/feed.json', name: '', kind: 'json', createdAt: 0 },
  items: [
    subscriptionSkill,
    {
      ...subscriptionSkill,
      id: 'feed:zip',
      subscription: { sourceId: 'feed', kind: 'zip', url: 'https://example.com/skills.zip' },
      downloadUrl: 'https://example.com/skills.zip',
      members: [],
      membersKnown: false
    }
  ],
  fetchedAt: 123.5,
  skipped: 0
}

const persistedValues: MainPersistCacheSchema = {
  'skill.subscription.catalogs': { feed: subscriptionSnapshot },
  'skill.marketplace.members': { root: [{ path: '', name: 'Root skill' }], empty: [] },
  'browser.favicons': Object.fromEntries([
    ['https://example.com', 'data:image/svg+xml,<svg/>'],
    ['__proto__', 'literal key'],
    ['constructor', 'another literal key']
  ]),
  'backup.auto_sync.last_attempt_times': { webdav: 123.5, s3: null, local: -1, nutstore: 0 },
  'cherry_cloud.notification_cursors': { account: 'opaque:cursor/123' },
  'cherryin.models.last_attempt_at': 123.5,
  'internal.persist_probe': -0.5,
  'window.bounds': {
    'custom-window': {
      x: -100.5,
      y: -20.25,
      width: 800.5,
      height: 600.5,
      isMaximized: true,
      displayBounds: { x: -1920, y: 0, width: 1920, height: 1080 }
    }
  }
}

const invalidPersistValues: Array<[MainPersistCacheKey, unknown]> = [
  [
    'skill.subscription.catalogs',
    { feed: { ...subscriptionSnapshot, items: [{ ...subscriptionSkill, downloads: 'many' }] } }
  ],
  ['skill.marketplace.members', { root: [{ path: 42, name: 'Root skill' }] }],
  ['browser.favicons', Object.fromEntries([['__proto__', false]])],
  ['backup.auto_sync.last_attempt_times', { webdav: null, s3: null, local: null }],
  [
    'backup.auto_sync.last_attempt_times',
    { ...persistedValues['backup.auto_sync.last_attempt_times'], webdav: 'tomorrow' }
  ],
  ['cherry_cloud.notification_cursors', { account: '' }],
  ['cherryin.models.last_attempt_at', 'yesterday'],
  ['internal.persist_probe', null],
  ['window.bounds', { main: { x: 0, y: 0, width: 800, height: 600, isMaximized: false } }],
  ['window.bounds', { main: { ...persistedValues['window.bounds']['custom-window'], width: 0 } }]
]

describe('CacheService persist tier', () => {
  let service: any
  let tmpDir: string
  let cacheFile: string

  const initService = async () => {
    const { BrowserWindow } = (await import('electron')) as any
    BrowserWindow.getAllWindows = vi.fn(() => [])
    BrowserWindow.fromWebContents = vi.fn(() => null)

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

  it('reloads all supported domains without rejecting valid subscription or geometry values', async () => {
    fs.writeFileSync(cacheFile, JSON.stringify(persistedValues), 'utf-8')
    await initService()

    for (const [key, value] of Object.entries(persistedValues)) {
      expect(service.getPersist(key)).toEqual(value)
    }
    const favicons = service.getPersist('browser.favicons')
    expect(Object.hasOwn(favicons, '__proto__')).toBe(true)
    expect(Object.getPrototypeOf(favicons)).toBe(Object.prototype)
    service.flushPersistForBackup()
    await service.onStop()
    await initService()

    expect(service.getPersist('skill.subscription.catalogs')).toEqual(persistedValues['skill.subscription.catalogs'])
    expect(service.getPersist('window.bounds')).toEqual(persistedValues['window.bounds'])
    expect(service.getPersist('browser.favicons')).toEqual(persistedValues['browser.favicons'])
  })

  it.each(invalidPersistValues)('falls back only for the invalid persisted key %s', async (key, value) => {
    fs.writeFileSync(cacheFile, JSON.stringify({ ...persistedValues, [key]: value }), 'utf-8')
    await initService()

    for (const candidate of Object.keys(persistedValues) as MainPersistCacheKey[]) {
      expect(service.getPersist(candidate)).toEqual(
        candidate === key ? DefaultMainPersistCache[candidate] : persistedValues[candidate]
      )
    }
    service.flushPersistForBackup()
    const repaired = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'))
    expect(repaired).toEqual({ ...persistedValues, [key]: DefaultMainPersistCache[key] })
  })

  it.each([{ value: null }, { value: [['origin', 'value']] }, { value: 'text' }])(
    'does not convert a non-object dictionary into a favicon record ($value)',
    async ({ value }) => {
      fs.writeFileSync(cacheFile, JSON.stringify({ [PROBE]: 7, 'browser.favicons': value }), 'utf-8')
      await initService()

      expect(service.getPersist('browser.favicons')).toEqual({})
      expect(service.getPersist(PROBE)).toBe(7)
    }
  )

  it('rejects finite-range overflow without discarding another valid numeric key', async () => {
    fs.writeFileSync(cacheFile, '{"internal.persist_probe":1e999,"cherryin.models.last_attempt_at":7}', 'utf-8')
    await initService()

    expect(service.getPersist(PROBE)).toBe(0)
    expect(service.getPersist('cherryin.models.last_attempt_at')).toBe(7)
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

  it('flushes cache.json immediately for backup', async () => {
    await initService()
    service.setPersist(PROBE, 8)

    service.flushPersistForBackup()

    expect(fs.existsSync(cacheFile)).toBe(true)
    expect(JSON.parse(fs.readFileSync(cacheFile, 'utf-8'))[PROBE]).toBe(8)
  })

  it('creates cache.json for backup when no persisted file exists yet', async () => {
    await initService()

    service.flushPersistForBackup()

    expect(fs.existsSync(cacheFile)).toBe(true)
    expect(JSON.parse(fs.readFileSync(cacheFile, 'utf-8'))[PROBE]).toBe(0)
  })

  it('throws instead of accepting a stale existing cache.json when the backup flush fails', async () => {
    fs.writeFileSync(cacheFile, JSON.stringify({ [PROBE]: 1 }), 'utf-8')
    await initService()
    service.setPersist(PROBE, 8)

    // A directory at the atomic temp path makes writeFileSync fail while the
    // prior cache.json remains a perfectly readable (but stale) file.
    fs.mkdirSync(`${cacheFile}.tmp`)

    expect(() => service.flushPersistForBackup()).toThrow()
    expect(JSON.parse(fs.readFileSync(cacheFile, 'utf-8'))[PROBE]).toBe(1)
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
