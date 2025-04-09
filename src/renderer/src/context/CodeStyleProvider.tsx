import { useMermaid } from '@renderer/hooks/useMermaid'
import { useSettings } from '@renderer/hooks/useSettings'
import { CodeCacheService } from '@renderer/services/CodeCacheService'
import { ThemeMode } from '@renderer/types'
import * as cmThemes from '@uiw/codemirror-themes-all'
import type React from 'react'
import { createContext, type PropsWithChildren, use, useCallback, useMemo } from 'react'
import { bundledLanguages, bundledThemes, createHighlighter, type Highlighter } from 'shiki'

let highlighterPromise: Promise<Highlighter> | null = null

async function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      langs: ['javascript', 'typescript', 'python', 'java', 'markdown'],
      themes: ['one-light', 'material-theme-darker']
    })
  }

  return await highlighterPromise
}

interface CodeStyleContextType {
  codeToHtml: (code: string, language: string, enableCache: boolean) => Promise<string>
  themeNames: string[]
  currentTheme: string
}

const CodeStyleContext = createContext<CodeStyleContextType | undefined>(undefined)

export const CodeStyleProvider: React.FC<PropsWithChildren> = ({ children }) => {
  const { codeEditor, codeStyle, theme } = useSettings()
  useMermaid()

  // 获取支持的主题名称列表
  const themeNames = useMemo(() => {
    // CodeMirror 主题
    // 更保险的做法可能是硬编码主题列表
    if (codeEditor.enabled) {
      return ['auto', 'light', 'dark']
        .concat(Object.keys(cmThemes))
        .filter((item) => typeof cmThemes[item as keyof typeof cmThemes] !== 'function')
        .filter((item) => !/^(defaultSettings)/.test(item as string) && !/(Style)$/.test(item as string))
    }

    // Shiki 主题
    return ['auto', ...Object.keys(bundledThemes)]
  }, [codeEditor.enabled])

  // 获取当前使用的主题名称
  const currentTheme = useMemo(() => {
    if (!codeStyle || codeStyle === 'auto' || !themeNames.includes(codeStyle)) {
      if (codeEditor.enabled) {
        return theme === ThemeMode.light ? 'materialLight' : 'materialDark'
      } else {
        return theme === ThemeMode.light ? 'one-light' : 'material-theme-darker'
      }
    }
    return codeStyle
  }, [codeEditor.enabled, codeStyle, themeNames, theme])

  const codeToHtml = useCallback(
    async (_code: string, language: string, enableCache: boolean) => {
      {
        if (!_code) return ''

        const key = CodeCacheService.generateCacheKey(_code, language, currentTheme)
        const cached = enableCache ? CodeCacheService.getCachedResult(key) : null
        if (cached) return cached

        const languageMap: Record<string, string> = {
          vab: 'vb',
          svg: 'xml'
        }

        const mappedLanguage = languageMap[language] || language

        const code = _code?.trimEnd() ?? ''
        const escapedCode = code?.replace(/[<>]/g, (char) => ({ '<': '&lt;', '>': '&gt;' })[char]!)

        try {
          const highlighter = await getHighlighter()

          if (!highlighter.getLoadedThemes().includes(currentTheme)) {
            const themeImportFn = bundledThemes[currentTheme]
            if (themeImportFn) {
              await highlighter.loadTheme(await themeImportFn())
            }
          }

          if (!highlighter.getLoadedLanguages().includes(mappedLanguage)) {
            const languageImportFn = bundledLanguages[mappedLanguage]
            if (languageImportFn) {
              await highlighter.loadLanguage(await languageImportFn())
            }
          }

          // 生成高亮HTML
          const html = highlighter.codeToHtml(code, {
            lang: mappedLanguage,
            theme: currentTheme
          })

          // 设置缓存
          if (enableCache) {
            CodeCacheService.setCachedResult(key, html, _code.length)
          }

          return html
        } catch (error) {
          console.debug(`Error highlighting code for language '${mappedLanguage}':`, error)
          return `<pre style="padding: 10px"><code>${escapedCode}</code></pre>`
        }
      }
    },
    [currentTheme]
  )

  const contextValue = useMemo(
    () => ({
      codeToHtml,
      themeNames,
      currentTheme
    }),
    [codeToHtml, themeNames, currentTheme]
  )

  return <CodeStyleContext value={contextValue}>{children}</CodeStyleContext>
}

export const useCodeStyle = () => {
  const context = use(CodeStyleContext)
  if (!context) {
    throw new Error('useCodeStyle must be used within a CodeStyleProvider')
  }
  return context
}
