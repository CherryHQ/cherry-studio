import {
  DEFAULT_LANGUAGES,
  DEFAULT_THEMES,
  getHighlighter,
  loadLanguageIfNeeded,
  loadThemeIfNeeded
} from '@renderer/utils/shiki'
import { LRUCache } from 'lru-cache'
import type { HighlighterGeneric, ThemedToken } from 'shiki/core'

import { ShikiStreamTokenizer, ShikiStreamTokenizerOptions } from './ShikiStreamTokenizer'

export type ShikiPreProperties = {
  class: string
  style: string
  tabindex: number
}

/**
 * 代码 chunk 高亮结果
 *
 * @param lines 所有高亮行（包括稳定和不稳定）
 * @param recall 需要撤回的行数，-1 表示撤回所有行
 */
export interface HighlightChunkResult {
  lines: ThemedToken[][]
  recall: number
}

/**
 * Shiki 代码高亮服务
 *
 * - 支持流式代码高亮。
 * - 优先使用 Worker 处理高亮请求。
 */
class ShikiStreamService {
  // 主线程 highlighter 和 tokenizers
  private highlighter: HighlighterGeneric<any, any> | null = null

  // 保存以 callerId-language-theme 为键的 tokenizer map
  private tokenizerCache = new LRUCache<string, ShikiStreamTokenizer>({
    max: 100, // 最大缓存数量
    ttl: 1000 * 60 * 30, // 30分钟过期时间
    updateAgeOnGet: true,
    dispose: (value) => {
      if (value) value.clear()
    }
  })

  // 缓存每个 callerId 对应的已处理内容
  private codeCache = new LRUCache<string, string>({
    max: 100, // 最大缓存数量
    ttl: 1000 * 60 * 30, // 30分钟过期时间
    updateAgeOnGet: true
  })

  // Worker 相关资源
  private worker: Worker | null = null
  private workerInitPromise: Promise<void> | null = null
  private workerInitRetryCount: number = 0
  private static readonly MAX_WORKER_INIT_RETRY = 2
  private pendingRequests = new Map<
    number,
    {
      resolve: (value: any) => void
      reject: (reason?: any) => void
    }
  >()
  private requestId = 0

  // 降级策略相关变量，用于记录调用 worker 失败过的 callerId
  private workerDegradationCache = new LRUCache<string, boolean>({
    max: 1000, // 最大记录数量
    ttl: 1000 * 60 * 60 * 12 // 12小时自动过期
  })

  constructor() {
    // 延迟初始化
  }

  /**
   * 判断是否正在使用 Worker 高亮。外部不要依赖这个方法来判断。
   */
  public hasWorkerHighlighter(): boolean {
    return !!this.worker && !this.workerInitPromise
  }

  /**
   * 判断是否正在使用主线程高亮。外部不要依赖这个方法来判断。
   */
  public hasMainHighlighter(): boolean {
    return !!this.highlighter
  }

  /**
   * 初始化 Worker
   */
  private async initWorker(): Promise<void> {
    if (typeof Worker === 'undefined') return
    if (this.workerInitPromise) return this.workerInitPromise
    if (this.worker) return

    if (this.workerInitRetryCount >= ShikiStreamService.MAX_WORKER_INIT_RETRY) {
      console.debug('ShikiStream worker initialization failed too many times, stop trying')
      return
    }

    this.workerInitPromise = (async () => {
      try {
        // 动态导入 worker
        const WorkerModule = await import('../workers/shiki-stream.worker?worker')
        this.worker = new WorkerModule.default()

        // 设置消息处理器
        this.worker.onmessage = (event) => {
          const { id, type, result, error } = event.data

          // 查找对应的请求
          const pendingRequest = this.pendingRequests.get(id)
          if (!pendingRequest) return

          this.pendingRequests.delete(id)

          if (type === 'error') {
            pendingRequest.reject(new Error(error))
          } else if (type === 'init-result') {
            pendingRequest.resolve({ success: true })
            this.workerInitRetryCount = 0
          } else {
            pendingRequest.resolve(result)
          }
        }

        // 初始化 worker
        await this.sendWorkerMessage({
          type: 'init',
          languages: DEFAULT_LANGUAGES,
          themes: DEFAULT_THEMES
        })
        this.workerInitRetryCount = 0
      } catch (error) {
        this.worker?.terminate()
        this.worker = null
        this.workerInitRetryCount++
        throw error
      } finally {
        this.workerInitPromise = null
      }
    })()

    return this.workerInitPromise
  }

  /**
   * 向 Worker 发送消息并等待回复
   */
  private sendWorkerMessage(message: any): Promise<any> {
    if (!this.worker) {
      return Promise.reject(new Error('Worker not available'))
    }

    const id = this.requestId++
    let timerId: ReturnType<typeof setTimeout>
    let settled = false

    const promise = new Promise((resolve, reject) => {
      const safeResolve = (value: any) => {
        if (!settled) {
          settled = true
          clearTimeout(timerId)
          this.pendingRequests.delete(id)
          resolve(value)
        }
      }

      const safeReject = (reason?: any) => {
        if (!settled) {
          settled = true
          clearTimeout(timerId)
          this.pendingRequests.delete(id)
          reject(reason)
        }
      }

      this.pendingRequests.set(id, { resolve: safeResolve, reject: safeReject })

      // 根据操作类型设置不同的超时时间
      const getTimeoutForMessageType = (type: string): number => {
        switch (type) {
          case 'init':
            return 5000 // 初始化操作 (5秒)
          case 'highlight':
            return 30000 // 高亮操作 (30秒)
          case 'cleanup':
          case 'dispose':
          default:
            return 10000 // 其他操作 (10秒)
        }
      }

      const timeout = getTimeoutForMessageType(message.type)

      // 设置超时处理
      timerId = setTimeout(() => {
        // 如果是高亮操作超时，说明代码块太长，记录callerId以便降级
        if (message.type === 'highlight' && message.callerId) {
          this.workerDegradationCache.set(message.callerId, true)
          safeReject(new Error(`Worker ${message.type} request timeout for callerId ${message.callerId}`))
        } else {
          safeReject(new Error(`Worker ${message.type} request timeout`))
        }
      }, timeout)
    })

    try {
      this.worker.postMessage({ id, ...message })
    } catch (error) {
      const pendingRequest = this.pendingRequests.get(id)
      if (pendingRequest) {
        pendingRequest.reject(error instanceof Error ? error : new Error(String(error)))
      }
    }

    return promise
  }

  /**
   * 确保 highlighter 已配置
   * @param language 语言
   * @param theme 主题
   */
  private async ensureHighlighterConfigured(
    language: string,
    theme: string
  ): Promise<{ loadedLanguage: string; loadedTheme: string }> {
    if (!this.highlighter) {
      this.highlighter = await getHighlighter()
    }

    const loadedLanguage = await loadLanguageIfNeeded(this.highlighter, language)
    const loadedTheme = await loadThemeIfNeeded(this.highlighter, theme)

    return { loadedLanguage, loadedTheme }
  }

  /**
   * 获取 Shiki 的 pre 标签属性
   *
   * 跑一个简单的 hast 结果，从中提取 properties 属性。
   * 如果有更加稳定的方法可以替换。
   * @param language 语言
   * @param theme 主题
   * @returns pre 标签属性
   */
  async getShikiPreProperties(language: string, theme: string): Promise<ShikiPreProperties> {
    const { loadedLanguage, loadedTheme } = await this.ensureHighlighterConfigured(language, theme)

    if (!this.highlighter) {
      throw new Error('Highlighter not initialized')
    }

    const hast = this.highlighter.codeToHast('1', {
      lang: loadedLanguage,
      theme: loadedTheme
    })

    // @ts-ignore hack
    return hast.children[0].properties as ShikiPreProperties
  }

  /**
   * 高亮流式输出的代码，调用方传入完整代码内容，得到增量高亮结果。
   *
   * - 检测当前内容与上次处理内容的差异。
   * - 如果是末尾追加，只传输增量部分（此时性能最好，如遇性能问题，考虑检查这里的逻辑）。
   * - 如果不是追加，重置 tokenizer 并处理完整内容。
   *
   * 调用者需要自行处理撤回。
   * @param code 完整代码内容
   * @param language 语言
   * @param theme 主题
   * @param callerId 调用者ID
   * @returns 高亮结果，recall 为 -1 表示撤回所有行
   */
  async highlightStreamingCode(
    code: string,
    language: string,
    theme: string,
    callerId: string
  ): Promise<HighlightChunkResult> {
    const cacheKey = `${callerId}-${language}-${theme}`
    const lastContent = this.codeCache.get(cacheKey) || ''

    let isAppend = false

    if (code.length === lastContent.length) {
      // 内容没有变化，返回空结果
      if (code === lastContent) {
        return { lines: [], recall: 0 }
      }
    } else if (code.length > lastContent.length) {
      // 长度增加，可能是追加
      isAppend = code.startsWith(lastContent)
    }

    try {
      let result: HighlightChunkResult

      if (isAppend) {
        // 流式追加，只传输增量
        const chunk = code.slice(lastContent.length)
        result = await this.highlightCodeChunk(chunk, language, theme, callerId)
      } else {
        // 非追加变化，重置并处理完整内容
        this.cleanupTokenizers(callerId)
        this.codeCache.delete(cacheKey) // 清除缓存

        result = await this.highlightCodeChunk(code, language, theme, callerId)

        // 撤回所有行
        result = {
          ...result,
          recall: -1
        }
      }

      // 成功处理后更新缓存
      this.codeCache.set(cacheKey, code)
      return result
    } catch (error) {
      // 处理失败时不更新缓存，保持之前的状态
      console.error('Failed to highlight streaming code:', error)
      throw error
    }
  }

  /**
   * 高亮代码 chunk，返回本次高亮的所有 ThemedToken 行
   *
   * 优先使用 Worker 处理，失败时回退到主线程处理。
   * 调用者需要自行处理撤回。
   * @param chunk 代码内容
   * @param language 语言
   * @param theme 主题
   * @param callerId 调用者ID，用于标识不同的组件实例
   * @returns ThemedToken 行
   */
  async highlightCodeChunk(
    chunk: string,
    language: string,
    theme: string,
    callerId: string
  ): Promise<HighlightChunkResult> {
    // 检查callerId是否需要降级处理
    if (this.workerDegradationCache.has(callerId)) {
      return this.highlightWithMainThread(chunk, language, theme, callerId)
    }

    // 初始化 worker
    if (!this.worker) {
      try {
        await this.initWorker()
      } catch (error) {
        console.warn('Failed to initialize worker, falling back to main thread:', error)
      }
    }

    // 如果 Worker 可用，优先使用 Worker 处理
    if (this.hasWorkerHighlighter()) {
      try {
        const result = await this.sendWorkerMessage({
          type: 'highlight',
          callerId,
          chunk,
          language,
          theme
        })
        return result
      } catch (error) {
        // Worker 处理失败，记录callerId并永久降级到主线程
        // FIXME: 这种情况如果出现，流式高亮语法状态就会丢失，目前用降级策略来处理
        this.workerDegradationCache.set(callerId, true)
        console.error(
          `Worker highlight failed for callerId ${callerId}, permanently falling back to main thread:`,
          error
        )
      }
    }

    // 使用主线程处理
    return this.highlightWithMainThread(chunk, language, theme, callerId)
  }

  /**
   * 使用主线程处理代码高亮
   * @param chunk 代码内容
   * @param language 语言
   * @param theme 主题
   * @param callerId 调用者ID
   * @returns 高亮结果
   */
  private async highlightWithMainThread(
    chunk: string,
    language: string,
    theme: string,
    callerId: string
  ): Promise<HighlightChunkResult> {
    try {
      const tokenizer = await this.getStreamTokenizer(callerId, language, theme)

      const result = await tokenizer.enqueue(chunk)

      // 合并稳定和不稳定的行作为本次高亮的所有行
      return {
        lines: [...result.stable, ...result.unstable],
        recall: result.recall
      }
    } catch (error) {
      console.error('Failed to highlight code chunk:', error)

      // 提供简单的 fallback
      const fallbackToken: ThemedToken = { content: chunk || '', color: '#000000', offset: 0 }
      return {
        lines: [[fallbackToken]],
        recall: 0
      }
    }
  }

  /**
   * 获取或创建 tokenizer
   * @param callerId 调用者ID
   * @param language 语言
   * @param theme 主题
   * @returns tokenizer 实例
   */
  private async getStreamTokenizer(callerId: string, language: string, theme: string): Promise<ShikiStreamTokenizer> {
    // 创建复合键
    const cacheKey = `${callerId}-${language}-${theme}`

    // 如果已存在，直接返回
    if (this.tokenizerCache.has(cacheKey)) {
      return this.tokenizerCache.get(cacheKey)!
    }

    // 确保 highlighter 已配置
    const { loadedLanguage, loadedTheme } = await this.ensureHighlighterConfigured(language, theme)

    if (!this.highlighter) {
      throw new Error('Highlighter not initialized')
    }

    // 创建新的 tokenizer
    const options: ShikiStreamTokenizerOptions = {
      highlighter: this.highlighter,
      lang: loadedLanguage,
      theme: loadedTheme
    }

    const tokenizer = new ShikiStreamTokenizer(options)
    this.tokenizerCache.set(cacheKey, tokenizer)

    return tokenizer
  }

  /**
   * 清理特定调用者的 tokenizers
   * @param callerId 调用者ID
   */
  cleanupTokenizers(callerId: string): void {
    // 先尝试清理 Worker 中的 tokenizers
    if (this.hasWorkerHighlighter()) {
      this.sendWorkerMessage({
        type: 'cleanup',
        callerId
      }).catch((error) => {
        console.error('Failed to cleanup worker tokenizer:', error)
      })
    }

    // 清理对应的内容缓存
    for (const key of this.codeCache.keys()) {
      if (key.startsWith(`${callerId}-`)) {
        this.codeCache.delete(key)
      }
    }

    // 再清理主线程中的 tokenizers，移除所有以 callerId 开头的缓存项
    for (const key of this.tokenizerCache.keys()) {
      if (key.startsWith(`${callerId}-`)) {
        this.tokenizerCache.delete(key)
      }
    }
  }

  /**
   * 销毁所有资源
   */
  dispose() {
    if (this.worker) {
      this.sendWorkerMessage({ type: 'dispose' }).catch((error) => {
        console.warn('Failed to dispose worker:', error)
      })
      this.worker.terminate()
      this.worker = null
      this.pendingRequests.clear()
      this.requestId = 0
    }

    this.workerDegradationCache.clear()
    this.tokenizerCache.clear()
    this.codeCache.clear()
    this.highlighter = null
    this.workerInitPromise = null
    this.workerInitRetryCount = 0
  }
}

export const shikiStreamService = new ShikiStreamService()
