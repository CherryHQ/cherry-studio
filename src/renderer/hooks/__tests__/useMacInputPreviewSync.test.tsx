import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useMacInputPreviewSync } from '../useMacInputPreviewSync'

vi.mock('@renderer/utils/platform', () => ({ isMac: true }))

describe('useMacInputPreviewSync', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('re-syncs anchor geometry on window resize', () => {
    const el = document.createElement('div')
    el.getBoundingClientRect = vi.fn(() => ({ top: 10, left: 10, bottom: 20, right: 20 }) as DOMRect)
    document.body.appendChild(el)
    const ref = { current: el }

    renderHook(() => useMacInputPreviewSync(ref, true))
    vi.runAllTimers()

    expect(el.getBoundingClientRect).toHaveBeenCalled()

    const callsBefore = (el.getBoundingClientRect as unknown as { mock: { calls: unknown[] } }).mock.calls.length
    window.dispatchEvent(new Event('resize'))
    expect((el.getBoundingClientRect as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBeGreaterThan(
      callsBefore
    )

    document.body.removeChild(el)
  })

  it('does not sync when disabled', () => {
    const el = document.createElement('div')
    el.getBoundingClientRect = vi.fn(() => ({ top: 0 }) as DOMRect)
    const ref = { current: el }

    renderHook(() => useMacInputPreviewSync(ref, false))
    vi.runAllTimers()

    expect(el.getBoundingClientRect).not.toHaveBeenCalled()
  })

  it('syncs on next frame after mount (launch geometry)', () => {
    const el = document.createElement('div')
    el.getBoundingClientRect = vi.fn(() => ({ top: 5 }) as DOMRect)
    const ref = { current: el }

    const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
      cb(0)
      return 1
    })

    renderHook(() => useMacInputPreviewSync(ref, true))
    expect(el.getBoundingClientRect).toHaveBeenCalled()

    rafSpy.mockRestore()
  })
})
