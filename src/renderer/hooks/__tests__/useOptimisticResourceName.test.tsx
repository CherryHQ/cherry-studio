import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useOptimisticResourceName } from '../useOptimisticResourceName'

interface Resource {
  id: string
  name: string
  updatedAt: string
}

const sourceItem: Resource = {
  id: 'resource-1',
  name: 'Original name',
  updatedAt: '2026-08-20T00:00:00.000Z'
}

describe('useOptimisticResourceName', () => {
  it('discards a settled overlay after its source item disappears', async () => {
    const { result, rerender } = renderHook(
      ({ sourceItems }: { sourceItems: readonly Resource[] }) => useOptimisticResourceName(sourceItems),
      { initialProps: { sourceItems: [sourceItem] } }
    )

    let renameRequest!: Promise<boolean>
    act(() => {
      renameRequest = result.current.rename(sourceItem, 'Renamed resource', async () => true)
    })
    await act(async () => {
      await renameRequest
    })
    expect(result.current.items[0]?.name).toBe('Renamed resource')

    rerender({ sourceItems: [] })
    expect(result.current.items).toEqual([])

    rerender({ sourceItems: [sourceItem] })
    expect(result.current.items[0]?.name).toBe('Original name')
  })
})
