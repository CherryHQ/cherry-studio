import enUS from '@renderer/i18n/locales/en-us.json'
import { describe, expect, it } from 'vitest'

import type { SettingsNavigationSection } from '../settingsNavigation'
import { buildSettingsSearchEntries, filterSettingsSearchEntries } from '../settingsSearch'

const createSections = (items: SettingsNavigationSection['items']): readonly SettingsNavigationSection[] => [{ items }]

describe('settings search', () => {
  it('assigns catalog keys to the longest dot-boundary prefix', () => {
    const sections = createSections([
      {
        path: '/settings/provider',
        labelKey: 'provider.title',
        icon: null,
        search: { prefixes: ['settings.models'] }
      },
      {
        path: '/settings/model',
        labelKey: 'model.title',
        icon: null,
        search: { prefixes: ['settings.model'] }
      },
      {
        path: '/settings/general',
        labelKey: 'general.title',
        icon: null,
        search: { prefixes: ['settings.models.context_management'] }
      }
    ])
    const catalog = {
      'general.title': 'General',
      'model.title': 'Default model',
      'provider.title': 'Model provider',
      'settings.model': 'Default model',
      'settings.models.add': 'Add model',
      'settings.models.context_management.title': 'Context management'
    }
    const entries = buildSettingsSearchEntries(sections, catalog, (key) => catalog[key] ?? key)

    expect(filterSettingsSearchEntries(entries, 'add').map((entry) => entry.path)).toEqual(['/settings/provider'])
    expect(filterSettingsSearchEntries(entries, 'default').map((entry) => entry.path)).toEqual(['/settings/model'])
    expect(filterSettingsSearchEntries(entries, 'context').map((entry) => entry.path)).toEqual(['/settings/general'])
  })

  it('matches the current language, English fallback, full pinyin, and pinyin initials', () => {
    const sections = createSections([
      {
        path: '/settings/general',
        labelKey: 'settings.general.common.title',
        icon: null,
        search: { prefixes: ['settings.proxy'] }
      }
    ])
    const catalog = {
      'settings.general.common.title': 'General',
      'settings.proxy.mode.system': 'System Proxy'
    }
    const translations: Record<string, string> = {
      'settings.general.common.title': '通用',
      'settings.proxy.mode.system': '系统代理'
    }
    const entries = buildSettingsSearchEntries(sections, catalog, (key) => translations[key] ?? key)

    for (const query of ['系统代理', 'system proxy', 'xitongdaili', 'xtdl']) {
      expect(filterSettingsSearchEntries(entries, query).map((entry) => entry.path)).toEqual(['/settings/general'])
    }
  })

  it('matches labels without requiring their display whitespace in the query', () => {
    const sections = createSections([
      {
        path: '/settings/api-gateway',
        labelKey: 'apiGateway.title',
        icon: null,
        search: { prefixes: ['apiGateway'] }
      }
    ])
    const catalog = {
      'apiGateway.apiKey': 'API Key',
      'apiGateway.title': 'API Gateway'
    }
    const translations: Record<string, string> = {
      'apiGateway.apiKey': 'API 密钥',
      'apiGateway.title': 'API 网关'
    }
    const entries = buildSettingsSearchEntries(sections, catalog, (key) => translations[key] ?? key)

    expect(filterSettingsSearchEntries(entries, 'API密钥').map((entry) => entry.path)).toEqual([
      '/settings/api-gateway'
    ])
  })

  it('requires every word in a query to match the same setting', () => {
    const sections = createSections([
      {
        path: '/settings/dependencies',
        labelKey: 'settings.dependencies.title',
        icon: null,
        search: { prefixes: ['settings.dependencies'] }
      }
    ])
    const catalog = {
      'settings.dependencies.proxy': 'Download proxy',
      'settings.dependencies.source.system': 'System',
      'settings.dependencies.title': 'Dependencies'
    }
    const entries = buildSettingsSearchEntries(sections, catalog, (key) => catalog[key] ?? key)

    expect(filterSettingsSearchEntries(entries, 'system proxy')).toEqual([])
  })

  it('adds exact legacy keys without stealing their prefix-owned page', () => {
    const sections = createSections([
      {
        path: '/settings/provider',
        labelKey: 'provider.title',
        icon: null,
        search: { prefixes: ['settings.provider'] }
      },
      {
        path: '/settings/websearch',
        labelKey: 'websearch.title',
        icon: null,
        search: { prefixes: ['settings.tool.websearch'], exactKeys: ['settings.provider.api_key'] }
      }
    ])
    const catalog = {
      'provider.title': 'Provider',
      'settings.provider.api_key': 'API Key',
      'websearch.title': 'Web Search'
    }
    const entries = buildSettingsSearchEntries(sections, catalog, (key) => catalog[key] ?? key)

    expect(filterSettingsSearchEntries(entries, 'api key').map((entry) => entry.path)).toEqual([
      '/settings/provider',
      '/settings/websearch'
    ])
  })

  it('keeps the checked-in navigation search scopes valid against the source catalog', async () => {
    const { settingsNavigationSections } = await import('../settingsNavigation')
    const sections: readonly SettingsNavigationSection[] = settingsNavigationSections
    const items = sections.flatMap((section) => section.items)
    const prefixes = items.flatMap((item) => item.search.prefixes)

    expect(new Set(items.map((item) => item.path)).size).toBe(items.length)
    expect(new Set(prefixes).size).toBe(prefixes.length)

    for (const item of items) {
      expect(enUS).toHaveProperty(item.labelKey)
      for (const prefix of item.search.prefixes) {
        expect(
          Object.keys(enUS).some((key) => key === prefix || key.startsWith(`${prefix}.`)),
          `Missing catalog prefix: ${prefix}`
        ).toBe(true)
      }
      for (const key of item.search.exactKeys ?? []) {
        expect(enUS).toHaveProperty(key)
      }
    }
  })
})
