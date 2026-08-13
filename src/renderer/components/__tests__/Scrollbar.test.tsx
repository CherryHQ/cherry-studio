import { fireEvent, render, screen } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import Scrollbar from '../Scrollbar'

vi.mock('es-toolkit/compat', async () => {
  const actual = await import('es-toolkit/compat')
  return {
    ...actual,
    throttle: vi.fn((fn) => {
      const throttled = (...args: unknown[]) => fn(...args)
      throttled.cancel = vi.fn()
      return throttled
    })
  }
})

describe('Scrollbar', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('scrolling behavior', () => {
    it('should keep the scrolling state active for 1500ms after the latest scroll', () => {
      render(<Scrollbar data-testid="scrollbar">内容</Scrollbar>)

      const scrollbar = screen.getByTestId('scrollbar')
      expect(scrollbar).toHaveAttribute('data-scrolling', 'false')

      fireEvent.scroll(scrollbar)
      expect(scrollbar).toHaveAttribute('data-scrolling', 'true')

      act(() => {
        vi.advanceTimersByTime(1000)
      })
      expect(scrollbar).toHaveAttribute('data-scrolling', 'true')

      fireEvent.scroll(scrollbar)

      act(() => {
        vi.advanceTimersByTime(600)
      })
      expect(scrollbar).toHaveAttribute('data-scrolling', 'true')

      act(() => {
        vi.advanceTimersByTime(900)
      })
      expect(scrollbar).toHaveAttribute('data-scrolling', 'false')
    })
  })
})
