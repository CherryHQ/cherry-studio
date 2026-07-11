import { preferenceService } from '@data/PreferenceService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { prepareWindow } from '../prepareWindow'

const { initI18nMock } = vi.hoisted(() => ({ initI18nMock: vi.fn(async () => {}) }))
vi.mock('@renderer/i18n/resolver', () => ({ initI18n: initI18nMock }))

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
