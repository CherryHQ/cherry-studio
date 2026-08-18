import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useResourceListPinnedItems } from '../useResourceListPinnedItems'

type Item = { id: string; name: string; pinned: boolean }

const alpha: Item = { id: 'alpha', name: 'Alpha', pinned: false }

describe('useResourceListPinnedItems', () => {
  it('keeps a newly pinned row stable until the authoritative streams catch up', async () => {
    let resolveToggle: () => void = () => {}
    const onTogglePin = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveToggle = resolve
        })
    )
    const pinned: Item = { id: 'pinned', name: 'Pinned', pinned: true }
    const { rerender, result } = renderHook(({ items }) => useResourceListPinnedItems({ items, onTogglePin }), {
      initialProps: { items: [alpha, pinned] as Item[] }
    })

    let promise = Promise.resolve()
    await act(async () => {
      promise = result.current.togglePinned(alpha)
    })
    expect(result.current.items).toEqual([alpha, pinned])

    await act(async () => result.current.togglePinned(alpha))
    expect(onTogglePin).toHaveBeenCalledTimes(1)

    rerender({ items: [pinned] })
    expect(result.current.items).toEqual([alpha, pinned])

    await act(async () => {
      resolveToggle()
      await promise
    })
    expect(result.current.items).toEqual([alpha, pinned])

    rerender({ items: [pinned, { ...alpha, pinned: true }] })
    expect(result.current.items).toEqual([pinned, { ...alpha, pinned: true }])
  })

  it('keeps a newly unpinned row stable until the authoritative streams catch up', async () => {
    let resolveToggle: () => void = () => {}
    const onTogglePin = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveToggle = resolve
        })
    )
    const pinnedAlpha = { ...alpha, pinned: true }
    const { rerender, result } = renderHook(({ items }) => useResourceListPinnedItems({ items, onTogglePin }), {
      initialProps: { items: [pinnedAlpha] as Item[] }
    })

    let promise = Promise.resolve()
    await act(async () => {
      promise = result.current.togglePinned(pinnedAlpha)
    })
    expect(result.current.items).toEqual([pinnedAlpha])

    rerender({ items: [] })
    expect(result.current.items).toEqual([pinnedAlpha])

    await act(async () => {
      resolveToggle()
      await promise
    })
    expect(result.current.items).toEqual([pinnedAlpha])

    rerender({ items: [alpha] })
    expect(result.current.items).toEqual([alpha])
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
