import { useTheme } from '@renderer/context/ThemeProvider'
import { useMermaid } from '@renderer/hooks/useMermaid'
import { useSettings } from '@renderer/hooks/useSettings'
import { type CodeStyleVarious, ThemeMode } from '@renderer/types'
import { LRUCache } from 'lru-cache'
import type React from 'react'
import { createContext, type PropsWithChildren, use, useCallback, useMemo, useRef } from 'react'
import type { BundledLanguage } from 'shiki'
import { bundledLanguages, bundledThemes, createHighlighter, type Highlighter } from 'shiki'

interface SyntaxHighlighterContextType {
  codeToHtml: (code: string, language: string, enableCache: boolean) => Promise<string>
}

const SyntaxHighlighterContext = createContext<SyntaxHighlighterContextType | undefined>(undefined)

// 全局高亮器缓存 (LRU, 最多2个实例)
const highlighterCache = new LRUCache<string, Promise<Highlighter>>({
  max: 2,
  ttl: 1000 * 60 * 10, // 缓存过期时间（10分钟）
  dispose: async (hlPromise) => (await hlPromise)?.dispose()
})

// 创建高亮器
async function getHighlighter(theme: string) {
  const commonLanguages = ['javascript', 'typescript', 'python', 'java', 'markdown']

  const hlCached = highlighterCache.get(theme)
  if (hlCached) return await hlCached

  const hlPromise = createHighlighter({
    themes: [theme],
    langs: commonLanguages
  })

  highlighterCache.set(theme, hlPromise)
  return await hlPromise
}

// 增强的hash
const enhancedHash = (input: string) => {
  const THRESHOLD = 50000

  if (input.length <= THRESHOLD) {
    return fastHash(input)
  }

  const mid = Math.floor(input.length / 2)

  // 三段hash保证唯一性
  const frontSection = input.slice(0, 10000)
  const midSection = input.slice(mid - 15000, mid + 15000)
  const endSection = input.slice(-10000)

  return `${fastHash(frontSection)}-${fastHash(midSection)}-${fastHash(endSection)}`
}

// FNV-1a hash
const fastHash = (input: string, maxInputLength: number = 50000) => {
  let hash = 2166136261 // FNV偏移基数
  const count = Math.min(input.length, maxInputLength)
  for (let i = 0; i < count; i++) {
    hash ^= input.charCodeAt(i)
    hash *= 16777619 // FNV素数
    hash >>>= 0 // 保持为32位无符号整数
  }
  return hash.toString(36)
}

export const SyntaxHighlighterProvider: React.FC<PropsWithChildren> = ({ children }) => {
  const { theme } = useTheme()
  const { codeStyle } = useSettings()
  useMermaid()

  const highlighterTheme = useMemo(() => {
    if (!codeStyle || codeStyle === 'auto') {
      return theme === ThemeMode.light ? 'one-light' : 'material-theme-darker'
    }

    return codeStyle
  }, [theme, codeStyle])

  // 高亮结果缓存
  const highlightCache = useRef(
    new LRUCache<string, string>({
      max: 200, // 最大缓存条目数
      maxSize: 2 * 10 ** 6, // 最大缓存大小（字符数）
      sizeCalculation: (value) => value.length, // 缓存大小计算（字符数）
      ttl: 1000 * 60 * 10 // 缓存过期时间（10分钟）
    })
  )

  const getCacheKey = useCallback((code: string, language: string, theme: string) => {
    return `${language}|${theme}|${code.length}|${enhancedHash(code)}`
  }, [])

  const codeToHtml = useCallback(
    async (_code: string, language: string, enableCache: boolean) => {
      {
        if (!_code) return ''

        const key = getCacheKey(_code, language, highlighterTheme)
        const cached = highlightCache.current.get(key)
        if (enableCache && cached) return cached

        const languageMap: Record<string, string> = {
          vab: 'vb'
        }

        const mappedLanguage = languageMap[language] || language

        const code = _code?.trimEnd() ?? ''
        const escapedCode = code?.replace(/[<>]/g, (char) => ({ '<': '&lt;', '>': '&gt;' })[char]!)

        try {
          const highlighter = await getHighlighter(highlighterTheme)

          if (!highlighter.getLoadedLanguages().includes(mappedLanguage as BundledLanguage)) {
            if (mappedLanguage in bundledLanguages || mappedLanguage === 'text') {
              await highlighter.loadLanguage(mappedLanguage as BundledLanguage)
            } else {
              return `<pre style="padding: 10px"><code>${escapedCode}</code></pre>`
            }
          }

          const html = highlighter.codeToHtml(code, {
            lang: mappedLanguage,
            theme: highlighterTheme
          })

          // 缓存大于2000字符的代码
          if (enableCache && _code.length > 2000) {
            highlightCache.current.set(key, html)
          }

          return html
        } catch (error) {
          console.warn(`Error highlighting code for language '${mappedLanguage}':`, error)
          return `<pre style="padding: 10px"><code>${escapedCode}</code></pre>`
        }
      }
    },
    [getCacheKey, highlighterTheme]
  )

  return <SyntaxHighlighterContext value={{ codeToHtml }}>{children}</SyntaxHighlighterContext>
}

export const useSyntaxHighlighter = () => {
  const context = use(SyntaxHighlighterContext)
  if (!context) {
    throw new Error('useSyntaxHighlighter must be used within a SyntaxHighlighterProvider')
  }
  return context
}

export const codeThemes = ['auto', ...Object.keys(bundledThemes)] as CodeStyleVarious[]
