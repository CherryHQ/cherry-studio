import { describe, expect, it } from 'vitest'

import { calculateMatchScore, defaultFilterFn, defaultSortFn } from '../defaultStrategies'
import type { QuickPanelListItem } from '../types'

function matches(item: QuickPanelListItem, searchText: string) {
  const fuzzyRegex = new RegExp(
    searchText
      .toLowerCase()
      .split('')
      .map((char) => char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*'),
    'i'
  )
  return defaultFilterFn(item, searchText, fuzzyRegex, new WeakMap())
}

describe('default QuickPanel filtering', () => {
  it('keeps filterText additive with label, description, and search aliases', () => {
    const item: QuickPanelListItem = {
      label: 'Visible label',
      description: 'Readable description',
      filterText: 'explicit-field',
      searchAliases: ['Hidden alias'],
      icon: 'icon'
    }

    expect(matches(item, 'explicit')).toBe(true)
    expect(matches(item, 'visible')).toBe(true)
    expect(matches(item, 'readable')).toBe(true)
    expect(matches(item, 'hidden')).toBe(true)
  })

  it('matches literal characters in order without treating punctuation as regex syntax', () => {
    const item = { label: 'Cherry [Studio].', icon: 'icon' }

    expect(matches(item, 'c[s].')).toBe(true)
    expect(matches(item, 's[c')).toBe(false)
    expect(matches(item, 'c.*s')).toBe(false)
    expect(matches({ label: 'ς-x', icon: 'icon' }, 'σx')).toBe(true)
  })

  it('keeps pinyin subsequences and aliases searchable', () => {
    const item = { label: '中文搜索', searchAliases: ['Find documents'], icon: 'icon' }

    expect(matches(item, 'ZWSS')).toBe(true)
    expect(matches(item, 'fdoc')).toBe(true)
    expect(matches(item, 'sszw')).toBe(false)
  })

  it.each(['\n', '\r', '\u2028', '\u2029'])('does not skip a %j line terminator', (separator) => {
    expect(matches({ label: `a${separator}b`, icon: 'icon' }, 'ab')).toBe(false)
    expect(matches({ label: `a${separator}a-b`, icon: 'icon' }, 'ab')).toBe(true)
    expect(matches({ label: `ax${separator}xb`, icon: 'icon' }, `a${separator}b`)).toBe(true)
  })

  it('can restart a multiline match after an overlapping incomplete prefix', () => {
    expect(matches({ label: 'a\na\na-b', icon: 'icon' }, 'a\nab')).toBe(true)
    expect(matches({ label: 'a\na\nb', icon: 'icon' }, 'a\nab')).toBe(false)
  })

  it('filters long repeated-character queries without freezing the prompt panel', () => {
    const item = { label: 'Prompt', description: 'a'.repeat(2000), icon: 'icon' }
    const query = 'a'.repeat(1000) + 'b'
    const start = performance.now()

    expect(matches(item, query)).toBe(false)
    expect(matches({ ...item, description: 'ax'.repeat(2000) }, 'a'.repeat(1000))).toBe(true)
    expect(performance.now() - start).toBeLessThan(100)
  })
})

describe('default QuickPanel sorting', () => {
  it('ranks exact, slash-command, prefix, label-substring, alias, description, and fallback matches in order', () => {
    const descriptionItem: QuickPanelListItem = {
      label: 'session-cleanup',
      description: 'compact context before archiving',
      filterText: 'session-cleanup compact context before archiving',
      icon: 'icon'
    }
    const aliasSubstringItem: QuickPanelListItem = {
      label: 'Cleanup',
      searchAliases: ['run compact pass'],
      icon: 'icon'
    }
    const labelSubstringItem: QuickPanelListItem = {
      label: 'my-compact-tool',
      description: 'helper',
      icon: 'icon'
    }
    const prefixItem: QuickPanelListItem = {
      label: 'compact-notes',
      description: 'Takes notes',
      filterText: 'compact-notes Takes notes',
      icon: 'icon'
    }
    const commandItem: QuickPanelListItem = {
      label: '/compact',
      description: 'Free up context',
      filterText: '/compact Free up context',
      icon: 'icon'
    }
    const exactItem: QuickPanelListItem = {
      label: 'compact',
      description: 'Skill named compact',
      filterText: 'compact Skill named compact',
      icon: 'icon'
    }
    const pinyinItem: QuickPanelListItem = {
      label: '压缩上下文',
      icon: 'icon'
    }

    const sorted = defaultSortFn(
      [pinyinItem, descriptionItem, aliasSubstringItem, labelSubstringItem, prefixItem, commandItem, exactItem],
      'compact'
    )

    expect(sorted.map((item) => item.label)).toEqual([
      'compact',
      '/compact',
      'compact-notes',
      'my-compact-tool',
      'Cleanup',
      'session-cleanup',
      '压缩上下文'
    ])
  })

  it('does not treat slash-delimited file paths as slash command names', () => {
    const pathItem: QuickPanelListItem = { label: '/compact/notes.md', icon: 'file' }
    const commandItem: QuickPanelListItem = { label: '/compact', icon: 'terminal' }

    expect(calculateMatchScore(commandItem, 'compact')).toBeGreaterThan(calculateMatchScore(pathItem, 'compact'))
    expect(calculateMatchScore(commandItem, 'comp')).toBeGreaterThan(calculateMatchScore(pathItem, 'comp'))
  })

  it('keeps original order for empty queries and equal scores', () => {
    const items: QuickPanelListItem[] = [
      { label: 'first-helper', description: 'Run compact', icon: 'icon' },
      { label: 'second-helper', description: 'Run compact', icon: 'icon' }
    ]

    expect(defaultSortFn(items, '')).toBe(items)
    expect(defaultSortFn(items, 'compact').map((item) => item.label)).toEqual(['first-helper', 'second-helper'])
  })
})
