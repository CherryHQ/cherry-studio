import { renderHook } from '@testing-library/react'
import { expect, it } from 'vitest'

import { useStructurallySharedItems } from '../useStructurallySharedItems'

it('preserves unchanged item identities across reorder and replacement', () => {
  let items = [
    { id: 'a', value: 1 },
    { id: 'b', value: 2 }
  ]
  const { result, rerender } = renderHook(() => useStructurallySharedItems(items))
  const firstItems = result.current

  items = [{ ...items[1] }, { ...items[0] }]
  rerender()

  expect(result.current).not.toBe(firstItems)
  expect(result.current[0]).toBe(firstItems[1])
  expect(result.current[1]).toBe(firstItems[0])

  const reorderedItems = result.current
  items = [{ ...items[0], value: 3 }, { ...items[1] }]
  rerender()

  expect(result.current[0]).not.toBe(reorderedItems[0])
  expect(result.current[1]).toBe(reorderedItems[1])
})
