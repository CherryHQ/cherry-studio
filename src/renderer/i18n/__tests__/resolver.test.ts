import dayjs from 'dayjs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { appLanguageOptions, isAppLanguage } from '@renderer/i18n/languages'
import i18n, { initI18n, setDayjsLocale } from '@renderer/i18n/resolver'
import { DOCTOR_CHECK_CATALOG, DOCTOR_CHECK_IDS } from '@shared/types/doctor'
import { doctorCheckDetailKey, doctorCheckTitleKey } from '@shared/utils/doctor'

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

  it('lazy-loads the Italian pack when switching language', async () => {
    await i18n.changeLanguage('it-IT')

    expect(i18n.hasResourceBundle('it-IT', 'translation')).toBe(true)
    expect(i18n.t('common.copy')).toBe('Copia')
  })

  it('offers Korean and loads Korean text when selected', async () => {
    expect(appLanguageOptions.find((option) => option.value === 'ko-KR')?.label).toBe('한국어')
    expect(isAppLanguage('ko-KR')).toBe(true)
    await i18n.changeLanguage('ko-KR')

    expect(i18n.t('common.copy')).toBe('복사')
  })

  it('formats dates in Korean after switching the date locale', () => {
    const originalLocale = dayjs.locale()
    try {
      setDayjsLocale('ko-KR')
      expect(dayjs('2026-11-18').format('MMMM dddd')).toBe('11월 수요일')
    } finally {
      dayjs.locale(originalLocale)
    }
  })

  it('lazy-loads the Turkish pack when switching language', async () => {
    await i18n.changeLanguage('tr-TR')

    expect(i18n.hasResourceBundle('tr-TR', 'translation')).toBe(true)
    expect(i18n.t('common.copy')).toBe('Kopyala')
  })

  it('lazy-loads the Thai pack when switching language', async () => {
    await i18n.changeLanguage('th-TH')

    expect(i18n.hasResourceBundle('th-TH', 'translation')).toBe(true)
    expect(i18n.t('common.copy')).toBe('คัดลอก')
  })

  it('defines English labels for every Doctor check and declared detail', async () => {
    await i18n.changeLanguage('en-US')

    for (const checkId of DOCTOR_CHECK_IDS) {
      const titleKey = doctorCheckTitleKey(checkId)
      expect(i18n.exists(titleKey), `Missing Doctor title: ${titleKey}`).toBe(true)

      for (const variant of DOCTOR_CHECK_CATALOG[checkId].details) {
        const detailKey = doctorCheckDetailKey(checkId, variant)
        expect(i18n.exists(detailKey), `Missing Doctor detail: ${detailKey}`).toBe(true)
      }
    }
  })

  it('falls back to en-US for a non-catalog language without throwing', async () => {
    await expect(i18n.changeLanguage('en-GB')).resolves.toBeTypeOf('function')

    // en-GB has no pack; resolution falls through the fallback chain to en-US.
    expect(i18n.t('common.copy')).toBe('Copy')
  })
})

// Catches a count falling back to English where i18next asks for a `_few` / `_many` form the locale lacks.
describe('renderer i18n plural forms', () => {
  afterAll(async () => {
    await i18n.changeLanguage('zh-CN')
  })

  it.each([
    ['ru-RU', 2],
    ['ru-RU', 5],
    ['ro-RO', 2],
    ['ro-RO', 25]
  ])('counts in %s at %i without the English fallback', async (language, count) => {
    await initI18n()
    await i18n.changeLanguage(language)

    for (const key of [
      'message.tools.identity_card.changes',
      'chat.profile_pane.outputs.count',
      'chat.profile_pane.recent_topics.messages'
    ]) {
      const text = i18n.t(key, { count })
      expect(text).toContain(String(count))
      expect(text).not.toBe(i18n.t(key, { count, lng: 'en-US' }))
    }
  })
})
