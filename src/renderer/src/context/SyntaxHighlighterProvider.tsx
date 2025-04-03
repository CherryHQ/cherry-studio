import { useTheme } from '@renderer/context/ThemeProvider'
import { useMermaid } from '@renderer/hooks/useMermaid'
import { useSettings } from '@renderer/hooks/useSettings'
import { CodeCacheService } from '@renderer/services/CodeCacheService'
import { type CodeStyleVarious, ThemeMode } from '@renderer/types'
import { LRUCache } from 'lru-cache'
import type React from 'react'
import { createContext, type PropsWithChildren, use, useCallback, useMemo } from 'react'
import type { BundledLanguage } from 'shiki'
import { bundledLanguages, bundledThemes, createHighlighter, type Highlighter } from 'shiki'

interface SyntaxHighlighterContextType {
  codeToHtml: (code: string, language: string, enableCache: boolean) => Promise<string>
}

const SyntaxHighlighterContext = createContext<SyntaxHighlighterContextType | undefined>(undefined)

// 全局高亮器缓存 (LRU, 最多2个实例)
const highlighterCache = new LRUCache<string, Promise<Highlighter>>({
  max: 2,
  ttl: 1000 * 60 * 15, // 缓存过期时间（15分钟）
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

  const codeToHtml = useCallback(
    async (_code: string, language: string, enableCache: boolean) => {
      {
        if (!_code) return ''

        const key = CodeCacheService.generateCacheKey(_code, language, highlighterTheme)
        const cached = enableCache ? CodeCacheService.getCachedResult(key) : null
        if (cached) return cached

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

          // 设置缓存
          if (enableCache) {
            CodeCacheService.setCachedResult(key, html, _code.length)
          }

          return html
        } catch (error) {
          console.warn(`Error highlighting code for language '${mappedLanguage}':`, error)
          return `<pre style="padding: 10px"><code>${escapedCode}</code></pre>`
        }
      }
    },
    [highlighterTheme]
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
