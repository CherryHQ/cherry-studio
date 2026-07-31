/// <reference lib="webworker" />

import { LRUCache } from 'lru-cache'
import type { HighlighterCore, SpecialLanguage, ThemedToken } from 'shiki/core'

import { loggerService } from '@logger'

// 注意保持 ShikiStreamTokenizer 依赖简单，避免打包出问题
import type { ShikiStreamTokenizerOptions } from '../services/ShikiStreamTokenizer'
import { ShikiStreamTokenizer } from '../services/ShikiStreamTokenizer'

const logger = loggerService.initWindowSource('Worker').withContext('ShikiStream')

// Worker 消息类型
type WorkerMessageType = 'init' | 'highlight' | 'highlight-html' | 'cleanup' | 'dispose'

interface WorkerRequest {
  id: number
  type: WorkerMessageType
  callerId?: string
  chunk?: string
  language?: string
  theme?: string
  languages?: string[]
  themes?: string[]
}

interface WorkerResponse {
  id: number
  type: string
  result?: any
  error?: string
}

interface HighlightChunkResult {
  lines: ThemedToken[][]
  recall: number
}

// Worker 全局变量
let highlighter: HighlighterCore | null = null
const languageLoadPromises = new Map<string, Promise<string>>()
const themeLoadPromises = new Map<string, Promise<string>>()

// 保存以 callerId-language-theme 为键的 tokenizer map
const tokenizerMap = new LRUCache<string, ShikiStreamTokenizer>({
  max: 100, // 最大缓存数量
  ttl: 1000 * 60 * 15, // 15分钟过期时间
  updateAgeOnGet: true,
  dispose: (value) => {
    if (value) value.clear()
  }
})

// 初始化高亮器
async function initHighlighter(themes: string[], languages: string[]): Promise<void> {
  const { createHighlighter } = await import('shiki')
  highlighter = await createHighlighter({
    langs: languages,
    themes: themes
  })
  languageLoadPromises.clear()
  themeLoadPromises.clear()
}

async function ensureLanguageLoaded(language: string): Promise<string> {
  if (!highlighter) {
    throw new Error('Highlighter not initialized')
  }
  const currentHighlighter = highlighter

  if (currentHighlighter.getLoadedLanguages().includes(language)) return language

  const pendingLoad = languageLoadPromises.get(language)
  if (pendingLoad) return pendingLoad

  const loadPromise = (async () => {
    try {
      if (['text', 'ansi'].includes(language)) {
        await currentHighlighter.loadLanguage(language as SpecialLanguage)
      } else {
        const { bundledLanguages } = await import('shiki')
        const languageImportFn = bundledLanguages[language]
        const langData = await languageImportFn()
        await currentHighlighter.loadLanguage(langData)
      }
    } catch (error) {
      // 回退到 text
      await currentHighlighter.loadLanguage('text')
      return 'text'
    }
    return language
  })()

  languageLoadPromises.set(language, loadPromise)
  try {
    return await loadPromise
  } finally {
    if (languageLoadPromises.get(language) === loadPromise) languageLoadPromises.delete(language)
  }
}

async function ensureThemeLoaded(theme: string): Promise<string> {
  if (!highlighter) {
    throw new Error('Highlighter not initialized')
  }
  const currentHighlighter = highlighter

  if (currentHighlighter.getLoadedThemes().includes(theme)) return theme

  const pendingLoad = themeLoadPromises.get(theme)
  if (pendingLoad) return pendingLoad

  const loadPromise = (async () => {
    try {
      const { bundledThemes } = await import('shiki')
      const themeImportFn = bundledThemes[theme]
      const themeData = await themeImportFn()
      await currentHighlighter.loadTheme(themeData)
    } catch (error) {
      // 回退到 one-light
      logger.debug(`Worker: Failed to load theme '${theme}', falling back to 'one-light':`, error as Error)
      const { bundledThemes } = await import('shiki')
      const oneLightTheme = await bundledThemes['one-light']()
      await currentHighlighter.loadTheme(oneLightTheme)
      return 'one-light'
    }
    return theme
  })()

  themeLoadPromises.set(theme, loadPromise)
  try {
    return await loadPromise
  } finally {
    if (themeLoadPromises.get(theme) === loadPromise) themeLoadPromises.delete(theme)
  }
}

// 确保语言和主题已加载
async function ensureLanguageAndThemeLoaded(
  language: string,
  theme: string
): Promise<{ actualLanguage: string; actualTheme: string }> {
  const [actualLanguage, actualTheme] = await Promise.all([ensureLanguageLoaded(language), ensureThemeLoaded(theme)])
  return { actualLanguage, actualTheme }
}

// 获取或创建 tokenizer
async function getStreamTokenizer(callerId: string, language: string, theme: string): Promise<ShikiStreamTokenizer> {
  // 创建复合键
  const cacheKey = `${callerId}-${language}-${theme}`

  // 如果已存在，直接返回
  if (tokenizerMap.has(cacheKey)) {
    return tokenizerMap.get(cacheKey)!
  }

  if (!highlighter) {
    throw new Error('Highlighter not initialized')
  }

  // 确保语言和主题已加载
  const { actualLanguage, actualTheme } = await ensureLanguageAndThemeLoaded(language, theme)

  // 创建新的 tokenizer
  const options: ShikiStreamTokenizerOptions = {
    highlighter,
    lang: actualLanguage,
    theme: actualTheme
  }

  const tokenizer = new ShikiStreamTokenizer(options)
  tokenizerMap.set(cacheKey, tokenizer)

  return tokenizer
}

// 高亮代码 chunk
async function highlightCodeChunk(
  callerId: string,
  chunk: string,
  language: string,
  theme: string
): Promise<HighlightChunkResult> {
  try {
    // 获取 tokenizer
    const tokenizer = await getStreamTokenizer(callerId, language, theme)

    // 处理代码 chunk
    const result = await tokenizer.enqueue(chunk)

    // 返回结果
    return {
      lines: [...result.stable, ...result.unstable],
      recall: result.recall
    }
  } catch (error) {
    logger.error('Worker failed to highlight code chunk:', error as Error)

    // 提供简单的 fallback
    const fallbackToken: ThemedToken = { content: chunk || '', color: '#000000', offset: 0 }
    return {
      lines: [[fallbackToken]],
      recall: 0
    }
  }
}

// 清理特定调用者的 tokenizer
function cleanupTokenizer(callerId: string): void {
  // 清理所有以callerId开头的缓存
  for (const key of tokenizerMap.keys()) {
    if (key.startsWith(`${callerId}-`)) {
      tokenizerMap.delete(key)
    }
  }
}

// 定义 worker 上下文类型
declare const self: DedicatedWorkerGlobalScope

// 监听消息
self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const { id, type } = e.data

  try {
    switch (type) {
      case 'init':
        if (e.data.languages && e.data.themes) {
          await initHighlighter(e.data.themes, e.data.languages)
          self.postMessage({ id, type: 'init-result', result: { success: true } } as WorkerResponse)
        } else {
          throw new Error('Missing required init parameters')
        }
        break

      case 'highlight':
        if (!highlighter) {
          throw new Error('Highlighter not initialized')
        }

        if (e.data.callerId && e.data.chunk && e.data.language && e.data.theme) {
          const result = await highlightCodeChunk(e.data.callerId, e.data.chunk, e.data.language, e.data.theme)
          self.postMessage({ id, type: 'highlight-result', result } as WorkerResponse)
        } else {
          throw new Error('Missing required highlight parameters')
        }
        break

      case 'highlight-html': {
        if (!highlighter) {
          throw new Error('Highlighter not initialized')
        }

        const { chunk, language, theme } = e.data
        if (typeof chunk !== 'string' || !language || !theme) {
          throw new Error('Missing required highlight-html parameters')
        }

        const { actualLanguage, actualTheme } = await ensureLanguageAndThemeLoaded(language, theme)
        const html = highlighter.codeToHtml(chunk, { lang: actualLanguage, theme: actualTheme })
        self.postMessage({ id, type: 'highlight-html-result', result: html } as WorkerResponse)
        break
      }

      case 'cleanup':
        if (e.data.callerId) {
          cleanupTokenizer(e.data.callerId)
          self.postMessage({ id, type: 'cleanup-result', result: { success: true } } as WorkerResponse)
        } else {
          throw new Error('Missing callerId for cleanup')
        }
        break

      case 'dispose':
        tokenizerMap.clear()
        languageLoadPromises.clear()
        themeLoadPromises.clear()
        highlighter?.dispose()
        highlighter = null
        self.postMessage({ id, type: 'dispose-result', result: { success: true } } as WorkerResponse)
        break

      default:
        throw new Error(`Unknown command: ${type}`)
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    self.postMessage({
      id,
      type: 'error',
      error: errorMessage
    } as WorkerResponse)
  }
}
