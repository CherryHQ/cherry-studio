import { describe, expect, it } from 'vitest'

import { rankEntries } from '../searchEngine'
import type { SettingsSearchSection } from '../types'

const dict: Record<string, string> = {
  'group.general': '通用',
  's.appearance.title': '外观',
  's.data.title': '数据',
  's.general.title': '通用设置',
  'e.proxy.title': '代理',
  'e.proxy.desc': '网络代理设置',
  'e.theme.title': '主题',
  'e.theme.desc': '外观主题'
}
const t = (key: string) => dict[key] ?? key

const sections: SettingsSearchSection[] = [
  { route: '/settings/general', sectionTitleKey: 's.general.title', entries: [] },
  {
    route: '/settings/appearance',
    sectionTitleKey: 's.appearance.title',
    entries: [
      {
        anchorId: 'proxy',
        titleKey: 'e.proxy.title',
        descriptionKey: 'e.proxy.desc',
        groupKey: 'group.general',
        aliases: ['proxy', '代理服务器']
      },
      { anchorId: 'theme', titleKey: 'e.theme.title', descriptionKey: 'e.theme.desc' }
    ]
  },
  { route: '/settings/data', sectionTitleKey: 's.data.title', entries: [] }
]

describe('rankEntries scoring tiers', () => {
  it('ranks section title > entry title > description > alias for the same query', () => {
    const fixture: SettingsSearchSection[] = [
      { route: '/s1', sectionTitleKey: 'k.sec', entries: [] },
      { route: '/s2', sectionTitleKey: 'k.other', entries: [{ anchorId: 'a', titleKey: 'k.title' }] },
      {
        route: '/s3',
        sectionTitleKey: 'k.other2',
        entries: [{ anchorId: 'a', titleKey: 'k.unrelated', descriptionKey: 'k.title' }]
      },
      {
        route: '/s4',
        sectionTitleKey: 'k.other3',
        entries: [{ anchorId: 'a', titleKey: 'k.unrelated', aliases: ['alpha'] }]
      }
    ]
    const fx: Record<string, string> = {
      'k.sec': 'alpha',
      'k.other': 'zzz',
      'k.other2': 'zzz2',
      'k.other3': 'zzz3',
      'k.unrelated': 'zzz4',
      'k.title': 'alpha'
    }
    const ranked = rankEntries('alpha', fixture, (k) => fx[k] ?? k)

    expect(ranked.map((r) => r.route)).toEqual(['/s1', '/s2', '/s3', '/s4'])
    expect(ranked.map((r) => r.score)).toEqual([900, 700, 500, 300])
  })

  it('splits each tier into exact > prefix > substring', () => {
    const fixture: SettingsSearchSection[] = [
      { route: '/exact', sectionTitleKey: 'k1', entries: [] },
      { route: '/prefix', sectionTitleKey: 'k2', entries: [] },
      { route: '/substring', sectionTitleKey: 'k3', entries: [] }
    ]
    const fx: Record<string, string> = { k1: '代理', k2: '代理地址', k3: '网络代理' }
    const ranked = rankEntries('代理', fixture, (k) => fx[k] ?? k)

    expect(ranked.map((r) => r.route)).toEqual(['/exact', '/prefix', '/substring'])
    expect(ranked.map((r) => r.score)).toEqual([900, 850, 800])
  })

  it('pinyin-matches titles but never descriptions', () => {
    // daili hits the title 代理 (pinyin, title substring grade 600); the
    // description 网络代理设置 contains Chinese too but must stay unmatched
    const ranked = rankEntries('daili', sections, t)

    expect(ranked).toHaveLength(1)
    expect(ranked[0]?.title).toBe('代理')
    expect(ranked[0]?.score).toBe(600)
  })
})

describe('rankEntries tie-breaking', () => {
  it('breaks equal scores by menu order first, then declaration order within a section', () => {
    const fixture: SettingsSearchSection[] = [
      { route: '/first', sectionTitleKey: 'k.a', entries: [{ anchorId: 'x', titleKey: 'k.hit' }] },
      { route: '/second', sectionTitleKey: 'k.b', entries: [{ anchorId: 'y', titleKey: 'k.hit' }] },
      {
        route: '/third',
        sectionTitleKey: 'k.c',
        entries: [
          { anchorId: 'e1', titleKey: 'k.hit' },
          { anchorId: 'e2', titleKey: 'k.hit' }
        ]
      }
    ]
    const fx: Record<string, string> = { 'k.a': 'aa', 'k.b': 'bb', 'k.c': 'cc', 'k.hit': 'target' }
    const ranked = rankEntries('target', fixture, (k) => fx[k] ?? k)

    expect(ranked.map((r) => r.focusId)).toEqual([
      'setting-first-x',
      'setting-second-y',
      'setting-third-e1',
      'setting-third-e2'
    ])
  })
})

describe('rankEntries pinyin matching', () => {
  it('matches Chinese titles by full pinyin and initials at the title substring grade', () => {
    expect(rankEntries('daili', sections, t)[0]?.title).toBe('代理')
    expect(rankEntries('dl', sections, t)[0]?.title).toBe('代理')
  })

  it('matches Chinese aliases by full pinyin at the alias grade', () => {
    // 代理服务器 → dailifuwuqi; the title 代理 does not contain that string
    const ranked = rankEntries('dailifuwuqi', sections, t)

    expect(ranked.map((r) => r.title)).toEqual(['代理'])
    expect(ranked[0]?.score).toBe(200)
  })

  it('scores latin alias exact hits at the alias grade', () => {
    const ranked = rankEntries('proxy', sections, t)

    expect(ranked.map((r) => r.title)).toEqual(['代理'])
    expect(ranked[0]?.score).toBe(300)
  })
})

describe('rankEntries boundaries', () => {
  it('returns empty for blank or oversized queries', () => {
    expect(rankEntries('   ', sections, t)).toEqual([])
    expect(rankEntries('x'.repeat(2049), sections, t)).toEqual([])
  })

  it('caps results at 50', () => {
    const many: SettingsSearchSection[] = Array.from({ length: 60 }, (_, i) => ({
      route: `/s${i}`,
      sectionTitleKey: `k${i}`,
      entries: [{ anchorId: 'a', titleKey: 'k.hit' }]
    }))
    const fx: Record<string, string> = { 'k.hit': 'target' }
    const ranked = rankEntries('target', many, (k) => fx[k] ?? k)

    expect(ranked).toHaveLength(50)
  })

  it('returns a section-level result without focusId for menu title hits', () => {
    const ranked = rankEntries('数据', sections, t)

    expect(ranked).toHaveLength(1)
    expect(ranked[0]).toMatchObject({ route: '/settings/data', title: '数据' })
    expect(ranked[0]?.focusId).toBeUndefined()
  })

  it('uses the entry-level route override for navigation and focus ids', () => {
    const fixture: SettingsSearchSection[] = [
      {
        route: '/settings/mcp',
        sectionTitleKey: 'k.mcp',
        entries: [{ anchorId: 'servers', titleKey: 'k.hit', route: '/settings/mcp/servers' }]
      }
    ]
    const fx: Record<string, string> = { 'k.mcp': 'mcp', 'k.hit': 'target' }
    const [hit] = rankEntries('target', fixture, (k) => fx[k] ?? k)

    expect(hit?.route).toBe('/settings/mcp/servers')
    expect(hit?.focusId).toBe('setting-mcp-servers-servers')
  })

  it('builds the breadcrumb from group and section titles', () => {
    const [hit] = rankEntries('代理', sections, t)

    expect(hit?.breadcrumb).toEqual(['通用', '外观'])
    expect(hit?.description).toBe('网络代理设置')
  })
})
