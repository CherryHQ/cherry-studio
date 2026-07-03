import { describe, expect, it } from 'vitest'

import { defaultFilterFn } from '../defaultStrategies'
import type { QuickPanelListItem } from '../types'

const fuzzyRegex = /unused/i

function matches(item: QuickPanelListItem, searchText: string) {
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
})
