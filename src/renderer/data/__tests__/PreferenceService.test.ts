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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Undo the global mock from renderer.setup.ts — we want the REAL PreferenceService
vi.unmock('@data/PreferenceService')

let onChangedCallback: ((key: string, value: unknown) => void) | undefined
const onChanged = vi.fn((callback: (key: string, value: unknown) => void) => {
  onChangedCallback = callback
  return () => {}
})
const getAll = vi.fn(async () => ({}))
const subscribe = vi.fn(async () => {})
const get = vi.fn(async () => true)
const getMultipleRaw = vi.fn(async (keys: string[]) => Object.fromEntries(keys.map((key) => [key, `${key}-value`])))

beforeEach(() => {
  onChanged.mockClear()
  onChangedCallback = undefined
  getAll.mockClear()
  subscribe.mockClear()
  get.mockClear()
  getMultipleRaw.mockClear()

  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      preference: {
        onChanged,
        getAll,
        subscribe,
        get,
        getMultipleRaw
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

describe('renderer PreferenceService change logging', () => {
  it('logs IPC preference changes without their values', async () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const service = await createService()

    onChangedCallback?.('app.language', 'super-secret-preference-value')

    expect(onChangedCallback).toBeDefined()
    expect(debug).toHaveBeenCalledOnce()
    expect(debug).toHaveBeenCalledWith('Preference app.language updated')

    service.cleanup()
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
