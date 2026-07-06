import i18n, { initI18n } from '@renderer/i18n'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// The global renderer setup already calls initI18n(); these tests assert the
// lazy-load contract (on-demand pack loading, fallback, idempotency) explicitly.
// The mock preference language is zh-CN (tests/__mocks__/renderer/PreferenceService).
describe('renderer i18n lazy init', () => {
  let originalLanguage: string

  beforeAll(() => {
    // Capture after the global setup's initI18n() has run — at module-collection
    // time lazy init hasn't fired yet, so i18n.language would still be undefined.
    originalLanguage = i18n.language
  })

  afterAll(async () => {
    await i18n.changeLanguage(originalLanguage)
  })

  it('initializes with the preference language and loads its pack on demand', async () => {
    await initI18n()
    await i18n.changeLanguage('zh-CN')

    expect(i18n.language).toBe('zh-CN')
    expect(i18n.hasResourceBundle('zh-CN', 'translation')).toBe(true)
    expect(i18n.t('common.copy')).toBe('复制')
  })

  it('lazy-loads a not-yet-loaded pack when switching language', async () => {
    await i18n.changeLanguage('en-US')

    expect(i18n.language).toBe('en-US')
    expect(i18n.hasResourceBundle('en-US', 'translation')).toBe(true)
    expect(i18n.t('common.copy')).toBe('Copy')
  })

  it('falls back to en-US for a non-catalog language without throwing', async () => {
    await expect(i18n.changeLanguage('en-GB')).resolves.toBeTypeOf('function')

    // en-GB has no pack; resolution falls through the fallback chain to en-US.
    expect(i18n.t('common.copy')).toBe('Copy')
  })

  it('is idempotent — repeat callers share one memoized promise', () => {
    expect(initI18n()).toBe(initI18n())
  })
})
