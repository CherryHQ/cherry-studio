import { useTheme } from '@renderer/context/ThemeProvider'
import { useMermaid } from '@renderer/hooks/useMermaid'
import { useSettings } from '@renderer/hooks/useSettings'
import { HighlightChunkResult, ShikiPreProperties, shikiStreamService } from '@renderer/services/ShikiStreamService'
import { ThemeMode } from '@renderer/types'
import { getHighlighter, getMarkdownIt, getShiki, loadLanguageIfNeeded, loadThemeIfNeeded } from '@renderer/utils/shiki'
import * as cmThemes from '@uiw/codemirror-themes-all'
import type React from 'react'
import { createContext, type PropsWithChildren, use, useCallback, useEffect, useMemo, useState } from 'react'
import type { BundledThemeInfo } from 'shiki/types'

interface CodeStyleContextType {
  highlightCodeChunk: (trunk: string, language: string, callerId: string) => Promise<HighlightChunkResult>
  highlightStreamingCode: (code: string, language: string, callerId: string) => Promise<HighlightChunkResult>
  cleanupTokenizers: (callerId: string) => void
  getShikiPreProperties: (language: string) => Promise<ShikiPreProperties>
  highlightCode: (code: string, language: string) => Promise<string>
  shikiMarkdownIt: (code: string) => Promise<string>
  themeNames: string[]
  activeShikiTheme: string
  isShikiThemeDark: boolean
  activeCmTheme: any
  languageMap: Record<string, string>
}

const defaultCodeStyleContext: CodeStyleContextType = {
  highlightCodeChunk: async () => ({ lines: [], recall: 0 }),
  highlightStreamingCode: async () => ({ lines: [], recall: 0 }),
  cleanupTokenizers: () => {},
  getShikiPreProperties: async () => ({ class: '', style: '', tabindex: 0 }),
  highlightCode: async () => '',
  shikiMarkdownIt: async () => '',
  themeNames: ['auto'],
  activeShikiTheme: 'auto',
  isShikiThemeDark: false,
  activeCmTheme: null,
  languageMap: {}
}

const CodeStyleContext = createContext<CodeStyleContextType>(defaultCodeStyleContext)

export const CodeStyleProvider: React.FC<PropsWithChildren> = ({ children }) => {
  const { codeEditor, codePreview } = useSettings()
  const { theme } = useTheme()
  const [shikiThemesInfo, setShikiThemesInfo] = useState<BundledThemeInfo[]>([])
  useMermaid()

  useEffect(() => {
    if (!codeEditor.enabled) {
      getShiki().then(({ bundledThemesInfo }) => {
        setShikiThemesInfo(bundledThemesInfo)
      })
    }
  }, [codeEditor.enabled])

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

    // Shiki 主题，取出所有 BundledThemeInfo 的 id 作为主题名
    return ['auto', ...shikiThemesInfo.map((info) => info.id)]
  }, [codeEditor.enabled, shikiThemesInfo])

  // 获取当前使用的 Shiki 主题名称（只用于代码预览）
  const activeShikiTheme = useMemo(() => {
    const field = theme === ThemeMode.light ? 'themeLight' : 'themeDark'
    const codeStyle = codePreview[field]
    if (!codeStyle || codeStyle === 'auto' || !themeNames.includes(codeStyle)) {
      return theme === ThemeMode.light ? 'one-light' : 'material-theme-darker'
    }
    return codeStyle
  }, [theme, codePreview, themeNames])

  const isShikiThemeDark = useMemo(() => {
    const themeInfo = shikiThemesInfo.find((info) => info.id === activeShikiTheme)
    return themeInfo?.type === 'dark'
  }, [activeShikiTheme, shikiThemesInfo])

  // 获取当前使用的 CodeMirror 主题对象（只用于编辑器）
  const activeCmTheme = useMemo(() => {
    const field = theme === ThemeMode.light ? 'themeLight' : 'themeDark'
    let themeName = codeEditor[field]
    if (!themeName || themeName === 'auto' || !themeNames.includes(themeName)) {
      themeName = theme === ThemeMode.light ? 'materialLight' : 'dark'
    }
    return cmThemes[themeName as keyof typeof cmThemes] || themeName
  }, [theme, codeEditor, themeNames])

  // 一些语言的别名
  const languageMap = useMemo(() => {
    return {
      bash: 'shell',
      'objective-c++': 'objective-cpp',
      svg: 'xml',
      vab: 'vb'
    } as Record<string, string>
  }, [])

  useEffect(() => {
    // 在组件卸载时清理 Worker
    return () => {
      shikiStreamService.dispose()
    }
  }, [])

  // 流式代码高亮，返回已高亮的 token lines
  const highlightCodeChunk = useCallback(
    async (trunk: string, language: string, callerId: string) => {
      const normalizedLang = languageMap[language as keyof typeof languageMap] || language.toLowerCase()
      return shikiStreamService.highlightCodeChunk(trunk, normalizedLang, activeShikiTheme, callerId)
    },
    [activeShikiTheme, languageMap]
  )

  // 清理代码高亮资源
  const cleanupTokenizers = useCallback((callerId: string) => {
    shikiStreamService.cleanupTokenizers(callerId)
  }, [])

  // 高亮流式输出的代码
  const highlightStreamingCode = useCallback(
    async (fullContent: string, language: string, callerId: string) => {
      const normalizedLang = languageMap[language as keyof typeof languageMap] || language.toLowerCase()
      return shikiStreamService.highlightStreamingCode(fullContent, normalizedLang, activeShikiTheme, callerId)
    },
    [activeShikiTheme, languageMap]
  )

  // 获取 Shiki pre 标签属性
  const getShikiPreProperties = useCallback(
    async (language: string) => {
      const normalizedLang = languageMap[language as keyof typeof languageMap] || language.toLowerCase()
      return shikiStreamService.getShikiPreProperties(normalizedLang, activeShikiTheme)
    },
    [activeShikiTheme, languageMap]
  )

  const highlightCode = useCallback(
    async (code: string, language: string) => {
      const highlighter = await getHighlighter()
      await loadLanguageIfNeeded(highlighter, language)
      await loadThemeIfNeeded(highlighter, activeShikiTheme)
      return highlighter.codeToHtml(code, { lang: language, theme: activeShikiTheme })
    },
    [activeShikiTheme]
  )

  // 使用 Shiki 和 Markdown-it 渲染代码
  const shikiMarkdownIt = useCallback(
    async (code: string) => {
      const renderer = await getMarkdownIt(activeShikiTheme, code)
      if (!renderer) {
        return code
      }
      return renderer.render(code)
    },
    [activeShikiTheme]
  )

  const contextValue = useMemo(
    () => ({
      highlightCodeChunk,
      highlightStreamingCode,
      cleanupTokenizers,
      getShikiPreProperties,
      highlightCode,
      shikiMarkdownIt,
      themeNames,
      activeShikiTheme,
      isShikiThemeDark,
      activeCmTheme,
      languageMap
    }),
    [
      highlightCodeChunk,
      highlightStreamingCode,
      cleanupTokenizers,
      getShikiPreProperties,
      highlightCode,
      shikiMarkdownIt,
      themeNames,
      activeShikiTheme,
      isShikiThemeDark,
      activeCmTheme,
      languageMap
    ]
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
