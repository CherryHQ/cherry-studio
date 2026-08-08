import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useDirectFieldSave } from '../useDirectFieldSave'

type Patch = { name?: string; description?: string }

const merge = (base: Patch, next: Patch): Patch => ({ ...base, ...next })

function setup(save: (patch: Patch) => Promise<unknown>, onError = vi.fn()) {
  return renderHook(() => useDirectFieldSave<Patch>({ save, merge, onError, delay: 10 }))
}

/** Resolves once every already-queued microtask has run. */
const settle = () => act(async () => await Promise.resolve())

describe('useDirectFieldSave', () => {
  it('sends a committed patch immediately', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const { result } = setup(save)

    act(() => result.current.commit({ name: 'a' }))
    await settle()

    expect(save).toHaveBeenCalledExactlyOnceWith({ name: 'a' })
    expect(result.current.status).toBe('idle')
  })

  it('collapses rapid scheduled patches into one request', async () => {
    vi.useFakeTimers()
    try {
      const save = vi.fn().mockResolvedValue(undefined)
      const { result } = setup(save)

      act(() => result.current.schedule({ name: 'a' }))
      act(() => result.current.schedule({ name: 'ab' }))
      expect(save).not.toHaveBeenCalled()
      expect(result.current.status).toBe('pending')

      await act(async () => {
        vi.advanceTimersByTime(10)
        await Promise.resolve()
      })
      expect(save).toHaveBeenCalledExactlyOnceWith({ name: 'ab' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('serializes writes and merges everything queued behind an in-flight one', async () => {
    let releaseFirst: (() => void) | undefined
    const save = vi
      .fn()
      .mockImplementationOnce(() => new Promise<void>((resolve) => (releaseFirst = resolve)))
      .mockResolvedValue(undefined)
    const { result } = setup(save)

    act(() => result.current.commit({ name: 'a' }))
    await settle()
    expect(save).toHaveBeenCalledTimes(1)

    act(() => result.current.commit({ name: 'b' }))
    act(() => result.current.commit({ description: 'd' }))
    expect(save).toHaveBeenCalledTimes(1)

    await act(async () => {
      releaseFirst?.()
      await Promise.resolve()
    })
    await settle()

    expect(save).toHaveBeenCalledTimes(2)
    expect(save).toHaveBeenLastCalledWith({ name: 'b', description: 'd' })
  })

  it('keeps a rejected patch buffered and resends it on retry', async () => {
    const onError = vi.fn()
    const save = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined)
    const { result } = setup(save, onError)

    act(() => result.current.commit({ name: 'a' }))
    await settle()

    expect(result.current.status).toBe('failed')
    expect(onError).toHaveBeenCalledExactlyOnceWith(expect.any(Error))

    act(() => result.current.retry())
    await settle()

    expect(save).toHaveBeenCalledTimes(2)
    expect(save).toHaveBeenLastCalledWith({ name: 'a' })
    expect(result.current.status).toBe('idle')
  })

  it('lets a newer value win over the rejected one', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined)
    const { result } = setup(save)

    act(() => result.current.commit({ name: 'stale' }))
    await settle()
    expect(result.current.status).toBe('failed')

    act(() => result.current.commit({ name: 'fresh' }))
    await settle()

    expect(save).toHaveBeenLastCalledWith({ name: 'fresh' })
  })

  it('flushes a scheduled patch without waiting for the debounce', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const { result } = setup(save)

    act(() => result.current.schedule({ name: 'a' }))
    await act(async () => await result.current.flush())

    expect(save).toHaveBeenCalledExactlyOnceWith({ name: 'a' })
  })

  it('does not resend a patch that a failure already reported after unmount', async () => {
    const save = vi.fn().mockRejectedValue(new Error('offline'))
    const { result, unmount } = setup(save)

    act(() => result.current.commit({ name: 'a' }))
    unmount()
    await settle()

    // One attempt, and no state update on the unmounted hook.
    expect(save).toHaveBeenCalledTimes(1)
  })
})
