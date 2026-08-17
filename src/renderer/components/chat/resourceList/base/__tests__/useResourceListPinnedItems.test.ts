import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useResourceListPinnedItems } from '../useResourceListPinnedItems'

type Item = { id: string; name: string; pinned: boolean }

const alpha: Item = { id: 'alpha', name: 'Alpha', pinned: false }

describe('useResourceListPinnedItems', () => {
  it('keeps a newly pinned row first until the authoritative streams catch up', async () => {
    let resolveToggle: () => void = () => {}
    const onTogglePin = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveToggle = resolve
        })
    )
    const pinned: Item = { id: 'pinned', name: 'Pinned', pinned: true }
    const { rerender, result } = renderHook(({ items }) => useResourceListPinnedItems({ items, onTogglePin }), {
      initialProps: { items: [pinned, alpha] as Item[] }
    })

    let promise = Promise.resolve()
    await act(async () => {
      promise = result.current.togglePinned(alpha)
    })
    expect(result.current.items).toEqual([{ ...alpha, pinned: true }, pinned])

    await act(async () => result.current.togglePinned(alpha))
    expect(onTogglePin).toHaveBeenCalledTimes(1)

    rerender({ items: [pinned] })
    expect(result.current.items).toEqual([{ ...alpha, pinned: true }, pinned])

    await act(async () => {
      resolveToggle()
      await promise
    })
    rerender({ items: [pinned, { ...alpha, pinned: true }] })
    expect(result.current.items).toEqual([pinned, { ...alpha, pinned: true }])
  })

  it('projects an unpin before the mutation resolves', async () => {
    let resolveToggle: () => void = () => {}
    const onTogglePin = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveToggle = resolve
        })
    )
    const pinnedAlpha = { ...alpha, pinned: true }
    const { result } = renderHook(() => useResourceListPinnedItems({ items: [pinnedAlpha], onTogglePin }))

    let promise = Promise.resolve()
    await act(async () => {
      promise = result.current.togglePinned(pinnedAlpha)
    })
    expect(result.current.items).toEqual([alpha])

    await act(async () => {
      resolveToggle()
      await promise
    })
  })

  it('removes the retained row and rolls pin state back when the mutation fails', async () => {
    const onTogglePin = vi.fn(async () => {
      throw new Error('pin failed')
    })
    const { result } = renderHook(() => useResourceListPinnedItems({ items: [alpha], onTogglePin }))

    await act(async () => {
      await expect(result.current.togglePinned(alpha)).rejects.toThrow('pin failed')
    })

    expect(result.current.items).toEqual([alpha])
  })

  it('does not toggle while disabled', async () => {
    const onTogglePin = vi.fn()
    const { result } = renderHook(() => useResourceListPinnedItems({ disabled: true, items: [alpha], onTogglePin }))

    await act(async () => result.current.togglePinned(alpha))

    expect(result.current.items).toEqual([alpha])
    expect(onTogglePin).not.toHaveBeenCalled()
  })
})
