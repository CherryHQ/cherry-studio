import i18n, { initI18n, removeTranslationMarkers } from '@renderer/i18n/resolver'
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

  it('uses singular and plural diagnostic file summaries in English', async () => {
    await i18n.changeLanguage('en-US')

    expect(i18n.t('settings.about.diagnostics.sources.summary', { count: 1, size: '1 KB' })).toBe('1 file, about 1 KB')
    expect(i18n.t('settings.about.diagnostics.sources.summary', { count: 2, size: '2 KB' })).toBe('2 files, about 2 KB')
  })

  it('falls back to en-US for a non-catalog language without throwing', async () => {
    await expect(i18n.changeLanguage('en-GB')).resolves.toBeTypeOf('function')

    // en-GB has no pack; resolution falls through the fallback chain to en-US.
    expect(i18n.t('common.copy')).toBe('Copy')
  })

  it('is idempotent — repeat callers share one memoized promise', () => {
    expect(initI18n()).toBe(initI18n())
  })

  it('falls back to en-US when the locale pack carries an untranslated marker', async () => {
    // The ja-JP translate pack has "[to be translated]:..." on keys not yet
    // human-translated. resolver strips marker-bearing leaves so i18next treats the
    // key as missing and falls back to en-US, instead of surfacing the raw marker.
    await i18n.changeLanguage('ja-JP')

    expect(i18n.t('backup.credentials_warning')).toBe(
      'This backup includes API keys and provider credentials in plaintext. Store the archive securely.'
    )
  })
})

describe('removeTranslationMarkers', () => {
  it('keeps a fully-translated string unchanged', () => {
    expect(removeTranslationMarkers('hello')).toBe('hello')
  })

  it('strips a marker-bearing string to undefined', () => {
    expect(removeTranslationMarkers('[to be translated]:hello')).toBeUndefined()
  })

  it('removes only marker leaves from a nested object', () => {
    const pack = { a: 'ok', b: '[to be translated]:bad', nested: { c: 'ok', d: '[to be translated]:bad' } }
    expect(removeTranslationMarkers(pack)).toEqual({ a: 'ok', nested: { c: 'ok' } })
  })

  it('drops marker slots from arrays instead of leaving holes', () => {
    expect(removeTranslationMarkers(['ok', '[to be translated]:bad', 'ok2'])).toEqual(['ok', 'ok2'])
  })
})
