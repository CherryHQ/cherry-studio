import { preferenceService } from '@data/PreferenceService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { prepareWindow } from '../prepareWindow'

const { i18nState, initI18nMock } = vi.hoisted(() => ({
  i18nState: { language: 'zh-CN', resolvedLanguage: 'zh-CN' },
  initI18nMock: vi.fn(async () => {})
}))
vi.mock('@renderer/i18n/resolver', () => ({ default: i18nState, initI18n: initI18nMock }))

describe('prepareWindow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    i18nState.language = 'zh-CN'
    i18nState.resolvedLanguage = 'zh-CN'
  })

  afterEach(() => {
    document.documentElement.removeAttribute('dir')
    document.documentElement.removeAttribute('lang')
  })

  it("warms the full preference cache and initializes i18n for preference: 'all'", async () => {
    await prepareWindow({ preference: 'all' })

    expect(preferenceService.preloadAll).toHaveBeenCalledTimes(1)
    expect(preferenceService.preload).not.toHaveBeenCalled()
    expect(initI18nMock).toHaveBeenCalledTimes(1)
    expect(document.documentElement).toHaveAttribute('lang', 'zh-CN')
    expect(document.documentElement).toHaveAttribute('dir', 'ltr')
  })

  it('preloads exactly the given keys for a key-list preference', async () => {
    await prepareWindow({ preference: ['ui.theme_mode', 'app.language'] })

    expect(preferenceService.preload).toHaveBeenCalledExactlyOnceWith(['ui.theme_mode', 'app.language'])
    expect(preferenceService.preloadAll).not.toHaveBeenCalled()
    expect(initI18nMock).toHaveBeenCalledTimes(1)
  })

  it('applies the resolved RTL language before the preparation promise resolves', async () => {
    i18nState.language = 'ar-YE'
    i18nState.resolvedLanguage = 'ar-YE'

    await prepareWindow({ preference: ['app.language'] })

    expect(document.documentElement).toHaveAttribute('lang', 'ar-YE')
    expect(document.documentElement).toHaveAttribute('dir', 'rtl')
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
