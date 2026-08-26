import { readdirSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

import enUS from '@renderer/i18n/locales/en-us.json'
import zhCN from '@renderer/i18n/locales/zh-cn.json'
import { describe, expect, it } from 'vitest'

import { settingsMenu } from '../../settingsMenu'
import { settingsSearchSections } from '../aggregate'
import { getSettingDomId } from '../types'

/** Resolves a dotted i18n key. Catalogs are flat (#19143): the dotted path is
 *  the literal key. The nested walk stays as a fallback for pre-flattened
 *  revisions so the guard keeps working across the transition window. */
function lookup(locale: unknown, key: string): unknown {
  if (locale != null && typeof locale === 'object' && key in (locale as Record<string, unknown>)) {
    return (locale as Record<string, unknown>)[key]
  }
  return key.split('.').reduce<unknown>((node, part) => {
    if (node != null && typeof node === 'object') return (node as Record<string, unknown>)[part]
    return undefined
  }, locale)
}

/** Every *.search.ts the aggregator would glob — drift must fail here, not silently */
const globbedSearchModules = import.meta.glob('../../**/*.search.ts', { eager: true }) as Record<
  string,
  { route?: unknown }
>

const SCAN_ROOTS = [resolve('src/renderer/pages/settings'), resolve('src/renderer/components/chat/settings')]

/** Collects literal `id="setting-…"` / `'setting-…'` strings plus `id={`setting-…-${` dynamic prefixes */
function collectAnchorIds(root: string, literals: Set<string>, dynamicPrefixes: Set<string>) {
  for (const name of readdirSync(root)) {
    const full = resolve(root, name)
    if (statSync(full).isDirectory()) {
      if (name === '__tests__') continue
      collectAnchorIds(full, literals, dynamicPrefixes)
    } else if (/\.tsx?$/.test(name)) {
      const src = readFileSync(full, 'utf8')
      for (const m of src.matchAll(/['"](setting-[a-z0-9-]+)['"]/g)) literals.add(m[1])
      for (const m of src.matchAll(/id=\{`(setting-[a-z0-9-]+)-\$\{/g)) dynamicPrefixes.add(m[1])
    }
  }
}

const literalAnchorIds = new Set<string>()
const dynamicAnchorPrefixes = new Set<string>()
for (const root of SCAN_ROOTS) collectAnchorIds(root, literalAnchorIds, dynamicAnchorPrefixes)

const anchorExists = (domId: string) =>
  literalAnchorIds.has(domId) || [...dynamicAnchorPrefixes].some((prefix) => domId.startsWith(`${prefix}-`))

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

  it('registers every globbed *.search.ts module under a menu route (a route typo must fail)', () => {
    const files = Object.keys(globbedSearchModules)
    // Guard the guard: a broken glob would otherwise pass vacuously
    expect(files.length).toBeGreaterThanOrEqual(5)
    const menuRoutes = new Set(settingsMenu.map((m) => m.route))
    for (const [file, mod] of Object.entries(globbedSearchModules)) {
      expect(mod.route, `${file} must export a route string`).toBeTypeOf('string')
      expect(menuRoutes.has(mod.route as string), `${file} route "${mod.route}" is not in the menu`).toBe(true)
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
        // auth- entries flash the provider page's dynamic section
        // setting-provider-auth-<providerId> — a mismatched tail (e.g. a brand
        // name diverging from the real provider id) silently kills the scroll.
        if (entry.anchorId.startsWith('auth-') && entry.providerId) {
          expect(entry.anchorId, `${entry.anchorId} must end with its providerId`).toBe(`auth-${entry.providerId}`)
        }
        expect(domIds.has(domId), `duplicate dom id ${domId}`).toBe(false)
        domIds.add(domId)
      }
    }
  })

  it('every indexed focus id exists as an anchor in the settings TSX (dead anchors must fail)', () => {
    // Guard the guard: the scan must have found the hand-written anchors
    expect(literalAnchorIds.size).toBeGreaterThan(50)
    for (const section of settingsSearchSections) {
      for (const entry of section.entries) {
        const domId = getSettingDomId(entry.route ?? section.route, entry.anchorId)
        expect(anchorExists(domId), `no JSX anchor found for ${domId}`).toBe(true)
      }
    }
  })
})
