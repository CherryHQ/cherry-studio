import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useResourceListPinnedState } from '../useResourceListPinnedState'

describe('useResourceListPinnedState', () => {
  it('maps source pinned ids to current pin state', () => {
    const { result } = renderHook(() =>
      useResourceListPinnedState({
        pinnedIds: ['alpha'],
        onTogglePin: vi.fn()
      })
    )

    expect(result.current.pinnedIds).toEqual(['alpha'])
    expect(result.current.isPinned('alpha')).toBe(true)
    expect(result.current.isPinned('beta')).toBe(false)
  })

  it('pins an unpinned id optimistically before the toggle resolves', async () => {
    let resolveToggle: () => void = () => {}
    const onTogglePin = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveToggle = resolve
        })
    )

    const { result } = renderHook(() =>
      useResourceListPinnedState({
        pinnedIds: [],
        onTogglePin
      })
    )

    let promise = Promise.resolve()
    await act(async () => {
      promise = result.current.togglePinned('alpha')
    })

    expect(result.current.pinnedIds).toEqual(['alpha'])
    expect(result.current.isPinned('alpha')).toBe(true)
    expect(result.current.togglingIds.has('alpha')).toBe(true)

    await act(async () => {
      resolveToggle()
      await promise
    })

    expect(onTogglePin).toHaveBeenCalledWith('alpha')
    expect(result.current.togglingIds.has('alpha')).toBe(false)
  })

  it('unpins a pinned id optimistically before the toggle resolves', async () => {
    let resolveToggle: () => void = () => {}
    const onTogglePin = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveToggle = resolve
        })
    )

    const { result } = renderHook(() =>
      useResourceListPinnedState({
        pinnedIds: ['alpha', 'beta'],
        onTogglePin
      })
    )

    let promise = Promise.resolve()
    await act(async () => {
      promise = result.current.togglePinned('alpha')
    })

    expect(result.current.pinnedIds).toEqual(['beta'])
    expect(result.current.isPinned('alpha')).toBe(false)

    await act(async () => {
      resolveToggle()
      await promise
    })

    expect(onTogglePin).toHaveBeenCalledWith('alpha')
  })

  it('rolls back optimistic state when the toggle rejects', async () => {
    const onTogglePin = vi.fn(async () => {
      throw new Error('toggle failed')
    })

    const { result } = renderHook(() =>
      useResourceListPinnedState({
        pinnedIds: ['alpha'],
        onTogglePin
      })
    )

    await act(async () => {
      await expect(result.current.togglePinned('alpha')).rejects.toThrow('toggle failed')
    })

    expect(result.current.pinnedIds).toEqual(['alpha'])
    expect(result.current.isPinned('alpha')).toBe(true)
    expect(result.current.togglingIds.has('alpha')).toBe(false)
  })

  it('does not toggle when disabled', async () => {
    const onTogglePin = vi.fn()

    const { result } = renderHook(() =>
      useResourceListPinnedState({
        disabled: true,
        pinnedIds: [],
        onTogglePin
      })
    )

    await act(async () => {
      await result.current.togglePinned('alpha')
    })

    expect(result.current.pinnedIds).toEqual([])
    expect(result.current.isPinned('alpha')).toBe(false)
    expect(onTogglePin).not.toHaveBeenCalled()
  })

  it('ignores repeated toggles for an id while its toggle is in flight', async () => {
    let resolveToggle: () => void = () => {}
    const onTogglePin = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveToggle = resolve
        })
    )

    const { result } = renderHook(() =>
      useResourceListPinnedState({
        pinnedIds: [],
        onTogglePin
      })
    )

    let promise = Promise.resolve()
    await act(async () => {
      promise = result.current.togglePinned('alpha')
    })

    await act(async () => {
      await result.current.togglePinned('alpha')
    })

    expect(result.current.isPinned('alpha')).toBe(true)
    expect(onTogglePin).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveToggle()
      await promise
    })
  })

  it('clears matching optimistic overrides when source pinned ids catch up', async () => {
    let resolveToggle: () => void = () => {}
    const onTogglePin = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveToggle = resolve
        })
    )

    const { rerender, result } = renderHook(
      ({ pinnedIds }) =>
        useResourceListPinnedState({
          pinnedIds,
          onTogglePin
        }),
      { initialProps: { pinnedIds: [] as string[] } }
    )

    let promise = Promise.resolve()
    await act(async () => {
      promise = result.current.togglePinned('alpha')
    })

    expect(result.current.pinnedIds).toEqual(['alpha'])

    await act(async () => {
      rerender({ pinnedIds: ['alpha'] })
    })

    expect(result.current.pinnedIds).toEqual(['alpha'])

    await act(async () => {
      resolveToggle()
      await promise
    })
  })
})
