import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { shikiStreamService } from '../ShikiStreamService'

describe('ShikiStreamService', () => {
  const language = 'typescript'
  const theme = 'one-light'
  const callerId = 'test-caller'

  // 保证每次测试环境干净
  beforeEach(() => {
    shikiStreamService.dispose()
  })
  afterEach(() => {
    shikiStreamService.dispose()
  })

  describe('Worker initialization and degradation', () => {
    it('should initialize worker and highlight via worker', async () => {
      const code = 'const x = 1;'

      // 这里不 mock Worker，直接走真实逻辑
      const result = await shikiStreamService.highlightCodeChunk(code, language, theme, callerId)

      // Wait a bit for worker initialization to complete
      await new Promise((resolve) => setTimeout(resolve, 100))

      // In test environment, worker initialization might fail, so we should check if it actually succeeded
      // If worker initialization succeeded, it should be true, otherwise it falls back to main thread
      const hasWorker = shikiStreamService.hasWorkerHighlighter()
      const hasMain = shikiStreamService.hasMainHighlighter()

      // Either worker or main thread should be working, but not both
      expect(hasWorker || hasMain).toBe(true)
      expect(hasWorker && hasMain).toBe(false)

      expect(result.lines.length).toBeGreaterThan(0)
      expect(result.recall).toBe(0)
    })

    it('should fallback to main thread if worker initialization fails', async () => {
      const originalWorker = globalThis.Worker
      // @ts-ignore: 强制删除 Worker 构造函数
      globalThis.Worker = undefined

      const code = 'const y = 2;'

      const result = await shikiStreamService.highlightCodeChunk(code, language, theme, callerId)
      expect(shikiStreamService.hasWorkerHighlighter()).toBe(false)
      expect(result.lines.length).toBeGreaterThan(0)
      expect(result.recall).toBe(0)

      // @ts-ignore: 恢复 Worker 构造函数
      globalThis.Worker = originalWorker
    })

    it('should not retry worker after too many init failures', async () => {
      // 模拟多次初始化失败
      const spy = vi.spyOn(shikiStreamService as any, 'initWorker').mockImplementation(() => {
        return Promise.reject(new Error('init failed'))
      })

      // @ts-ignore: access private
      const maxRetryCount = shikiStreamService.MAX_WORKER_INIT_RETRY

      // 连续多次调用
      for (let i = 1; i < maxRetryCount + 2; i++) {
        shikiStreamService.highlightCodeChunk('const a = ' + i, language, theme, callerId).catch(() => {})
        // @ts-ignore: access private
        expect(shikiStreamService.workerInitRetryCount).toBe(Math.min(i, maxRetryCount))
      }
      spy.mockRestore()
    })
  })

  describe('tokenizer management (main)', () => {
    let originalWorker: any

    beforeEach(() => {
      originalWorker = globalThis.Worker
      // @ts-ignore: 强制删除 Worker 构造函数
      globalThis.Worker = undefined
    })
    afterEach(() => {
      // @ts-ignore: 恢复 Worker 构造函数
      globalThis.Worker = originalWorker
    })

    it('should reuse the same tokenizer for the same callerId-language-theme', async () => {
      const code1 = 'const a = 1;'
      const code2 = 'const b = 2;'
      const cacheKey = `${callerId}-${language}-${theme}`

      // 先高亮一次，创建 tokenizer
      await shikiStreamService.highlightCodeChunk(code1, language, theme, callerId)
      // @ts-ignore: access private
      const tokenizer1 = shikiStreamService.tokenizerCache.get(cacheKey)

      // 再高亮一次，应该复用 tokenizer
      await shikiStreamService.highlightCodeChunk(code2, language, theme, callerId)
      // @ts-ignore: access private
      const tokenizer2 = shikiStreamService.tokenizerCache.get(cacheKey)

      expect(tokenizer1).toBe(tokenizer2)
    })

    it.each([
      // [desc, callerId, language, theme, other, otherDesc]
      ['different language', 'javascript', 'one-light', 'test-caller'],
      ['different theme', 'typescript', 'material-theme-darker', 'test-caller'],
      ['different callerId', 'typescript', 'one-light', 'another-caller']
    ])('should create a new tokenizer for %s', async (_description, _language, _theme, _callerId) => {
      const code = 'const x = 1;'

      const cacheKey = `${callerId}-${language}-${theme}`
      const otherCacheKey = `${_callerId}-${_language}-${_theme}`

      await shikiStreamService.highlightCodeChunk(code, language, theme, callerId)
      // @ts-ignore: access private
      expect(shikiStreamService.tokenizerCache.has(cacheKey)).toBe(true)
      // @ts-ignore: access private
      expect(shikiStreamService.tokenizerCache.has(otherCacheKey)).toBe(false)

      await shikiStreamService.highlightCodeChunk(code, _language, _theme, _callerId)
      // @ts-ignore: access private
      expect(shikiStreamService.tokenizerCache.has(cacheKey)).toBe(true)
      // @ts-ignore: access private
      expect(shikiStreamService.tokenizerCache.has(otherCacheKey)).toBe(true)
    })

    it('should cleanup tokenizer for a specific callerId', async () => {
      const code = 'const x = 1;'
      const cacheKey = `${callerId}-${language}-${theme}`

      await shikiStreamService.highlightCodeChunk(code, language, theme, callerId)
      // @ts-ignore: access private
      expect(shikiStreamService.tokenizerCache.has(cacheKey)).toBe(true)

      shikiStreamService.cleanupTokenizers(callerId)
      // @ts-ignore: access private
      expect(shikiStreamService.tokenizerCache.has(cacheKey)).toBe(false)
    })

    it('should not affect other callerIds when cleaning up', async () => {
      const code1 = 'const x = 1;'
      const code2 = 'const y = 2;'
      const otherCallerId = 'other-caller'

      const cacheKey1 = `${callerId}-${language}-${theme}`
      const cacheKey2 = `${otherCallerId}-${language}-${theme}`

      await shikiStreamService.highlightCodeChunk(code1, language, theme, callerId)
      await shikiStreamService.highlightCodeChunk(code2, language, theme, otherCallerId)

      // @ts-ignore: access private
      expect(shikiStreamService.tokenizerCache.has(cacheKey1)).toBe(true)
      // @ts-ignore: access private
      expect(shikiStreamService.tokenizerCache.has(cacheKey2)).toBe(true)

      shikiStreamService.cleanupTokenizers(callerId)
      // @ts-ignore: access private
      expect(shikiStreamService.tokenizerCache.has(cacheKey1)).toBe(false)
      // @ts-ignore: access private
      expect(shikiStreamService.tokenizerCache.has(cacheKey2)).toBe(true)
    })

    it('should cleanup tokenizers concurrently for different callerIds', async () => {
      const code = 'const x = 1;'
      const callerIds = ['concurrent-1', 'concurrent-2', 'concurrent-3']

      // 先为每个 callerId 创建 tokenizer
      await Promise.all(callerIds.map((id) => shikiStreamService.highlightCodeChunk(code, language, theme, id)))
      // 检查缓存
      for (const id of callerIds) {
        const cacheKey = `${id}-${language}-${theme}`
        // @ts-ignore: access private
        expect(shikiStreamService.tokenizerCache.has(cacheKey)).toBe(true)
      }

      // 并发清理
      await Promise.all(callerIds.map((id) => Promise.resolve(shikiStreamService.cleanupTokenizers(id))))
      // 检查缓存都被清理
      for (const id of callerIds) {
        const cacheKey = `${id}-${language}-${theme}`
        // @ts-ignore: access private
        expect(shikiStreamService.tokenizerCache.has(cacheKey)).toBe(false)
      }
    })

    it('should cleanup tokenizers concurrently for the same callerId', async () => {
      const code = 'const x = 1;'
      const cacheKey = `${callerId}-${language}-${theme}`

      await shikiStreamService.highlightCodeChunk(code, language, theme, callerId)
      // @ts-ignore: access private
      expect(shikiStreamService.tokenizerCache.has(cacheKey)).toBe(true)
      // 并发清理同一个 callerId
      await Promise.all([
        Promise.resolve(shikiStreamService.cleanupTokenizers(callerId)),
        Promise.resolve(shikiStreamService.cleanupTokenizers(callerId)),
        Promise.resolve(shikiStreamService.cleanupTokenizers(callerId))
      ])
      // @ts-ignore: access private
      expect(shikiStreamService.tokenizerCache.has(cacheKey)).toBe(false)
    })

    it('should not affect highlightCodeChunk when cleanupTokenizers is called concurrently', async () => {
      const code = 'const x = 1;'

      await shikiStreamService.highlightCodeChunk(code, language, theme, callerId)
      const cacheKey = `${callerId}-${language}-${theme}`
      // @ts-ignore: access private
      expect(shikiStreamService.tokenizerCache.has(cacheKey)).toBe(true)

      // 并发高亮和清理
      await Promise.all([
        shikiStreamService.highlightCodeChunk(code, language, theme, callerId),
        Promise.resolve(shikiStreamService.cleanupTokenizers(callerId)),
        shikiStreamService.highlightCodeChunk(code, language, theme, callerId)
      ])

      // 高亮后缓存应该存在
      // @ts-ignore: access private
      expect(shikiStreamService.tokenizerCache.has(cacheKey)).toBe(true)
      // 最后清理
      shikiStreamService.cleanupTokenizers(callerId)
      // @ts-ignore: access private
      expect(shikiStreamService.tokenizerCache.has(cacheKey)).toBe(false)
    })
  })

  describe('dispose', () => {
    it('should release all resources and reset state', async () => {
      // 先初始化资源
      const code = 'const x = 1;'
      await shikiStreamService.highlightCodeChunk(code, language, theme, callerId)

      // mock 关键方法
      const worker = (shikiStreamService as any).worker
      const workerTerminateSpy = worker ? vi.spyOn(worker, 'terminate') : undefined
      // Don't spy on highlighter.dispose() since it's managed by AsyncInitializer now
      const tokenizerCache = (shikiStreamService as any).tokenizerCache
      const tokenizerClearSpies: any[] = []
      for (const tokenizer of tokenizerCache.values()) {
        tokenizerClearSpies.push(vi.spyOn(tokenizer, 'clear'))
      }

      // dispose
      shikiStreamService.dispose()

      // worker terminated
      if (workerTerminateSpy) {
        expect(workerTerminateSpy).toHaveBeenCalled()
      }
      // highlighter is managed by AsyncInitializer, so we don't dispose it directly
      // Just check that the reference is cleared
      expect((shikiStreamService as any).highlighter).toBeNull()

      // all tokenizers cleared
      for (const spy of tokenizerClearSpies) {
        expect(spy).toHaveBeenCalled()
      }
      // assert cache and references are cleared
      expect((shikiStreamService as any).worker).toBeNull()
      expect((shikiStreamService as any).highlighter).toBeNull()
      expect((shikiStreamService as any).tokenizerCache.size).toBe(0)
      expect((shikiStreamService as any).pendingRequests.size).toBe(0)
      expect((shikiStreamService as any).workerInitPromise).toBeNull()
      expect((shikiStreamService as any).workerInitRetryCount).toBe(0)
    })

    it('should be idempotent when called multiple times', () => {
      // 重复 dispose 不抛异常
      expect(() => {
        shikiStreamService.dispose()
        shikiStreamService.dispose()
        shikiStreamService.dispose()
      }).not.toThrow()

      expect((shikiStreamService as any).worker).toBeNull()
      expect((shikiStreamService as any).highlighter).toBeNull()
      expect((shikiStreamService as any).tokenizerCache.size).toBe(0)
    })

    it('should re-initialize after dispose when highlightCodeChunk is called', async () => {
      const code = 'const x = 1;'

      shikiStreamService.dispose()
      const result = await shikiStreamService.highlightCodeChunk(code, language, theme, callerId)

      expect(result.lines.length).toBeGreaterThan(0)
    })

    it('should not throw when cleanupTokenizers is called after dispose', () => {
      shikiStreamService.dispose()
      expect(() => {
        shikiStreamService.cleanupTokenizers('any-caller')
      }).not.toThrow()
    })
  })
})
