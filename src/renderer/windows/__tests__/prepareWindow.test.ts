import { preferenceService } from '@data/PreferenceService'
import { mockRendererLoggerService } from '@test-mocks/RendererLoggerService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { prepareWindow } from '../prepareWindow'

const { initI18nMock } = vi.hoisted(() => ({ initI18nMock: vi.fn(async () => {}) }))
vi.mock('@renderer/i18n/resolver', () => ({ initI18n: initI18nMock }))

const { exposeControlSurfaceMock } = vi.hoisted(() => ({ exposeControlSurfaceMock: vi.fn() }))
vi.mock('@data/services/dataApiDevtools', () => ({
  DataApiDevtools: { exposeControlSurface: exposeControlSurfaceMock }
}))

describe('prepareWindow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("warms the full preference cache and initializes i18n for preference: 'all'", async () => {
    await prepareWindow({ preference: 'all' })

    expect(preferenceService.preloadAll).toHaveBeenCalledTimes(1)
    expect(preferenceService.preload).not.toHaveBeenCalled()
    expect(initI18nMock).toHaveBeenCalledTimes(1)
  })

  it('preloads exactly the given keys for a key-list preference', async () => {
    await prepareWindow({ preference: ['ui.theme_mode', 'app.language'] })

    expect(preferenceService.preload).toHaveBeenCalledExactlyOnceWith(['ui.theme_mode', 'app.language'])
    expect(preferenceService.preloadAll).not.toHaveBeenCalled()
    expect(initI18nMock).toHaveBeenCalledTimes(1)
  })

  it('waits for the DataApi DevTools control surface before window preparation completes', async () => {
    let resolveDevtools!: () => void
    exposeControlSurfaceMock.mockImplementationOnce(() => new Promise<void>((resolve) => (resolveDevtools = resolve)))
    let settled = false
    const pending = prepareWindow({ preference: 'all' }).then(() => (settled = true))

    await vi.waitFor(() => expect(exposeControlSurfaceMock).toHaveBeenCalledTimes(1))
    await Promise.resolve()
    expect(settled).toBe(false)

    resolveDevtools()
    await pending
    expect(settled).toBe(true)
  })

  it('continues window preparation when development DevTools fail to initialize', async () => {
    const loggerWarnSpy = vi.spyOn(mockRendererLoggerService, 'warn').mockImplementation(() => undefined)
    exposeControlSurfaceMock.mockRejectedValueOnce(new Error('recorder chunk failed'))

    try {
      await expect(prepareWindow({ preference: 'all' })).resolves.toBeUndefined()

      expect(initI18nMock).toHaveBeenCalledTimes(1)
      expect(preferenceService.preloadAll).toHaveBeenCalledTimes(1)
      expect(loggerWarnSpy).toHaveBeenCalledWith('Failed to initialize DataApi DevTools', expect.any(Error))
    } finally {
      loggerWarnSpy.mockRestore()
    }
  })

  it('resolves only after both i18n and the preference warm-up complete', async () => {
    let resolveI18n!: () => void
    let resolvePreload!: () => void
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
    await pending
    expect(settled).toBe(true)
  })
})
