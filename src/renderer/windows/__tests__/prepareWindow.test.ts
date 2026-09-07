import { preferenceService } from '@data/PreferenceService'
import { getAppEdition } from '@renderer/utils/appEdition'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { prepareWindow } from '../prepareWindow'

const { initI18nMock } = vi.hoisted(() => ({ initI18nMock: vi.fn(async () => {}) }))
vi.mock('@renderer/i18n/resolver', () => ({ initI18n: initI18nMock }))

const { exposeControlSurfaceMock } = vi.hoisted(() => ({ exposeControlSurfaceMock: vi.fn() }))
vi.mock('@data/utils/dataApiDevtools', () => ({ DataApiDevtools: { exposeControlSurface: exposeControlSurfaceMock } }))

describe('prepareWindow', () => {
  beforeEach(() => {
    vi.stubGlobal('__APP_EDITION__', 'cn')
    vi.clearAllMocks()
    vi.mocked(window.api.ipcApi.request).mockResolvedValue({ ok: true, data: { edition: 'global' } })
  })

  afterEach(() => vi.stubGlobal('__APP_EDITION__', 'global'))

  it('resolves only after i18n, preferences and the effective edition are ready', async () => {
    let resolveI18n!: () => void
    let resolvePreload!: () => void
    let resolveEdition!: (value: unknown) => void
    vi.mocked(window.api.ipcApi.request).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveEdition = resolve
        })
    )
    initI18nMock.mockImplementationOnce(() => new Promise<void>((resolve) => (resolveI18n = resolve)))
    vi.mocked(preferenceService.preloadAll).mockImplementationOnce(
      () => new Promise<void>((resolve) => (resolvePreload = resolve))
    )

    let settled = false
    const pending = prepareWindow({ preference: 'all' }).then(() => (settled = true))

    await Promise.resolve()
    expect(settled).toBe(false)

    resolveI18n()
    await Promise.resolve()
    expect(settled).toBe(false)

    resolvePreload()
    await Promise.resolve()
    expect(settled).toBe(false)

    resolveEdition({ ok: true, data: { edition: 'global' } })
    await pending
    expect(settled).toBe(true)
    expect(getAppEdition()).toBe('global')
  })
  it('falls back to the package edition when the runtime edition cannot be loaded', async () => {
    vi.mocked(window.api.ipcApi.request).mockRejectedValueOnce(new Error('IPC unavailable'))
    await expect(prepareWindow({ preference: 'all' })).resolves.toBeUndefined()
    expect(getAppEdition()).toBe('cn')
  })
})
