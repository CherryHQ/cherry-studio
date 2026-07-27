import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useStableListItems } from '../useStableListItems'

type Item = {
  id: string
  metadata: {
    label: string
  }
}

function createItem(id: string, label = id): Item {
  return { id, metadata: { label } }
}

describe('useStableListItems', () => {
  it('reuses unchanged item references when a refreshed snapshot appends an item', () => {
    const initialItems = [createItem('a'), createItem('b')]
    const { result, rerender } = renderHook(({ items }) => useStableListItems(items), {
      initialProps: { items: initialItems }
    })
    const initialResult = result.current

    const appendedItem = createItem('c')
    rerender({
      items: [createItem('a'), createItem('b'), appendedItem]
    })

    expect(result.current).not.toBe(initialResult)
    expect(result.current[0]).toBe(initialResult[0])
    expect(result.current[1]).toBe(initialResult[1])
    expect(result.current[2]).toBe(appendedItem)
  })

  it('keeps the array stable for an equivalent refreshed snapshot and replaces only changed items', () => {
    const initialItems = [createItem('a'), createItem('b')]
    const { result, rerender } = renderHook(({ items }) => useStableListItems(items), {
      initialProps: { items: initialItems }
    })
    const initialResult = result.current

    rerender({ items: [createItem('a'), createItem('b')] })
    expect(result.current).toBe(initialResult)

    const changedItem = createItem('b', 'changed')
    rerender({ items: [createItem('a'), changedItem] })

    expect(result.current).not.toBe(initialResult)
    expect(result.current[0]).toBe(initialResult[0])
    expect(result.current[1]).toBe(changedItem)
  })
})
