import { describe, expect, it } from 'vitest'

import type { SelectionActionItem } from '@shared/data/preference/preferenceTypes'

import { parseSelectionActions } from '../selectionAction'

describe('parseSelectionActions', () => {
  it('keeps valid actions when one stored item is broken', () => {
    const items: SelectionActionItem[] = [
      { id: 'copy', name: 'selection.action.builtin.copy', enabled: true, isBuiltIn: true },
      { id: 'user-1', name: 'No runner', enabled: true, isBuiltIn: false },
      { id: 'user-2', name: 'Polish', enabled: true, isBuiltIn: false, runner: 'default', prompt: 'Polish {{text}}' }
    ]

    expect(parseSelectionActions(items).map((item) => item.id)).toEqual(['copy', 'user-2'])
  })

  it('drops fields a built-in action does not own', () => {
    const [search] = parseSelectionActions([
      { id: 'search', name: 'Search', enabled: true, isBuiltIn: true, searchEngine: 'G|u', assistantId: 'a-1' }
    ])

    expect(search).toEqual({ id: 'search', name: 'Search', enabled: true, isBuiltIn: true, searchEngine: 'G|u' })
  })
})
