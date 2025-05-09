import { describe, expect, it } from 'vitest'

import { delay, runAsyncFunction } from '../index'

describe('Unclassified Utils', () => {
  describe('runAsyncFunction', () => {
    it('should execute async function', async () => {
      // 验证异步函数被执行
      let called = false
      await runAsyncFunction(async () => {
        called = true
      })
      expect(called).toBe(true)
    })

    it('should throw error if async function fails', async () => {
      // 验证异步函数抛出错误
      await expect(
        runAsyncFunction(async () => {
          throw new Error('Test error')
        })
      ).rejects.toThrow('Test error')
    })
  })

  describe('delay', () => {
    it('should resolve after specified seconds', async () => {
      // 验证指定时间后返回
      const start = Date.now()
      await delay(0.01)
      const end = Date.now()
      // In JavaScript, the delay time of setTimeout is not always precise
      // and may be slightly shorter than specified. Make it more lenient:
      const lenientRatio = 0.8
      expect(end - start).toBeGreaterThanOrEqual(10 * lenientRatio)
    })

    it('should resolve immediately for zero delay', async () => {
      // 验证零延迟立即返回
      const start = Date.now()
      await delay(0)
      const end = Date.now()
      expect(end - start).toBeLessThan(100)
    })
  })
})
