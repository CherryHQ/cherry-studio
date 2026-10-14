import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

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
  it('keeps a settled overlay through an older snapshot and yields to a newer external name', async () => {
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

    rerender({
      sourceItems: [{ ...sourceItem, updatedAt: '2026-08-19T00:00:00.000Z' }]
    })

    expect(result.current.items[0]?.name).toBe('Renamed resource')

    rerender({
      sourceItems: [{ ...sourceItem, name: 'External name', updatedAt: '2026-08-21T00:00:00.000Z' }]
    })

    expect(result.current.items[0]?.name).toBe('External name')
  })

  it('serializes writes while keeping the latest submitted name visible', async () => {
    const { result, rerender } = renderHook(
      ({ sourceItems }: { sourceItems: readonly Resource[] }) => useOptimisticResourceName(sourceItems),
      { initialProps: { sourceItems: [sourceItem] } }
    )
    let resolveFirstRename!: (persisted: boolean) => void
    let resolveSecondRename!: (persisted: boolean) => void
    const persistFirstRename = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveFirstRename = resolve
        })
    )
    const persistSecondRename = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveSecondRename = resolve
        })
    )

    let firstRename!: Promise<boolean>
    act(() => {
      firstRename = result.current.rename(sourceItem, 'First rename', persistFirstRename)
    })
    let secondRename!: Promise<boolean>
    act(() => {
      secondRename = result.current.rename(result.current.items[0], 'Latest rename', persistSecondRename)
    })

    expect(result.current.items[0]?.name).toBe('Latest rename')
    await vi.waitFor(() => expect(persistFirstRename).toHaveBeenCalledOnce())
    expect(persistSecondRename).not.toHaveBeenCalled()

    rerender({
      sourceItems: [{ ...sourceItem, name: 'First rename', updatedAt: '2026-08-21T00:00:00.000Z' }]
    })
    await act(async () => {
      resolveFirstRename(true)
      await firstRename
    })
    await vi.waitFor(() => expect(persistSecondRename).toHaveBeenCalledOnce())

    expect(result.current.items[0]?.name).toBe('Latest rename')

    await act(async () => {
      resolveSecondRename(true)
      await secondRename
    })
    expect(result.current.items[0]?.name).toBe('Latest rename')
  })

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

  it('keeps the latest rename after an older failure while other resources persist independently', async () => {
    const otherItem = { ...sourceItem, id: 'resource-2' }
    const sourceItems = [sourceItem, otherItem]
    const { result } = renderHook(() => useOptimisticResourceName(sourceItems))
    const firstWrite = Promise.withResolvers<boolean>()
    const nextWrite = Promise.withResolvers<boolean>()
    const nextStarted = Promise.withResolvers<void>()
    const failure = new Error('Rename failed')
    let firstRename!: Promise<boolean>
    let latestRename!: Promise<boolean>
    let otherRename!: Promise<boolean>

    act(() => {
      firstRename = result.current.rename(sourceItem, 'Rejected name', () => firstWrite.promise)
      latestRename = result.current.rename(sourceItem, 'Latest name', () => {
        nextStarted.resolve()
        return nextWrite.promise
      })
      otherRename = result.current.rename(otherItem, 'Other name', async () => true)
    })
    const rejected = expect(firstRename).rejects.toBe(failure)

    await act(async () => {
      await otherRename
    })
    expect(result.current.items.map((item) => item.name)).toEqual(['Latest name', 'Other name'])

    await act(async () => {
      firstWrite.reject(failure)
      await Promise.all([rejected, nextStarted.promise])
    })
    expect(result.current.items.map((item) => item.name)).toEqual(['Latest name', 'Other name'])

    await act(async () => {
      nextWrite.resolve(true)
      await latestRename
    })
    expect(result.current.items.map((item) => item.name)).toEqual(['Latest name', 'Other name'])
  })
})
