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
  get.mockClear()
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
    get.mockResolvedValueOnce(['en-US'])
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

  it('composes queued updates from the latest persisted value', async () => {
    get.mockResolvedValueOnce(['agent-a'])
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
    await service.get('agent.session.hidden_builtin_ids')

    const showFirst = service.update('agent.session.hidden_builtin_ids', (ids) => ids.filter((id) => id !== 'agent-a'))
    const hideSecond = service.update('agent.session.hidden_builtin_ids', (ids) => [...ids, 'agent-b'])

    resolveFirst()
    await Promise.all([showFirst, hideSecond])

    expect(set).toHaveBeenNthCalledWith(1, 'agent.session.hidden_builtin_ids', [])
    expect(set).toHaveBeenNthCalledWith(2, 'agent.session.hidden_builtin_ids', ['agent-b'])
    expect(service.getCachedValue('agent.session.hidden_builtin_ids')).toEqual(['agent-b'])
  })

  it('composes the next update after a failed update rolls back', async () => {
    get.mockResolvedValueOnce(['agent-a'])
    const error = new Error('write failed')
    set.mockRejectedValueOnce(error).mockResolvedValueOnce(undefined)
    const service = await createService()
    await service.get('agent.session.hidden_builtin_ids')

    const showFirst = service.update('agent.session.hidden_builtin_ids', (ids) => ids.filter((id) => id !== 'agent-a'))
    const showFirstResult = expect(showFirst).rejects.toBe(error)
    const hideSecond = service.update('agent.session.hidden_builtin_ids', (ids) => [...ids, 'agent-b'])

    await showFirstResult
    await hideSecond

    expect(set).toHaveBeenNthCalledWith(2, 'agent.session.hidden_builtin_ids', ['agent-a', 'agent-b'])
    expect(service.getCachedValue('agent.session.hidden_builtin_ids')).toEqual(['agent-a', 'agent-b'])
  })
})
