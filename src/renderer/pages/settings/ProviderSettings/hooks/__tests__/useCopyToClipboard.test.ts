import { destroyAnnouncer } from '@react-aria/live-announcer'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { toast } from '@renderer/services/toast'

import { useCopyToClipboard } from '../useCopyToClipboard'

const politeRegion = () => document.querySelector('[aria-live="polite"]')

describe('useCopyToClipboard', () => {
  const writeText = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    destroyAnnouncer()
    writeText.mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  })

  it('reports success in place and to screen readers instead of a toast', async () => {
    const { result } = renderHook(() => useCopyToClipboard())

    await act(() => result.current[1]('sk-test'))

    expect(writeText).toHaveBeenCalledWith('sk-test')
    expect(result.current[0]).toBe(true)
    expect(politeRegion()?.textContent).toMatch(/^(已复制|Copied)$/)
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('stays uncopied and toasts the failure when the clipboard rejects', async () => {
    writeText.mockRejectedValueOnce(new Error('denied'))
    const { result } = renderHook(() => useCopyToClipboard())

    await act(() => result.current[1]('sk-test'))

    expect(result.current[0]).toBe(false)
    expect(politeRegion()).toBeNull()
    expect(toast.error).toHaveBeenCalledOnce()
  })
})
