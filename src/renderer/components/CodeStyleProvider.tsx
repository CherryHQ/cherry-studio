import type React from 'react'
import { type PropsWithChildren, useCallback, useEffect, useMemo, useState } from 'react'
import type { BundledThemeInfo } from 'shiki/types'

import { type CodeMirrorTheme, getCmThemeByName, getCmThemeNames } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { CodeStyleContext, CodeStyleThemeCatalogContext } from '@renderer/hooks/useCodeStyle'
import { useTheme } from '@renderer/hooks/useTheme'
import { shikiStreamService } from '@renderer/services/ShikiStreamService'
import { getMarkdownIt, getShiki } from '@renderer/utils/shiki'
import { ThemeMode } from '@shared/data/preference/preferenceTypes'

export const CodeStyleProvider: React.FC<PropsWithChildren> = ({ children }) => {
  const [codeEditorEnabled] = usePreference('chat.code.editor.enabled')
  const [codeEditorThemeLight] = usePreference('chat.code.editor.theme_light')
  const [codeEditorThemeDark] = usePreference('chat.code.editor.theme_dark')
  const [codeViewerThemeLight] = usePreference('chat.code.viewer.theme_light')
  const [codeViewerThemeDark] = usePreference('chat.code.viewer.theme_dark')

  const { theme } = useTheme()
  const [shikiThemesInfo, setShikiThemesInfo] = useState<BundledThemeInfo[]>([])
  const [cmThemeNames, setCmThemeNames] = useState<string[]>([])

  const loadShikiThemesInfo = useCallback(async () => {
    const { bundledThemesInfo } = await getShiki()
    setShikiThemesInfo(bundledThemesInfo)
    return bundledThemesInfo
  }, [])

  const loadThemeNames = useCallback(async () => {
    if (codeEditorEnabled) {
      const names = await getCmThemeNames()
      setCmThemeNames(names)
      return names
    }

    const themesInfo = await loadShikiThemesInfo()
    return ['auto', ...themesInfo.map((info) => info.id)]
  }, [codeEditorEnabled, loadShikiThemesInfo])

  // 获取支持的主题名称列表
  const themeNames = useMemo(() => {
    // CodeMirror 主题（异步加载，到位前为空列表）
    if (codeEditorEnabled) {
      return cmThemeNames
    }

    // Shiki 主题，取出所有 BundledThemeInfo 的 id 作为主题名
    return ['auto', ...shikiThemesInfo.map((info) => info.id)]
  }, [codeEditorEnabled, cmThemeNames, shikiThemesInfo])

  const storedShikiTheme = theme === ThemeMode.light ? codeViewerThemeLight : codeViewerThemeDark

  // Consumers like AgentFileDiffRenderer read the theme synchronously and throw on an unknown id
  // without ever asking for the catalog, so a stored id has to be validated before it is handed out.
  useEffect(() => {
    if (storedShikiTheme && storedShikiTheme !== 'auto') void loadShikiThemesInfo()
  }, [storedShikiTheme, loadShikiThemesInfo])

  // 获取当前使用的 Shiki 主题名称（只用于代码预览）
  const activeShikiTheme = useMemo(() => {
    const fallback = theme === ThemeMode.light ? 'one-light' : 'material-theme-darker'
    if (!storedShikiTheme || storedShikiTheme === 'auto') return fallback
    return shikiThemesInfo.some((info) => info.id === storedShikiTheme) ? storedShikiTheme : fallback
  }, [theme, storedShikiTheme, shikiThemesInfo])

  const isShikiThemeDark = useMemo(() => {
    const themeInfo = shikiThemesInfo.find((info) => info.id === activeShikiTheme)
    return themeInfo ? themeInfo.type === 'dark' : theme !== ThemeMode.light
  }, [activeShikiTheme, shikiThemesInfo, theme])

  // 获取当前使用的 CodeMirror 主题对象（只用于编辑器；异步解析，到位前用基础明暗主题）
  const [activeCmTheme, setActiveCmTheme] = useState<CodeMirrorTheme>(() =>
    theme === ThemeMode.light ? 'light' : 'dark'
  )

  useEffect(() => {
    // Every CodeMirror consumer (Notes, MCP editors, ArtifactPane, previews) reads this, so it must
    // not depend on the chat-editor flag. getCmThemeByName already falls back for unknown names.
    const codeStyle = theme === ThemeMode.light ? codeEditorThemeLight : codeEditorThemeDark
    let themeName = codeStyle
    if (!themeName || themeName === 'auto') {
      themeName = theme === ThemeMode.light ? 'materialLight' : 'dark'
    }

    let cancelled = false
    void getCmThemeByName(themeName).then((cmTheme) => {
      if (!cancelled) {
        setActiveCmTheme(cmTheme)
      }
    })
    return () => {
      cancelled = true
    }
  }, [theme, codeEditorThemeLight, codeEditorThemeDark])

  // 自定义 shiki 语言别名
  const languageAliases = useMemo(() => {
    return {
      bash: 'shell',
      'objective-c++': 'objective-cpp',
      svg: 'xml',
      vab: 'vb',
      graphviz: 'dot'
    }
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
      await loadShikiThemesInfo()
      const normalizedLang = languageAliases[language] || language.toLowerCase()
      return shikiStreamService.highlightCodeChunk(trunk, normalizedLang, activeShikiTheme, callerId)
    },
    [activeShikiTheme, languageAliases, loadShikiThemesInfo]
  )

  // 清理代码高亮资源
  const cleanupTokenizers = useCallback((callerId: string) => {
    shikiStreamService.cleanupTokenizers(callerId)
  }, [])

  // 高亮流式输出的代码
  const highlightStreamingCode = useCallback(
    async (fullContent: string, language: string, callerId: string) => {
      await loadShikiThemesInfo()
      const normalizedLang = languageAliases[language] || language.toLowerCase()
      return shikiStreamService.highlightStreamingCode(fullContent, normalizedLang, activeShikiTheme, callerId)
    },
    [activeShikiTheme, languageAliases, loadShikiThemesInfo]
  )

  // 获取 Shiki pre 标签属性
  const getShikiPreProperties = useCallback(
    async (language: string) => {
      await loadShikiThemesInfo()
      const normalizedLang = languageAliases[language] || language.toLowerCase()
      return shikiStreamService.getShikiPreProperties(normalizedLang, activeShikiTheme)
    },
    [activeShikiTheme, languageAliases, loadShikiThemesInfo]
  )

  // Static one-shot highlight; routed through the worker to keep the main thread free
  const highlightCode = useCallback(
    async (code: string, language: string) => {
      await loadShikiThemesInfo()
      const normalizedLang = languageAliases[language] || language.toLowerCase()
      return shikiStreamService.highlightCodeToHtml(code, normalizedLang, activeShikiTheme)
    },
    [activeShikiTheme, languageAliases, loadShikiThemesInfo]
  )

  // 使用 Shiki 和 Markdown-it 渲染代码
  const shikiMarkdownIt = useCallback(
    async (code: string) => {
      await loadShikiThemesInfo()
      const renderer = await getMarkdownIt(activeShikiTheme, code)
      if (!renderer) {
        return code
      }
      return renderer.render(code)
    },
    [activeShikiTheme, loadShikiThemesInfo]
  )

  const contextValue = useMemo(
    () => ({
      highlightCodeChunk,
      highlightStreamingCode,
      cleanupTokenizers,
      getShikiPreProperties,
      highlightCode,
      shikiMarkdownIt,
      activeShikiTheme,
      isShikiThemeDark,
      activeCmTheme
    }),
    [
      highlightCodeChunk,
      highlightStreamingCode,
      cleanupTokenizers,
      getShikiPreProperties,
      highlightCode,
      shikiMarkdownIt,
      activeShikiTheme,
      isShikiThemeDark,
      activeCmTheme
    ]
  )

  const themeCatalogContextValue = useMemo(
    () => ({
      loadThemeNames,
      themeNames
    }),
    [loadThemeNames, themeNames]
  )

  return (
    <CodeStyleContext value={contextValue}>
      <CodeStyleThemeCatalogContext value={themeCatalogContextValue}>{children}</CodeStyleThemeCatalogContext>
    </CodeStyleContext>
  )
}
