import enUS from '@renderer/i18n/locales/en-us.json'
import zhCN from '@renderer/i18n/locales/zh-cn.json'
import { describe, expect, it } from 'vitest'

import { settingsMenu } from '../../settingsMenu'
import { settingsSearchSections } from '../aggregate'
import { getSettingDomId } from '../types'

/** Resolves a dotted i18n key inside the nested locale catalog */
function lookup(locale: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((node, part) => {
    if (node != null && typeof node === 'object') return (node as Record<string, unknown>)[part]
    return undefined
  }, locale)
}

describe('settings search index', () => {
  it('exposes one searchable section per menu entry, in menu order', () => {
    expect(settingsSearchSections.map((s) => s.route)).toEqual(settingsMenu.map((m) => m.route))
    expect(settingsSearchSections.map((s) => s.sectionTitleKey)).toEqual(settingsMenu.map((m) => m.titleKey))
  })

  it('has every menu title resolvable in zh-cn and en-us', () => {
    for (const item of settingsMenu) {
      expect(lookup(zhCN, item.titleKey), `zh-cn missing ${item.titleKey}`).toBeTruthy()
      expect(lookup(enUS, item.titleKey), `en-us missing ${item.titleKey}`).toBeTruthy()
    }
  })

  it('indexes only sections registered in the menu (glob modules with unknown routes are dropped)', () => {
    const menuRoutes = new Set(settingsMenu.map((m) => m.route))
    for (const section of settingsSearchSections) {
      expect(menuRoutes.has(section.route), `section ${section.route} not in menu`).toBe(true)
    }
  })

  it('has unique leaf dom ids and locale-resolvable keys', () => {
    const domIds = new Set<string>()
    for (const section of settingsSearchSections) {
      for (const entry of section.entries) {
        expect(entry.anchorId, `${section.route} anchorId must be kebab-case`).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
        expect(lookup(zhCN, entry.titleKey), `zh-cn missing ${entry.titleKey}`).toBeTruthy()
        expect(lookup(enUS, entry.titleKey), `en-us missing ${entry.titleKey}`).toBeTruthy()
        for (const key of [entry.descriptionKey, entry.groupKey]) {
          if (!key) continue
          expect(lookup(zhCN, key), `zh-cn missing ${key}`).toBeTruthy()
          expect(lookup(enUS, key), `en-us missing ${key}`).toBeTruthy()
        }
        const domId = getSettingDomId(entry.route ?? section.route, entry.anchorId)
        expect(domIds.has(domId), `duplicate dom id ${domId}`).toBe(false)
        domIds.add(domId)
      }
    }
  })
})
