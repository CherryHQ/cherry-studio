import { preferenceService } from '@data/PreferenceService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { prepareWindow } from '../prepareWindow'

const { initI18nMock } = vi.hoisted(() => ({ initI18nMock: vi.fn(async () => {}) }))
vi.mock('@renderer/i18n/resolver', () => ({ initI18n: initI18nMock }))

const { exposeControlSurfaceMock } = vi.hoisted(() => ({ exposeControlSurfaceMock: vi.fn() }))
vi.mock('@data/utils/dataApiDevtools', () => ({ DataApiDevtools: { exposeControlSurface: exposeControlSurfaceMock } }))

const { appInfoPreloadMock } = vi.hoisted(() => ({ appInfoPreloadMock: vi.fn(async () => {}) }))
vi.mock('@renderer/services/AppInfoService', () => ({ appInfoService: { preload: appInfoPreloadMock } }))

describe('prepareWindow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("warms the full preference cache and initializes i18n for preference: 'all'", async () => {
    await prepareWindow({ preference: 'all' })

    expect(preferenceService.preloadAll).toHaveBeenCalledTimes(1)
    expect(preferenceService.preload).not.toHaveBeenCalled()
    expect(initI18nMock).toHaveBeenCalledTimes(1)
    expect(appInfoPreloadMock).not.toHaveBeenCalled()
  })

  it('preloads exactly the given keys for a key-list preference', async () => {
    await prepareWindow({ preference: ['ui.theme_mode', 'app.language'] })

    expect(preferenceService.preload).toHaveBeenCalledExactlyOnceWith(['ui.theme_mode', 'app.language'])
    expect(preferenceService.preloadAll).not.toHaveBeenCalled()
    expect(initI18nMock).toHaveBeenCalledTimes(1)
  })

  it('exposes the DataApi DevTools control surface synchronously, before any awaited warm-up', () => {
    const pending = prepareWindow({ preference: 'all' })

    expect(exposeControlSurfaceMock).toHaveBeenCalledTimes(1)
    return pending
  })

  it('preloads app info when the first frame needs application identity', async () => {
    await prepareWindow({ preference: 'all', appInfo: true })

    expect(appInfoPreloadMock).toHaveBeenCalledTimes(1)
  })

  it('waits for requested app info before resolving', async () => {
    let resolveAppInfo!: () => void
    appInfoPreloadMock.mockImplementationOnce(() => new Promise<void>((resolve) => (resolveAppInfo = resolve)))

    let settled = false
    const pending = prepareWindow({ preference: 'all', appInfo: true }).then(() => (settled = true))

    await Promise.resolve()
    expect(settled).toBe(false)

    resolveAppInfo()
    await pending
    expect(settled).toBe(true)
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
