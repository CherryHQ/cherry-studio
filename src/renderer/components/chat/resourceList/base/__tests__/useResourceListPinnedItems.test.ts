import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useResourceListPinnedItems } from '../useResourceListPinnedItems'

type Item = { id: string; name: string; pinId?: string | null; pinned: boolean }

const alpha: Item = { id: 'alpha', name: 'Alpha', pinned: false }

describe('useResourceListPinnedItems', () => {
  it('optimistically appends a new pin in authoritative order until the streams catch up', async () => {
    let resolveToggle: (item: Item) => void = () => {}
    const onTogglePin = vi.fn(
      () =>
        new Promise<Item>((resolve) => {
          resolveToggle = resolve
        })
    )
    const pinned: Item = { id: 'pinned', name: 'Pinned', pinned: true }
    const pinnedAlpha: Item = { ...alpha, pinId: 'pin-alpha', pinned: true }
    const { rerender, result } = renderHook(({ items }) => useResourceListPinnedItems({ items, onTogglePin }), {
      initialProps: { items: [alpha, pinned] as Item[] }
    })

    let promise = Promise.resolve()
    await act(async () => {
      promise = result.current.togglePinned(alpha)
    })
    expect(result.current.items).toEqual([pinned, { ...alpha, pinned: true }])
    expect(result.current.pendingPinnedById.get(alpha.id)).toBe(true)

    rerender({ items: [pinned] })
    expect(result.current.items).toEqual([pinned, { ...alpha, pinned: true }])

    await act(async () => {
      resolveToggle(pinnedAlpha)
      await promise
    })
    expect(result.current.items).toEqual([pinned, pinnedAlpha])

    rerender({ items: [pinned, pinnedAlpha] })
    expect(result.current.items).toEqual([pinned, pinnedAlpha])
    expect(result.current.pendingPinnedById.has(alpha.id)).toBe(false)
  })

  it('coalesces a pending pin reversal and unpins with the created pin id', async () => {
    let resolvePin: (item: Item) => void = () => {}
    const pinnedAlpha: Item = { ...alpha, pinId: 'pin-alpha', pinned: true }
    const onTogglePin = vi.fn((item: Item) => {
      if (!item.pinned) {
        return new Promise<Item>((resolve) => {
          resolvePin = resolve
        })
      }
      return Promise.resolve({ ...item, pinId: null, pinned: false })
    })
    const { result } = renderHook(() => useResourceListPinnedItems({ items: [alpha], onTogglePin }))

    let promise = Promise.resolve()
    await act(async () => {
      promise = result.current.togglePinned(alpha)
    })
    expect(result.current.items).toEqual([{ ...alpha, pinned: true }])

    await act(async () => result.current.togglePinned(result.current.items[0]))
    expect(result.current.items).toEqual([alpha])
    expect(result.current.pendingPinnedById.get(alpha.id)).toBe(false)
    expect(onTogglePin).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolvePin(pinnedAlpha)
      await promise
    })
    expect(onTogglePin).toHaveBeenNthCalledWith(2, pinnedAlpha)
    expect(result.current.items).toEqual([alpha])
    expect(result.current.pendingPinnedById.has(alpha.id)).toBe(false)
  })

  it('restarts persistence when reversing a pin that is waiting for its source stream', async () => {
    const pinnedAlpha: Item = { ...alpha, pinId: 'pin-alpha', pinned: true }
    const onTogglePin = vi.fn(async (item: Item) =>
      item.pinned ? { ...item, pinId: null, pinned: false } : pinnedAlpha
    )
    const { result } = renderHook(() => useResourceListPinnedItems({ items: [alpha], onTogglePin }))

    await act(async () => result.current.togglePinned(alpha))
    expect(result.current.pendingPinnedById.get(alpha.id)).toBe(true)

    await act(async () => result.current.togglePinned(result.current.items[0]))
    expect(onTogglePin).toHaveBeenNthCalledWith(2, pinnedAlpha)
    expect(result.current.items).toEqual([alpha])
    expect(result.current.pendingPinnedById.has(alpha.id)).toBe(false)
  })

  it('projects an unpin while retaining the row until the streams catch up', async () => {
    let resolveToggle: (item: Item) => void = () => {}
    const onTogglePin = vi.fn(
      () =>
        new Promise<Item>((resolve) => {
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
    expect(result.current.items).toEqual([alpha])
    expect(result.current.pendingPinnedById.get(alpha.id)).toBe(false)

    rerender({ items: [] })
    expect(result.current.items).toEqual([alpha])

    await act(async () => {
      resolveToggle(alpha)
      await promise
    })
    expect(result.current.items).toEqual([alpha])

    rerender({ items: [alpha] })
    expect(result.current.items).toEqual([alpha])
    expect(result.current.pendingPinnedById.has(alpha.id)).toBe(false)
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
    const onTogglePin = vi.fn(async (item: Item) => item)
    const { result } = renderHook(() => useResourceListPinnedItems({ disabled: true, items: [alpha], onTogglePin }))

    await act(async () => result.current.togglePinned(alpha))

    expect(result.current.items).toEqual([alpha])
    expect(onTogglePin).not.toHaveBeenCalled()
  })
})
