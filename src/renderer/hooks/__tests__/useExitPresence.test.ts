import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DIALOG_UNMOUNT_DELAY_MS } from '@cherrystudio/ui/utils'

import { useExitPresence } from '../useExitPresence'

afterEach(() => vi.useRealTimers())

describe('useExitPresence', () => {
  it('retains the latest open data throughout the close animation', async () => {
    vi.useFakeTimers()
    const initialProps: { value: string | null } = { value: 'First' }
    const { result, rerender } = renderHook(({ value }: { value: string | null }) => useExitPresence(value), {
      initialProps
    })

    rerender({ value: 'Latest' })
    rerender({ value: null })
    expect(result.current).toEqual({ value: 'Latest', isPresent: true })

    await act(() => vi.advanceTimersByTime(DIALOG_UNMOUNT_DELAY_MS - 1))
    expect(result.current).toEqual({ value: 'Latest', isPresent: true })

    await act(() => vi.advanceTimersByTime(1))
    expect(result.current).toEqual({ value: null, isPresent: false })
  })

  it('cancels an old close when a new target opens and starts a fresh exit', async () => {
    vi.useFakeTimers()
    const initialProps: { value: string | null } = { value: 'First' }
    const { result, rerender } = renderHook(({ value }: { value: string | null }) => useExitPresence(value, 120), {
      initialProps
    })

    rerender({ value: null })
    await act(() => vi.advanceTimersByTime(60))
    rerender({ value: 'Second' })
    await act(() => vi.advanceTimersByTime(120))
    expect(result.current).toEqual({ value: 'Second', isPresent: true })

    rerender({ value: null })
    await act(() => vi.advanceTimersByTime(119))
    expect(result.current).toEqual({ value: 'Second', isPresent: true })
    await act(() => vi.advanceTimersByTime(1))
    expect(result.current).toEqual({ value: null, isPresent: false })
  })

  it('accepts fresh object values without a render loop and retains the last committed value', () => {
    vi.useFakeTimers()
    const { result, rerender } = renderHook(({ open, title }) => useExitPresence(open ? { title } : null), {
      initialProps: { open: false, title: 'First' }
    })
    expect(result.current).toEqual({ value: null, isPresent: false })

    rerender({ open: true, title: 'Latest' })
    rerender({ open: false, title: '' })
    expect(result.current).toEqual({ value: { title: 'Latest' }, isPresent: true })
  })
})
