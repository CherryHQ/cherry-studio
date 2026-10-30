import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { SelectionActionItem } from '@shared/data/preference/preferenceTypes'

import { ACTIONS_DIVIDER, type ActionRow, actionItemsFromRows, useActionItems } from '../useSettingsActionsList'

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

describe('useActionItems handleReorderRows', () => {
  const dropFirstBelowDivider = (items: SelectionActionItem[]) => {
    const setActionItems = vi.fn<(items: SelectionActionItem[]) => void>()
    const { result } = renderHook(() => useActionItems(items, setActionItems))
    const rows = result.current.actionRows
    result.current.handleReorderRows(move(rows, 0, rows.length - 1))
    return setActionItems
  }

  it('saves an enabled action moved below the divider while another stays enabled', () => {
    const setActionItems = dropFirstBelowDivider([action('a', true), action('b', true), action('c', false)])

    expect(setActionItems).toHaveBeenCalledOnce()
    expect(summarize(setActionItems.mock.calls[0][0])).toEqual({ enabled: ['b'], disabled: ['c', 'a'] })
  })

  it('saves a reorder among disabled actions when nothing is enabled', () => {
    const setActionItems = vi.fn()
    const items = [action('a', false), action('b', false)]
    const { result } = renderHook(() => useActionItems(items, setActionItems))

    result.current.handleReorderRows(rowsOf([], ['b', 'a']))

    expect(setActionItems).toHaveBeenCalledExactlyOnceWith([action('b', false), action('a', false)])
  })

  it('drops the reorder when a rollback mid-drag left the dragged action as the only enabled one', () => {
    const setActionItems = dropFirstBelowDivider([action('a', true), action('b', false)])

    expect(setActionItems).not.toHaveBeenCalled()
  })
})
