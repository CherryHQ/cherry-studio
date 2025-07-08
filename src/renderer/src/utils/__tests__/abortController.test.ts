import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  abortCompletion,
  abortMap,
  addAbortController,
  createAbortPromise,
  removeAbortController
} from '../abortController'

// Mock logger
vi.mock('@renderer/config/logger', () => ({
  default: {
    log: vi.fn()
  }
}))

describe('abortController', () => {
  beforeEach(() => {
    // 清理全局 Map
    abortMap.clear()
  })

  describe('addAbortController', () => {
    it('should add abort function to map', () => {
      const abortFn = vi.fn()
      addAbortController('test-id', abortFn)

      expect(abortMap.get('test-id')).toContain(abortFn)
    })

    it('should handle multiple abort functions for same id', () => {
      const fn1 = vi.fn()
      const fn2 = vi.fn()
      addAbortController('test-id', fn1)
      addAbortController('test-id', fn2)

      const fns = abortMap.get('test-id')
      expect(fns).toHaveLength(2)
      expect(fns).toEqual([fn1, fn2])
    })

    it('should handle duplicate functions for same id', () => {
      // 测试重复添加相同函数
      const fn = vi.fn()
      addAbortController('test-id', fn)
      addAbortController('test-id', fn)

      const fns = abortMap.get('test-id')
      expect(fns).toHaveLength(2)
      expect(fns).toEqual([fn, fn])
    })

    it('should handle empty string id', () => {
      // 测试空字符串 id
      const fn = vi.fn()
      addAbortController('', fn)

      expect(abortMap.get('')).toContain(fn)
    })
  })

  describe('removeAbortController', () => {
    it('should remove specific abort function', () => {
      const fn1 = vi.fn()
      const fn2 = vi.fn()
      addAbortController('test-id', fn1)
      addAbortController('test-id', fn2)

      removeAbortController('test-id', fn1)

      expect(abortMap.get('test-id')).toEqual([fn2])
    })

    it('should handle non-existent function gracefully', () => {
      const fn1 = vi.fn()
      const fn2 = vi.fn()
      addAbortController('test-id', fn1)

      // 删除不存在的函数，原函数应该保持
      removeAbortController('test-id', fn2)
      expect(abortMap.get('test-id')).toEqual([fn1])
    })

    it('should handle empty string id', () => {
      // 测试空字符串 id
      const fn = vi.fn()
      addAbortController('', fn)
      removeAbortController('', fn)
      expect(abortMap.get('')).toEqual([])
    })

    it('should handle non-existent id gracefully', () => {
      // 测试不存在的 id
      const fn = vi.fn()
      expect(() => removeAbortController('non-existent-id', fn)).not.toThrow()
    })
  })

  describe('abortCompletion', () => {
    it('should call all abort functions and clean up', () => {
      const fn1 = vi.fn()
      const fn2 = vi.fn()
      addAbortController('test-id', fn1)
      addAbortController('test-id', fn2)

      abortCompletion('test-id')

      // 验证所有函数被调用
      expect(fn1).toHaveBeenCalledTimes(1)
      expect(fn2).toHaveBeenCalledTimes(1)
      // 验证清理完成 - 数组变为空但条目仍存在
      expect(abortMap.get('test-id')).toEqual([])
    })

    it('should handle non-existent id gracefully', () => {
      expect(() => abortCompletion('non-existent')).not.toThrow()
    })

    it('should handle empty string id', () => {
      // 测试空字符串 id
      expect(() => abortCompletion('')).not.toThrow()
    })

    it('should handle empty function array', () => {
      // 测试空函数数组
      abortMap.set('test-id', [])
      expect(() => abortCompletion('test-id')).not.toThrow()
      expect(abortMap.has('test-id')).toBe(true) // 空数组不会被处理
    })
  })

  describe('createAbortPromise', () => {
    it('should reject immediately if signal already aborted', async () => {
      const controller = new AbortController()
      controller.abort()

      const promise = createAbortPromise(controller.signal, Promise.resolve('success'))

      await expect(promise).rejects.toMatchObject({
        name: 'AbortError',
        message: 'Operation aborted'
      })
    })

    it('should reject when signal is aborted later', async () => {
      const controller = new AbortController()
      const finallyPromise = new Promise<string>(() => {}) // 永不解析的 Promise

      const promise = createAbortPromise(controller.signal, finallyPromise)

      // 稍后中止
      setTimeout(() => controller.abort(), 10)

      await expect(promise).rejects.toThrow('Operation aborted')
    })

    it('should cleanup event listener when finallyPromise completes', async () => {
      const controller = new AbortController()
      const finallyPromise = Promise.resolve('completed')

      const removeEventListenerSpy = vi.spyOn(controller.signal, 'removeEventListener')

      createAbortPromise(controller.signal, finallyPromise)

      // 等待 finallyPromise 完成
      await finallyPromise

      // 给一点时间让 finally 回调执行
      await new Promise((resolve) => setTimeout(resolve, 0))

      // 验证清理工作
      expect(removeEventListenerSpy).toHaveBeenCalledWith('abort', expect.any(Function))
    })

    it('should not reject when finallyPromise resolves normally', async () => {
      // 测试正常完成情况
      const controller = new AbortController()
      const finallyPromise = Promise.resolve('success')

      // createAbortPromise 返回的是一个永远 pending 的 Promise（除非被 abort）
      const abortPromise = createAbortPromise(controller.signal, finallyPromise)

      // 让 finallyPromise 完成
      await finallyPromise

      // abortPromise 应该保持 pending 状态（因为没有被 abort）
      // 我们不能直接测试 pending 状态，但可以确保它不会立即 reject
      let rejected = false
      abortPromise.catch(() => {
        rejected = true
      })

      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(rejected).toBe(false)
    })

    it('should handle signal that becomes aborted before Promise creation', () => {
      // 测试在创建 Promise 前就已经 aborted 的信号
      const controller = new AbortController()
      controller.abort()

      const finallyPromise = new Promise<string>(() => {}) // 永不解析

      const promise = createAbortPromise(controller.signal, finallyPromise)

      return expect(promise).rejects.toMatchObject({
        name: 'AbortError',
        message: 'Operation aborted'
      })
    })
  })
})
