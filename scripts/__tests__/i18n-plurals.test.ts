/** Covers locale plural forms that the English-parity catalog rules would otherwise reject or drop. */
import * as fs from 'fs'
import * as path from 'path'

import { createInstance } from 'i18next'
import { describe, expect, it } from 'vitest'

import { localeKeySpec, localeOnlyPluralSiblings, pluralStems } from '../i18n-plurals'

const base = {
  'chat.lane_other': 'Other',
  days_lt_one: 'Less than 1 day',
  days_one: '{{count}} day',
  days_other: '{{count}} days',
  title: 'Title'
}

describe('pluralStems', () => {
  it('only treats keys with both _one and _other as plural', () => {
    expect([...pluralStems(base)]).toEqual(['days'])
  })
})

describe('localeKeySpec', () => {
  it('requires every Polish plural form, translated from the English _other text', () => {
    const spec = localeKeySpec(base, 'pl-pl.json')
    expect([...spec.required].sort()).toEqual([
      'chat.lane_other',
      'days_few',
      'days_lt_one',
      'days_many',
      'days_one',
      'days_other',
      'title'
    ])
    expect(spec.sourceKey.get('days_many')).toBe('days_other')
  })

  it('allows but does not require extra forms for locales not yet complete', () => {
    const spec = localeKeySpec(base, 'ru-ru.json')
    expect(spec.required.has('days_few')).toBe(false)
    expect(spec.allowed.has('days_few')).toBe(true)
  })

  it('rejects plural forms the language does not use', () => {
    const spec = localeKeySpec(base, 'de-de.json')
    expect(spec.allowed.has('days_few')).toBe(false)
    expect(spec.allowed.has('chat.lane_few')).toBe(false)
  })
})

describe('localeOnlyPluralSiblings', () => {
  it('removes locale-only forms together with the English _other key', () => {
    expect(localeOnlyPluralSiblings('days_other')).toEqual(['days_zero', 'days_two', 'days_few', 'days_many'])
    expect(localeOnlyPluralSiblings('days_one')).toEqual([])
  })
})

describe('Polish renderer catalog', () => {
  it('resolves every plural count to Polish text instead of the English fallback', async () => {
    const read = (name: string) =>
      JSON.parse(fs.readFileSync(path.join(__dirname, '../../src/renderer/i18n/locales', name), 'utf-8'))
    const i18n = createInstance()
    await i18n.init({
      lng: 'pl-PL',
      fallbackLng: 'en-US',
      keySeparator: false,
      resources: { 'pl-PL': { translation: read('pl-pl.json') }, 'en-US': { translation: read('en-us.json') } }
    })

    expect(i18n.t('settings.data.trash.retention.days', { count: 1 })).toBe('1 dzień')
    expect(i18n.t('settings.data.trash.retention.days', { count: 30 })).toBe('30 dni')
    expect(i18n.t('message.tools.units.file', { count: 3 })).toBe('3 pliki')
    expect(i18n.t('message.tools.units.file', { count: 12 })).toBe('12 plików')
  })
})
