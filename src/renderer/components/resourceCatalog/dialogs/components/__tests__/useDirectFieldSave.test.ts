import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useDirectFieldSave } from '../useDirectFieldSave'

type Patch = { name?: string; description?: string }

const merge = (base: Patch, next: Patch): Patch => ({ ...base, ...next })

function setup(save: (patch: Patch) => Promise<unknown>, onError = vi.fn()) {
  return renderHook(() => useDirectFieldSave<Patch>({ save, merge, onError, delay: 10 }))
}

/** Resolves once every already-queued microtask has run. */
const settle = () =>
  act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })

describe('useDirectFieldSave', () => {
  it('sends a committed field intent immediately', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const { result } = setup(save)

    act(() => result.current.commit('name', { name: 'a' }))
    await settle()

    expect(save).toHaveBeenCalledExactlyOnceWith({ name: 'a' })
    expect(result.current.status).toBe('idle')
  })

  it('collapses rapid scheduled changes to the same field', async () => {
    vi.useFakeTimers()
    try {
      const save = vi.fn().mockResolvedValue(undefined)
      const { result } = setup(save)

      act(() => result.current.schedule('name', { name: 'a' }))
      act(() => result.current.schedule('name', { name: 'ab' }))
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

  it('serializes writes without merging unrelated field intents', async () => {
    let releaseFirst: (() => void) | undefined
    const save = vi
      .fn()
      .mockImplementationOnce(() => new Promise<void>((resolve) => (releaseFirst = resolve)))
      .mockResolvedValue(undefined)
    const { result } = setup(save)

    act(() => result.current.commit('name', { name: 'a' }))
    await settle()
    expect(save).toHaveBeenCalledTimes(1)

    act(() => result.current.commit('name', { name: 'b' }))
    act(() => result.current.commit('description', { description: 'd' }))
    expect(save).toHaveBeenCalledTimes(1)

    await act(async () => {
      releaseFirst?.()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(save).toHaveBeenCalledTimes(3)
    expect(save).toHaveBeenNthCalledWith(2, { name: 'b' })
    expect(save).toHaveBeenNthCalledWith(3, { description: 'd' })
  })

  it('leaves a field scheduled behind an in-flight save on its debounce', async () => {
    vi.useFakeTimers()
    try {
      let releaseFirst: (() => void) | undefined
      const save = vi
        .fn()
        .mockImplementationOnce(() => new Promise<void>((resolve) => (releaseFirst = resolve)))
        .mockResolvedValue(undefined)
      const { result } = setup(save)

      act(() => result.current.commit('name', { name: 'a' }))
      await settle()
      expect(save).toHaveBeenCalledTimes(1)

      act(() => result.current.schedule('description', { description: 'typin' }))
      await act(async () => {
        releaseFirst?.()
        await Promise.resolve()
      })
      await settle()

      // The queue must not swallow the debounced field while the first request
      // settles, otherwise every keystroke typed during a save gets sent.
      expect(save).toHaveBeenCalledTimes(1)
      expect(result.current.status).toBe('pending')

      act(() => result.current.schedule('description', { description: 'typing' }))
      await act(async () => {
        vi.advanceTimersByTime(10)
        await Promise.resolve()
      })

      expect(save).toHaveBeenCalledTimes(2)
      expect(save).toHaveBeenLastCalledWith({ description: 'typing' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps a rejected field intent for inline retry', async () => {
    const onError = vi.fn()
    const save = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined)
    const { result } = setup(save, onError)

    act(() => result.current.commit('name', { name: 'a' }))
    await settle()

    expect(result.current.status).toBe('failed')
    expect(onError).toHaveBeenCalledExactlyOnceWith(expect.any(Error))

    act(() => result.current.retry())
    await settle()

    expect(save).toHaveBeenCalledTimes(2)
    expect(save).toHaveBeenLastCalledWith({ name: 'a' })
    expect(result.current.status).toBe('idle')
  })

  it('lets a newer value replace the rejected value for the same field', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined)
    const { result } = setup(save)

    act(() => result.current.commit('name', { name: 'stale' }))
    await settle()
    expect(result.current.status).toBe('failed')

    act(() => result.current.commit('name', { name: 'fresh' }))
    await settle()

    expect(save).toHaveBeenLastCalledWith({ name: 'fresh' })
    expect(result.current.status).toBe('idle')
  })

  it('does not resurrect an in-flight value rejected after a newer value was queued', async () => {
    let rejectFirst: ((error: Error) => void) | undefined
    const onError = vi.fn()
    const save = vi
      .fn()
      .mockImplementationOnce(() => new Promise<void>((_resolve, reject) => (rejectFirst = reject)))
      .mockResolvedValue(undefined)
    const { result } = setup(save, onError)

    act(() => result.current.commit('name', { name: 'stale' }))
    await settle()
    act(() => result.current.commit('name', { name: 'fresh' }))

    await act(async () => {
      rejectFirst?.(new Error('offline'))
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(save).toHaveBeenCalledTimes(2)
    expect(save).toHaveBeenLastCalledWith({ name: 'fresh' })
    expect(onError).not.toHaveBeenCalled()
    expect(result.current.status).toBe('idle')
  })

  it('continues saving unrelated fields after one field fails', async () => {
    let rejectFirst: ((error: Error) => void) | undefined
    const save = vi
      .fn()
      .mockImplementationOnce(() => new Promise<void>((_resolve, reject) => (rejectFirst = reject)))
      .mockResolvedValue(undefined)
    const { result } = setup(save)

    act(() => result.current.commit('name', { name: 'bad' }))
    await settle()
    act(() => result.current.commit('description', { description: 'good' }))

    await act(async () => {
      rejectFirst?.(new Error('invalid name'))
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(save).toHaveBeenCalledTimes(2)
    expect(save).toHaveBeenNthCalledWith(2, { description: 'good' })
    expect(result.current.status).toBe('failed')

    act(() => result.current.retry())
    await settle()
    expect(save).toHaveBeenNthCalledWith(3, { name: 'bad' })
  })

  it('flushes a scheduled field without waiting for the debounce', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const { result } = setup(save)

    act(() => result.current.schedule('name', { name: 'a' }))
    await act(async () => await result.current.flush())

    expect(save).toHaveBeenCalledExactlyOnceWith({ name: 'a' })
  })

  it('discards one buffered field without dropping unrelated fields', async () => {
    vi.useFakeTimers()
    try {
      const save = vi.fn().mockResolvedValue(undefined)
      const { result } = setup(save)

      act(() => result.current.schedule('name', { name: 'temporary' }))
      act(() => result.current.schedule('description', { description: 'keep' }))
      act(() => result.current.discard('name'))

      await act(async () => {
        vi.advanceTimersByTime(10)
        await Promise.resolve()
      })

      expect(save).toHaveBeenCalledExactlyOnceWith({ description: 'keep' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('cancels the timer when the only buffered field is discarded', async () => {
    vi.useFakeTimers()
    try {
      const save = vi.fn().mockResolvedValue(undefined)
      const { result } = setup(save)

      act(() => result.current.schedule('name', { name: 'temporary' }))
      act(() => result.current.discard('name'))
      await act(async () => vi.advanceTimersByTime(10))

      expect(save).not.toHaveBeenCalled()
      expect(result.current.status).toBe('idle')
    } finally {
      vi.useRealTimers()
    }
  })

  it('best-effort flushes a scheduled field when the editor unmounts', async () => {
    vi.useFakeTimers()
    try {
      const save = vi.fn().mockResolvedValue(undefined)
      const { result, unmount } = setup(save)

      act(() => result.current.schedule('name', { name: 'last edit' }))
      unmount()
      await settle()

      expect(save).toHaveBeenCalledExactlyOnceWith({ name: 'last edit' })
    } finally {
      vi.useRealTimers()
    }
  })
})
