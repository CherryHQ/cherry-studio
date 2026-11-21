import { iconNames } from 'lucide-react/dynamic'
import { describe, expect, it } from 'vitest'

import { searchSelectionIcons } from '../selectionIconSearch'

// Use the installed Lucide catalog and vendored official tags, not the component's tiny bundle stub.
describe('selection icon search catalog', () => {
  it.each([
    ['translate', 'languages'],
    ['翻译', 'languages'],
    ['互译', 'languages'],
    ['heartbeat', 'heart-pulse'],
    ['心跳', 'heart-pulse'],
    ['血压', 'heart-pulse'],
    ['HEART-PULSE', 'heart-pulse'],
    ['clipboard-copy', 'clipboard-copy']
  ])('finds %s in the supported catalog', (query, name) => {
    expect(searchSelectionIcons(query)).toContain(name)
  })

  it('returns the complete supported catalog for blank input', () => {
    expect(searchSelectionIcons('  ')).toEqual(iconNames)
  })

  it('never offers a name outside the supported catalog', () => {
    for (const query of ['translate', '翻译', '心跳', 'file', 'cloud']) {
      expect(searchSelectionIcons(query).every((name) => iconNames.includes(name))).toBe(true)
    }
    expect(searchSelectionIcons('unsupported-icon-that-does-not-exist')).toEqual([])
  })
})
