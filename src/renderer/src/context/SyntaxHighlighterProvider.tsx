import { useTheme } from '@renderer/context/ThemeProvider'
import { useMermaid } from '@renderer/hooks/useMermaid'
import { useSettings } from '@renderer/hooks/useSettings'
import { type CodeStyleVarious, ThemeMode } from '@renderer/types'
import { LRUCache } from 'lru-cache'
import type React from 'react'
import { createContext, type PropsWithChildren, use, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { BundledLanguage, BundledTheme, HighlighterGeneric } from 'shiki'
import { bundledLanguages, bundledThemes, createHighlighter } from 'shiki'

interface SyntaxHighlighterContextType {
  codeToHtml: (code: string, language: string) => Promise<string>
}

const SyntaxHighlighterContext = createContext<SyntaxHighlighterContextType | undefined>(undefined)

export const SyntaxHighlighterProvider: React.FC<PropsWithChildren> = ({ children }) => {
  const { theme } = useTheme()
  const [highlighter, setHighlighter] = useState<HighlighterGeneric<BundledLanguage, BundledTheme> | null>(null)
  const { codeStyle } = useSettings()
  useMermaid()

  const highlighterTheme = useMemo(() => {
    if (!codeStyle || codeStyle === 'auto') {
      return theme === ThemeMode.light ? 'one-light' : 'material-theme-darker'
    }

    return codeStyle
  }, [theme, codeStyle])

  useEffect(() => {
    const initHighlighter = async () => {
      const commonLanguages = ['javascript', 'typescript', 'python', 'java', 'markdown']

      const hl = await createHighlighter({
        themes: [highlighterTheme],
        langs: commonLanguages
      })

      setHighlighter(hl)

      // Load all themes and languages
      // hl.loadTheme(...(Object.keys(bundledThemes) as BundledTheme[]))
      // hl.loadLanguage(...(Object.keys(bundledLanguages) as BundledLanguage[]))
    }

    initHighlighter()
  }, [highlighterTheme])

  const highlightCache = useRef(
    new LRUCache<string, string>({
      max: 100, // 最大缓存条目数
      maxSize: 10 * 1024 * 1024, // 最大缓存大小（10MB）
      sizeCalculation: (value) => value.length,
      ttl: 1000 * 60 * 30 // 缓存过期时间（30分钟）
    })
  )

  const getCacheKey = useCallback((code: string, language: string, theme: string) => {
    return `${language}|${theme}|${code.length}|${hashCode(code)}`
  }, [])

  const hashCode = (str: string) => {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i)
      hash |= 0
    }
    return hash
  }

  const codeToHtml = useCallback(
    async (_code: string, language: string) => {
      {
        if (!highlighter) return ''

        const key = getCacheKey(_code, language, highlighterTheme)
        const cached = highlightCache.current.get(key)
        if (cached) return cached

        const languageMap: Record<string, string> = {
          vab: 'vb'
        }

        const mappedLanguage = languageMap[language] || language

        const code = _code?.trimEnd() ?? ''
        const escapedCode = code?.replace(/[<>]/g, (char) => ({ '<': '&lt;', '>': '&gt;' })[char]!)

        try {
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
          highlightCache.current.set(key, html)
          return html
        } catch (error) {
          console.warn(`Error highlighting code for language '${mappedLanguage}':`, error)
          return `<pre style="padding: 10px"><code>${escapedCode}</code></pre>`
        }
      }
    },
    [getCacheKey, highlighter, highlighterTheme]
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
