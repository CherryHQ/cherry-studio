import { createMockPreferenceService } from '@test-mocks/renderer/PreferenceService'
/**
 * Tests for renderer-side PreferenceService warm-up and subscription semantics.
 *
 * preloadAll() is a fire-and-forget warm-up — both call sites invoke it as
 * `void preferenceService.preloadAll()` with no rejection handler, so an IPC
 * failure must resolve (degrading to defaults + lazy per-key self-heal in
 * get()) instead of rejecting into an unhandled promise rejection.
 *
 * Keyed read paths (preload/getMultipleRaw/get) must batch the subscribe IPC
 * (one round-trip for N keys), dedupe concurrent subscriptions, and re-attempt
 * subscription for keys that are cached but not yet subscribed.
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useDictationEnabled } from '@renderer/hooks/useDictationEnabled'
import { APPLE_ASR_MODEL_ID } from '@shared/ai/localVoice'

// Undo the global mock from renderer.setup.ts — we want the REAL PreferenceService
vi.unmock('@data/PreferenceService')
vi.unmock('@data/hooks/usePreference')

const onChangedCleanup = vi.fn()
let emitChanged: ((key: string, value: unknown) => void) | undefined
const onChanged = vi.fn((callback: (key: string, value: unknown) => void) => {
  emitChanged = callback
  return onChangedCleanup
})
const getAll = vi.fn(async () => ({}))
const subscribe = vi.fn(async () => {})
const get = vi.fn(async (): Promise<unknown> => true)
const getMultipleRaw = vi.fn(async (keys: string[]) => Object.fromEntries(keys.map((key) => [key, `${key}-value`])))
const set = vi.fn(async () => {})
const setMultiple = vi.fn(async () => {})

beforeEach(() => {
  onChanged.mockClear()
  onChangedCleanup.mockClear()
  getAll.mockClear()
  subscribe.mockClear()
  get.mockReset().mockResolvedValue(true)
  getMultipleRaw.mockClear()
  set.mockClear()
  setMultiple.mockClear()
  emitChanged = undefined

  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      preference: {
        onChanged,
        getAll,
        subscribe,
        get,
        getMultipleRaw,
        set,
        setMultiple
      }
    }
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

async function createService() {
  const { PreferenceService } = await import('../PreferenceService')
  return new PreferenceService()
}

describe('renderer PreferenceService preloadAll', () => {
  it('loads all preferences into cache and marks the full cache loaded', async () => {
    getAll.mockResolvedValue({ 'app.developer_mode.enabled': true })
    const service = await createService()

    await service.preloadAll()

    expect(service.getCachedValue('app.developer_mode.enabled')).toBe(true)
    expect(service.isFullyCached()).toBe(true)
  })

  it('resolves instead of rejecting when the IPC fetch fails', async () => {
    getAll.mockRejectedValue(new Error('ipc down'))
    const service = await createService()

    await expect(service.preloadAll()).resolves.toBeUndefined()
    expect(service.isFullyCached()).toBe(false)
  })
})

describe('renderer PreferenceService keyed subscription batching', () => {
  it('preload of uncached keys subscribes once with all of them', async () => {
    const service = await createService()

    await service.preload(['app.language', 'ui.theme_mode', 'app.developer_mode.enabled'])

    expect(subscribe).toHaveBeenCalledTimes(1)
    expect(subscribe).toHaveBeenCalledWith(['app.language', 'ui.theme_mode', 'app.developer_mode.enabled'])
  })

  it('concurrent preloads of the same key send a single subscribe call', async () => {
    const service = await createService()

    const first = service.preload(['app.language'])
    const second = service.preload(['app.language'])
    await Promise.all([first, second])

    expect(subscribe).toHaveBeenCalledTimes(1)
  })

  it('re-attempts the subscription on the next preload after a failed subscribe', async () => {
    subscribe.mockRejectedValueOnce(new Error('ipc down'))
    const service = await createService()

    // First preload caches the value but its subscription fails (swallowed).
    await service.preload(['app.language'])
    // Second preload is fully cached — it must still retry the subscription
    // without refetching the value.
    await service.preload(['app.language'])

    expect(getMultipleRaw).toHaveBeenCalledTimes(1)
    expect(subscribe).toHaveBeenCalledTimes(2)
    expect(subscribe).toHaveBeenLastCalledWith(['app.language'])
  })

  it('get() on a cached-but-unsubscribed key heals the subscription exactly once', async () => {
    subscribe.mockRejectedValueOnce(new Error('ipc down'))
    const service = await createService()

    // Caches the value; the subscription attempt fails (swallowed).
    await service.get('app.language')
    subscribe.mockClear()

    // Cache hit — must fire the heal subscription.
    await service.get('app.language')
    expect(subscribe).toHaveBeenCalledTimes(1)
    expect(subscribe).toHaveBeenCalledWith(['app.language'])

    // Already subscribed — no further subscribe calls.
    await service.get('app.language')
    expect(subscribe).toHaveBeenCalledTimes(1)
  })
})

describe('renderer PreferenceService write consistency', () => {
  it('drops a deep-equal cross-window echo but delivers a real external change', async () => {
    get.mockResolvedValue(['en-US'])
    const service = await createService()
    await service.get('app.spell_check.languages')
    const listener = vi.fn()
    service.subscribeChange('app.spell_check.languages')(listener)

    emitChanged?.('app.spell_check.languages', ['en-US'])
    expect(listener).not.toHaveBeenCalled()

    emitChanged?.('app.spell_check.languages', ['fr-FR'])
    expect(listener).toHaveBeenCalledOnce()
    expect(service.getCachedValue('app.spell_check.languages')).toEqual(['fr-FR'])

    service.cleanup()
    expect(onChangedCleanup).toHaveBeenCalledOnce()
  })

  it('rolls an optimistic write back to the original value when persistence fails', async () => {
    get.mockResolvedValueOnce(true)
    const service = await createService()
    await service.get('app.developer_mode.enabled')
    const listener = vi.fn()
    service.subscribeChange('app.developer_mode.enabled')(listener)
    const error = new Error('write failed')
    set.mockRejectedValueOnce(error)

    const update = service.set('app.developer_mode.enabled', false)
    expect(service.getCachedValue('app.developer_mode.enabled')).toBe(false)

    await expect(update).rejects.toBe(error)
    expect(service.getCachedValue('app.developer_mode.enabled')).toBe(true)
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('serializes concurrent writes to one key and leaves the latest value cached', async () => {
    get.mockResolvedValueOnce(true)
    let resolveFirst: () => void = () => undefined
    set
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveFirst = resolve
          })
      )
      .mockResolvedValueOnce(undefined)
    const service = await createService()
    await service.get('app.developer_mode.enabled')

    const first = service.set('app.developer_mode.enabled', false)
    const second = service.set('app.developer_mode.enabled', true)

    expect(set).toHaveBeenCalledExactlyOnceWith('app.developer_mode.enabled', false)
    expect(service.getCachedValue('app.developer_mode.enabled')).toBe(false)

    resolveFirst()
    await Promise.all([first, second])

    expect(set).toHaveBeenNthCalledWith(2, 'app.developer_mode.enabled', true)
    expect(service.getCachedValue('app.developer_mode.enabled')).toBe(true)
    expect(service.getPendingOptimisticUpdates()).toEqual([])
  })
})

describe('subscription alignment and admission truth', () => {
  const key = 'feature.voice.recognition.model_id' as const

  it.each([
    ['off', '', true],
    ['', 'off', false]
  ] as const)('restores the entry from warm cache %s to main truth %s', async (cached, truth, enabled) => {
    const service = await createService()
    await service.set(key, cached)
    get.mockResolvedValue(truth)
    const { preferenceService } = await import('../PreferenceService')
    vi.spyOn(preferenceService, 'getCachedValue').mockImplementation((k) => service.getCachedValue(k))
    vi.spyOn(preferenceService, 'subscribeChange').mockImplementation(service.subscribeChange)
    vi.spyOn(preferenceService, 'ensureFreshSubscription').mockImplementation((key) =>
      service.ensureFreshSubscription(key)
    )
    const listener = vi.fn()
    const stop = service.subscribeChange(key)(listener)
    const hook = renderHook(() => useDictationEnabled())
    expect(hook.result.current).toBe(!enabled)
    await act(async () => {
      expect(await service.ensureSubscription(key)).toBe(true)
    })
    expect(service.getCachedValue(key)).toBe(truth)
    expect(hook.result.current).toBe(enabled)
    expect(listener).toHaveBeenCalledOnce()
    await service.ensureSubscription(key)
    expect(get).toHaveBeenCalledOnce()
    hook.unmount()
    stop()
    service.cleanup()
  })

  it('aligns an unchanged value without notifying, and fills a missing cache', async () => {
    const service = await createService()
    await service.set(key, '')
    get.mockResolvedValue('')
    const listener = vi.fn()
    service.subscribeChange(key)(listener)
    expect(await service.ensureSubscription(key)).toBe(true)
    expect(service.getCachedValue(key)).toBe('')
    expect(listener).not.toHaveBeenCalled()
    service.cleanup()
    const empty = await createService()
    expect(await empty.ensureSubscription(key)).toBe(true)
    expect(empty.isCached(key)).toBe(true)
    expect(empty.getCachedValue(key)).toBe('')
    empty.cleanup()
  })

  it('shares a pending subscription failure and permits retry', async () => {
    let reject!: (error: Error) => void
    subscribe.mockReturnValueOnce(
      new Promise<void>((_, fail) => {
        reject = fail
      })
    )
    const service = await createService()
    const first = service.ensureSubscription(key)
    const second = service.ensureSubscription(key)
    reject(new Error('IPC down'))
    expect(await first).toBe(false)
    expect(await second).toBe(false)
    expect(subscribe).toHaveBeenCalledOnce()
    expect(await service.ensureSubscription(key)).toBe(true)
    expect(subscribe).toHaveBeenCalledTimes(2)
    service.cleanup()
  })

  it('rereads after a push and returns the second snapshot instead of the cache', async () => {
    let resolve!: (value: unknown) => void
    get.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done
      })
    )
    const service = await createService()
    const ready = service.ensureFreshSubscription(key)
    await vi.waitFor(() => expect(get).toHaveBeenCalledOnce())
    emitChanged?.(key, APPLE_ASR_MODEL_ID)
    get.mockResolvedValue('off')
    resolve('')
    expect(await ready).toEqual({ ok: true, value: 'off' })
    expect(get).toHaveBeenCalledTimes(2)
    expect(service.getCachedValue(key)).toBe('off')
    service.cleanup()
  })

  it('fails closed after three raced reads and permits ordinary alignment to retry', async () => {
    const service = await createService()
    get.mockResolvedValue('')
    expect(await service.ensureFreshSubscription(key)).toEqual({ ok: true, value: '' })
    get.mockClear().mockImplementation(async () => {
      emitChanged?.(key, '')
      return 'off'
    })
    const results = await Promise.all([service.ensureFreshSubscription(key), service.ensureFreshSubscription(key)])
    expect(results).toEqual([{ ok: false }, { ok: false }])
    expect(get).toHaveBeenCalledTimes(3)
    expect(service.getCachedValue(key)).toBe('')
    get.mockResolvedValue('off')
    await service.ensureSubscription(key)
    expect(get).toHaveBeenCalledTimes(4)
    expect(subscribe).toHaveBeenCalledOnce()
    expect(service.getCachedValue(key)).toBe('off')
    service.cleanup()
  })

  it.each([undefined, null, 'off', ''] as const)(
    'reads truth %s without changing or notifying the cache',
    async (value) => {
      const service = await createService()
      await service.set(key, '')
      await service.ensureSubscription(key)
      await service.set(key, '')
      const listener = vi.fn()
      service.subscribeChange(key)(listener)
      get.mockResolvedValue(value)
      expect(await service.getAuthoritative(key)).toBe(value ?? undefined)
      expect(service.getCachedValue(key)).toBe('')
      expect(listener).not.toHaveBeenCalled()
      service.cleanup()
    }
  )

  it('reads a new snapshot even after successful alignment', async () => {
    const service = await createService()
    get.mockResolvedValue('')
    expect(await service.ensureFreshSubscription(key)).toEqual({ ok: true, value: '' })
    get.mockResolvedValue('off')
    expect(await service.ensureFreshSubscription(key)).toEqual({ ok: true, value: 'off' })
    expect(get).toHaveBeenCalledTimes(2)
    expect(subscribe).toHaveBeenCalledOnce()
    expect(service.getCachedValue(key)).toBe('off')
    service.cleanup()
  })

  it('retries subscription alignment after a later fresh read fails', async () => {
    const service = await createService()
    get.mockResolvedValue('')
    expect(await service.ensureFreshSubscription(key)).toEqual({ ok: true, value: '' })
    get.mockRejectedValueOnce(new Error('read unavailable'))
    expect(await service.ensureFreshSubscription(key)).toEqual({ ok: false })
    get.mockResolvedValue('off')
    await service.ensureSubscription(key)
    expect(get).toHaveBeenCalledTimes(3)
    expect(subscribe).toHaveBeenCalledOnce()
    expect(service.getCachedValue(key)).toBe('off')
    service.cleanup()
  })

  it.each(['fresh', 'subscription'] as const)(
    'retries failed alignment without registering again: %s',
    async (path) => {
      get.mockRejectedValueOnce(new Error('read unavailable')).mockResolvedValue('off')
      const service = await createService()
      if (path === 'fresh') {
        expect(await service.ensureFreshSubscription(key)).toEqual({ ok: false })
      } else {
        expect(await service.ensureSubscription(key)).toBe(true)
      }
      expect(get).toHaveBeenCalledTimes(1)
      expect(service.isCached(key)).toBe(false)
      if (path === 'fresh') {
        expect(await service.ensureFreshSubscription(key)).toEqual({ ok: true, value: 'off' })
      } else {
        expect(await service.ensureSubscription(key)).toBe(true)
      }
      expect(get).toHaveBeenCalledTimes(2)
      expect(subscribe).toHaveBeenCalledOnce()
      expect(service.getCachedValue(key)).toBe('off')
      service.cleanup()
    }
  )

  it.each([undefined, null])('rejects missing snapshots without filling defaults: %s', async (value) => {
    get.mockResolvedValue(value)
    const service = await createService()
    expect(await service.ensureFreshSubscription(key)).toEqual({ ok: false })
    expect(service.isCached(key)).toBe(false)
    service.cleanup()
  })

  it.each(['real', 'mock'] as const)(
    'keeps fresh-snapshot failure and recovery semantics in parity: %s',
    async (kind) => {
      const mock = createMockPreferenceService()
      const service = kind === 'real' ? await createService() : mock
      const read = kind === 'real' ? get : mock.getAuthoritative
      if (kind === 'real') subscribe.mockRejectedValueOnce(new Error('subscription unavailable'))
      else mock.ensureSubscription.mockResolvedValueOnce(false)
      expect(await service.ensureFreshSubscription(key)).toEqual({ ok: false })
      expect(read).not.toHaveBeenCalled()
      read.mockRejectedValueOnce(new Error('read unavailable'))
      expect(await service.ensureFreshSubscription(key)).toEqual({ ok: false })
      for (const value of [undefined, null]) {
        read.mockResolvedValue(value)
        expect(await service.ensureFreshSubscription(key)).toEqual({ ok: false })
        expect(service.getCachedValue(key)).toBeUndefined()
      }
      read.mockResolvedValue('')
      expect(await service.ensureFreshSubscription(key)).toEqual({ ok: true, value: '' })
      expect(service.getCachedValue(key)).toBe('')
      if (kind === 'real') (service as Awaited<ReturnType<typeof createService>>).cleanup()
    }
  )

  it('heals a stale Off entry on remount after the alignment read recovers', async () => {
    const { preferenceService } = await import('../PreferenceService')
    const service = await createService()
    await service.set(key, 'off')
    get.mockResolvedValue('off')
    await service.ensureSubscription(key)
    get.mockRejectedValue(new Error('read unavailable'))
    vi.spyOn(preferenceService, 'getCachedValue').mockImplementation((k) => service.getCachedValue(k))
    vi.spyOn(preferenceService, 'subscribeChange').mockImplementation(service.subscribeChange)
    vi.spyOn(preferenceService, 'ensureFreshSubscription').mockImplementation((k) => service.ensureFreshSubscription(k))
    const first = renderHook(() => useDictationEnabled())
    await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(2))
    expect(first.result.current).toBe(false)
    first.unmount()
    get.mockResolvedValue('')
    const second = renderHook(() => useDictationEnabled())
    await vi.waitFor(() => expect(second.result.current).toBe(true))
    expect(service.getCachedValue(key)).toBe('')
    expect(subscribe).toHaveBeenCalledOnce()
    second.unmount()
    service.cleanup()
  })
})
