import { describe, expect, it } from 'vitest'

import type { SelectionActionItem } from '@shared/data/preference/preferenceTypes'

import { ACTIONS_DIVIDER, type ActionRow, actionItemsFromRows } from '../useSettingsActionsList'

const action = (id: string, enabled: boolean): SelectionActionItem => ({ id, name: id, enabled, isBuiltIn: true })

const rowsOf = (enabled: string[], disabled: string[]): ActionRow[] => [
  ...enabled.map((id) => action(id, true)),
  ACTIONS_DIVIDER,
  ...disabled.map((id) => action(id, false))
]

const move = (rows: ActionRow[], from: number, to: number): ActionRow[] => {
  const next = [...rows]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

const summarize = (items: SelectionActionItem[]) => ({
  enabled: items.filter((item) => item.enabled).map((item) => item.id),
  disabled: items.filter((item) => !item.enabled).map((item) => item.id)
})

describe('actionItemsFromRows', () => {
  it('disables an enabled action dragged below the divider', () => {
    const rows = move(rowsOf(['a', 'b'], ['c']), 0, 3)

    expect(summarize(actionItemsFromRows(rows))).toEqual({ enabled: ['b'], disabled: ['c', 'a'] })
  })

  it('enables a disabled action dropped onto the divider from below', () => {
    const rows = move(rowsOf(['a'], ['b', 'c']), 2, 1)

    expect(summarize(actionItemsFromRows(rows))).toEqual({ enabled: ['a', 'b'], disabled: ['c'] })
  })

  it('disables an enabled action dropped onto the divider from above', () => {
    const rows = move(rowsOf(['a', 'b'], ['c']), 0, 2)

    expect(summarize(actionItemsFromRows(rows))).toEqual({ enabled: ['b'], disabled: ['a', 'c'] })
  })

  it('keeps at most 8 enabled actions and moves the overflow to the end of the disabled list', () => {
    const enabled = ['e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7', 'e8']
    const rows = move(rowsOf(enabled, ['d1', 'd2']), 9, 0)

    expect(summarize(actionItemsFromRows(rows))).toEqual({
      enabled: ['d1', 'e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7'],
      disabled: ['d2', 'e8']
    })
  })
})
