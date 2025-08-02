import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useTemporaryValue } from '../useTemporaryValue'

describe('useTemporaryValue', () => {
  beforeEach(() => {
    // 使用假定时器
    vi.useFakeTimers()
  })

  afterEach(() => {
    // 恢复真实定时器
    vi.useRealTimers()
  })

  describe('basic functionality', () => {
    it('should return the default value initially', () => {
      const { result } = renderHook(() => useTemporaryValue('default'))
      const [value] = result.current

      expect(value).toBe('default')
    })

    it('should temporarily change the value and then revert', () => {
      const { result } = renderHook(() => useTemporaryValue('default', 1000))
      const [, setTemporaryValue] = result.current

      // 设置临时值
      act(() => {
        setTemporaryValue('temporary')
      })

      expect(result.current[0]).toBe('temporary')

      // 快进定时器
      act(() => {
        vi.advanceTimersByTime(1000)
      })

      expect(result.current[0]).toBe('default')
    })

    it('should handle same value as default', () => {
      const { result } = renderHook(() => useTemporaryValue('default', 1000))
      const [, setTemporaryValue] = result.current

      // 设置与默认值相同的值
      act(() => {
        setTemporaryValue('default')
      })

      expect(result.current[0]).toBe('default')

      // 快进定时器（即使不需要恢复，也不会出错）
      act(() => {
        vi.advanceTimersByTime(1000)
      })

      // 应该保持默认值
      expect(result.current[0]).toBe('default')
    })
  })

  describe('timer management', () => {
    it('should clear timeout on unmount', () => {
      const { result, unmount } = renderHook(() => useTemporaryValue('default', 1000))
      const [, setTemporaryValue] = result.current

      // 设置临时值
      act(() => {
        setTemporaryValue('temporary')
      })

      // 验证值已更改
      expect(result.current[0]).toBe('temporary')

      // 卸载 hook
      unmount()

      // 快进定时器
      act(() => {
        vi.advanceTimersByTime(1000)
      })

      // 验证没有错误发生（值保持不变，因为我们已卸载）
      expect(result.current[0]).toBe('temporary') // 注意：这里应该还是'temporary'，因为组件已卸载
    })

    it('should handle multiple calls correctly', () => {
      const { result } = renderHook(() => useTemporaryValue('default', 1000))
      const [, setTemporaryValue] = result.current

      // 设置临时值
      act(() => {
        setTemporaryValue('temporary1')
      })

      expect(result.current[0]).toBe('temporary1')

      // 在第一个值过期前设置另一个临时值
      act(() => {
        setTemporaryValue('temporary2')
      })

      expect(result.current[0]).toBe('temporary2')

      // 快进定时器
      act(() => {
        vi.advanceTimersByTime(1000)
      })

      expect(result.current[0]).toBe('default')
    })

    it('should handle custom duration', () => {
      const { result } = renderHook(() => useTemporaryValue('default', 500))
      const [, setTemporaryValue] = result.current

      act(() => {
        setTemporaryValue('temporary')
      })

      expect(result.current[0]).toBe('temporary')

      act(() => {
        vi.advanceTimersByTime(500)
      })

      expect(result.current[0]).toBe('default')
    })

    it('should handle very short duration', () => {
      const { result } = renderHook(() => useTemporaryValue('default', 0))
      const [, setTemporaryValue] = result.current

      act(() => {
        setTemporaryValue('temporary')
      })

      expect(result.current[0]).toBe('temporary')

      // 对于0ms的定时器，需要运行所有微任务
      act(() => {
        vi.runAllTimers()
      })

      expect(result.current[0]).toBe('default')
    })
  })

  describe('data types', () => {
    it.each([
      [false, true],
      [0, 5],
      ['', 'temporary'],
      [null, 'value'],
      [undefined, 'value'],
      [{}, { key: 'value' }],
      [[], [1, 2, 3]]
    ])('should work with type: %p', (defaultValue, temporaryValue) => {
      const { result } = renderHook(() => useTemporaryValue(defaultValue, 1000))
      const [, setTemporaryValue] = result.current

      act(() => {
        setTemporaryValue(temporaryValue)
      })

      expect(result.current[0]).toEqual(temporaryValue)

      act(() => {
        vi.advanceTimersByTime(1000)
      })

      expect(result.current[0]).toEqual(defaultValue)
    })
  })

  describe('edge cases', () => {
    it('should handle same temporary value multiple times', () => {
      const { result } = renderHook(() => useTemporaryValue('default', 1000))
      const [, setTemporaryValue] = result.current

      // 设置临时值
      act(() => {
        setTemporaryValue('temporary')
      })

      expect(result.current[0]).toBe('temporary')

      // 再次设置相同的临时值
      act(() => {
        setTemporaryValue('temporary')
      })

      expect(result.current[0]).toBe('temporary')

      // 快进定时器
      act(() => {
        vi.advanceTimersByTime(1000)
      })

      expect(result.current[0]).toBe('default')
    })
  })
})
