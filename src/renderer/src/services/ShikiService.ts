import ShikiWorker from '../workers/shiki.worker?worker'
import { CodeCacheService } from './CodeCacheService'

interface PendingRequest {
  resolvers: Array<(html: string) => void>
  code: string
  enableCache: boolean
  timeoutId?: ReturnType<typeof setTimeout>
}

/**
 * Shiki 代码高亮服务
 *
 * 回退路径:
 * - 优先使用 Web Worker 处理代码高亮，避免主线程阻塞
 * - 否则，使用主线程 highlighter 处理
 * - 否则，返回没有高亮的代码
 *
 * 支持重复请求合并
 * 支持高亮代码缓存
 * */
class ShikiService {
  private worker: Worker | null = null // Worker highlighter 实例
  private highlighter: any = null // 主线程highlighter 实例
  private pendingRequests = new Map<string, PendingRequest>()
  private isInitialized = false
  private isInitializing = false
  private initPromise: Promise<void> | null = null
  private resolveInit?: () => void

  private async init() {
    if (this.isInitialized || this.isInitializing) {
      return this.initPromise
    }

    this.isInitializing = true

    this.initPromise = Promise.resolve()
      // 尝试初始化Worker highlighter
      .then(() => {
        if (typeof Worker === 'undefined') {
          return Promise.reject(new Error('Web Worker is not supported'))
        }
        return this.initWorker()
      })
      // 尝试初始化主线程 highlighter
      .catch((error) => {
        console.warn('[ShikiService] Worker initialization failed, falling back to main thread:', error)
        this.worker = null
        return this.initMainThreadHighlighter()
      })
      // Highlighter 不可用，实际运行中回退到没有高亮的代码
      .catch((error) => {
        console.error('[ShikiService] Failed to initialize shiki in main thread:', error)
      })
      .finally(() => {
        // 只有在初始化失败时重置状态
        // worker成功时onmessage会设置isInitialized和isInitializing
        if (!this.isInitialized) {
          this.isInitializing = false
        }
      })

    return this.initPromise
  }

  private async initWorker() {
    if (typeof Worker === 'undefined') {
      console.warn('[ShikiService] Web Worker is not supported in this environment')
      return
    }

    this.worker = new ShikiWorker()

    this.worker.onmessage = (e) => {
      const { type, result, cacheKey } = e.data

      if (type === 'init') {
        this.isInitialized = true
        this.isInitializing = false
        this.resolveInit?.()
      }

      if (type === 'highlight' && cacheKey && this.pendingRequests.has(cacheKey)) {
        if (result.success && result.html) {
          this.resolveRequest(cacheKey, result.html, result.codeLength)
        } else {
          console.warn(`[ShikiService] Failed to highlight:`, result.error || 'Unknown error')
          this.rejectRequest(cacheKey)
        }
      }
    }

    this.initPromise = new Promise((resolve) => {
      this.resolveInit = resolve

      this.worker?.postMessage({
        type: 'init',
        payload: {
          languages: ['javascript', 'typescript', 'python', 'java', 'markdown'],
          themes: ['one-light', 'material-theme-darker']
        }
      })
    })

    await this.initPromise
  }

  private async initMainThreadHighlighter() {
    try {
      const { createHighlighter } = await import('shiki')

      this.highlighter = await createHighlighter({
        langs: ['javascript', 'typescript', 'python', 'java', 'markdown'],
        themes: ['one-light', 'material-theme-darker']
      })

      this.isInitialized = true
    } finally {
      this.isInitializing = false
    }
  }

  /**
   * 执行代码高亮。enableCache 为 true 并且用户启用了缓存功能时，缓存才会真正生效。
   * @param code 代码
   * @param language 语言
   * @param theme 主题
   * @param enableCache 是否启用缓存
   * @returns 高亮后的代码
   */
  async highlightCode(code: string, language: string, theme: string, enableCache: boolean): Promise<string> {
    if (!code) return ''

    // 检查缓存
    const cacheKey = CodeCacheService.generateCacheKey(code, language, theme)
    if (enableCache) {
      const cached = CodeCacheService.getCachedResult(cacheKey)
      if (cached) return cached
    }

    // 首次使用时初始化
    if (!this.isInitialized) {
      await this.init()
    }

    // Fallback
    if (!this.worker && !this.highlighter) {
      const escapedCode = code?.replace(/[<>]/g, (char) => ({ '<': '&lt;', '>': '&gt;' })[char]!)
      return `<pre style="padding: 10px"><code>${escapedCode}</code></pre>`
    }

    return new Promise((resolve) => {
      // 注册代码高亮请求
      this.registerRequest(cacheKey, code, enableCache, resolve)

      // Worker => Main Thread => No highlight
      if (this.worker) {
        this.worker.postMessage({
          type: 'highlight',
          payload: {
            code,
            language,
            theme,
            cacheKey,
            codeLength: code.length
          }
        })
      } else if (this.highlighter) {
        this.processInMainThread(code, language, theme, cacheKey)
      } else {
        this.rejectRequest(cacheKey)
      }
    })
  }

  // 主线程执行代码高亮
  private async processInMainThread(code: string, language: string, theme: string, cacheKey: string) {
    if (!this.pendingRequests.has(cacheKey)) return

    try {
      // 在主线程中直接调用shiki
      const html = this.highlighter.codeToHtml(code, {
        lang: language,
        theme: theme
      })

      this.resolveRequest(cacheKey, html, code.length)
    } catch (error) {
      this.rejectRequest(cacheKey)
    }
  }

  /**
   * 注册新的高亮请求
   */
  private registerRequest(
    cacheKey: string,
    code: string,
    enableCache: boolean,
    resolver: (html: string) => void
  ): void {
    // 合并相同请求，减少不必要的计算
    if (this.pendingRequests.has(cacheKey)) {
      const pendingRequest = this.pendingRequests.get(cacheKey)!
      pendingRequest.resolvers.push(resolver)
      return
    }

    // 设置整个请求的超时处理
    const timeoutId = setTimeout(() => {
      this.rejectRequest(cacheKey)
    }, 10000) // 10秒应该足够了

    // 为新请求创建条目
    this.pendingRequests.set(cacheKey, {
      resolvers: [resolver],
      code,
      enableCache,
      timeoutId
    })
  }

  /**
   * 处理高亮成功的情况
   */
  private resolveRequest(cacheKey: string, html: string, codeLength?: number): void {
    if (!this.pendingRequests.has(cacheKey)) return

    const pendingRequest = this.pendingRequests.get(cacheKey)!

    if (pendingRequest.timeoutId) {
      clearTimeout(pendingRequest.timeoutId)
    }

    if (pendingRequest.enableCache) {
      CodeCacheService.setCachedResult(cacheKey, html, codeLength || pendingRequest.code.length)
    }

    pendingRequest.resolvers.forEach((resolver) => resolver(html))
    this.pendingRequests.delete(cacheKey)
  }

  /**
   * 处理高亮失败的情况，提供简单的回退方式
   */
  private rejectRequest(cacheKey: string): void {
    if (!this.pendingRequests.has(cacheKey)) return

    const pendingRequest = this.pendingRequests.get(cacheKey)!

    if (pendingRequest.timeoutId) {
      clearTimeout(pendingRequest.timeoutId)
    }

    // 提供简单的fallback
    const escapedCode = pendingRequest.code.replace(/[<>]/g, (char) => ({ '<': '&lt;', '>': '&gt;' })[char]!)
    const fallbackHtml = `<pre style="padding: 10px"><code>${escapedCode}</code></pre>`

    pendingRequest.resolvers.forEach((resolver) => resolver(fallbackHtml))
    this.pendingRequests.delete(cacheKey)
  }

  dispose() {
    if (this.worker) {
      this.worker.terminate()
      this.worker = null
    }

    this.highlighter = null
    this.isInitialized = false
    this.isInitializing = false
    this.initPromise = null

    this.pendingRequests.forEach((request) => {
      if (request.timeoutId) {
        clearTimeout(request.timeoutId)
      }
    })

    this.pendingRequests.clear()
  }
}

export const shikiService = new ShikiService()
