import { fireEvent, render, screen } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

import Scrollbar from '../Scrollbar'

// Mock es-toolkit/compat throttle
vi.mock('es-toolkit/compat', async () => {
  const actual = await import('es-toolkit/compat')
  return {
    ...actual,
    throttle: vi.fn((fn) => {
      // 简单地直接返回函数，不实际执行节流
      const throttled = (...args: any[]) => fn(...args)
      throttled.cancel = vi.fn()
      return throttled
    })
  }
})

describe('Scrollbar', () => {
  beforeEach(() => {
    // 使用 fake timers
    vi.useFakeTimers()
  })

  afterEach(() => {
    // 恢复真实的 timers
    vi.restoreAllMocks()
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

  describe('cleanup', () => {
    it('should clear timeout and cancel throttle on unmount', async () => {
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout')

      const { unmount } = render(<Scrollbar data-testid="scrollbar">内容</Scrollbar>)

      const scrollbar = screen.getByTestId('scrollbar')

      // 触发滚动设置定时器
      fireEvent.scroll(scrollbar)

      // 卸载组件
      unmount()

      // 验证 clearTimeout 被调用
      expect(clearTimeoutSpy).toHaveBeenCalled()

      // 验证 throttle.cancel 被调用
      const { throttle } = await import('es-toolkit/compat')
      const throttledFunction = (throttle as unknown as Mock).mock.results[0].value
      expect(throttledFunction.cancel).toHaveBeenCalled()
    })
  })

  describe('props handling', () => {
    it('should handle ref forwarding', () => {
      const ref = { current: null }

      render(
        <Scrollbar data-testid="scrollbar" ref={ref}>
          内容
        </Scrollbar>
      )

      // 验证 ref 被正确设置
      expect(ref.current).not.toBeNull()
    })
  })
})
