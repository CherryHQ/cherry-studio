import { describe, expect, it } from 'vitest'

import { defaultFilterFn } from '../defaultStrategies'
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
