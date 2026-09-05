import i18n, { initI18n } from '@renderer/i18n/resolver'
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

  it('lazy-loads the Turkish pack when switching language', async () => {
    await i18n.changeLanguage('tr-TR')

    expect(i18n.hasResourceBundle('tr-TR', 'translation')).toBe(true)
    expect(i18n.t('common.copy')).toBe('Kopyala')
  })

  it('uses singular and plural diagnostic file summaries in English', async () => {
    await i18n.changeLanguage('en-US')

    expect(i18n.t('settings.about.diagnostics.sources.summary', { count: 1, size: '1 KB' })).toBe('1 file, about 1 KB')
    expect(i18n.t('settings.about.diagnostics.sources.summary', { count: 2, size: '2 KB' })).toBe('2 files, about 2 KB')
  })

  it('distinguishes quick basic checks from full checks in English and Simplified Chinese', async () => {
    await i18n.changeLanguage('en-US')
    expect(i18n.t('settings.doctor.actions.run_basic')).toBe('Quick basic checks')
    expect(i18n.t('settings.doctor.actions.run_network')).toBe('Full check')
    expect(i18n.t('settings.doctor.panel_descriptions.checks')).toBe(
      'Full checks rerun the basic checks and include network and service checks.'
    )

    await i18n.changeLanguage('zh-CN')
    expect(i18n.t('settings.doctor.actions.run_basic')).toBe('重跑基础检查')
    expect(i18n.t('settings.doctor.actions.run_network')).toBe('完整检查')
    expect(i18n.t('settings.doctor.panel_descriptions.checks')).toBe('完整检查会重新运行基础项，并加入网络与服务检查。')
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
