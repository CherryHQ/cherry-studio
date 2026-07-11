/**
 * Tests for renderer-side PreferenceService preloadAll semantics.
 *
 * preloadAll() is a fire-and-forget warm-up — both call sites invoke it as
 * `void preferenceService.preloadAll()` with no rejection handler, so an IPC
 * failure must resolve (degrading to defaults + lazy per-key self-heal in
 * get()) instead of rejecting into an unhandled promise rejection.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Undo the global mock from renderer.setup.ts — we want the REAL PreferenceService
vi.unmock('@data/PreferenceService')

const onChanged = vi.fn(() => () => {})
const getAll = vi.fn(async () => ({}))
const subscribe = vi.fn(async () => {})

beforeEach(() => {
  onChanged.mockClear()
  getAll.mockClear()
  subscribe.mockClear()

  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      preference: {
        onChanged,
        getAll,
        subscribe
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
