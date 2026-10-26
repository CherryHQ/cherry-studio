import type { PropsWithChildren } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { getCmThemeByName, getCmThemeNames, type CodeMirrorTheme } from '@cherrystudio/ui'
import { resolveCodeTheme } from '@cherrystudio/ui/code-highlight'
import { usePreference } from '@data/hooks/usePreference'
import { CodeStyleContext, CodeStyleThemeCatalogContext } from '@renderer/hooks/useCodeStyle'
import { useTheme } from '@renderer/hooks/useTheme'
import { codeHighlightService } from '@renderer/services/CodeHighlightService'
import type { HighlightRange } from '@renderer/types/codeHighlight'
import { CODE_THEME_NAMES, loadCodeTheme } from '@renderer/utils/codeHighlight'
import { ThemeMode } from '@shared/data/preference/preferenceTypes'

export function CodeStyleProvider({ children }: PropsWithChildren) {
  const [codeEditorEnabled] = usePreference('chat.code.editor.enabled')
  const [codeEditorThemeLight] = usePreference('chat.code.editor.theme_light')
  const [codeEditorThemeDark] = usePreference('chat.code.editor.theme_dark')
  const [codeViewerThemeLight] = usePreference('chat.code.viewer.theme_light')
  const [codeViewerThemeDark] = usePreference('chat.code.viewer.theme_dark')
  const { theme } = useTheme()
  const [cmThemeNames, setCmThemeNames] = useState<string[]>([])
  const codeThemes = useMemo<[string, string]>(
    () => [
      resolveCodeTheme(codeViewerThemeLight, 'one-light'),
      resolveCodeTheme(codeViewerThemeDark, 'material-theme-darker')
    ],
    [codeViewerThemeLight, codeViewerThemeDark]
  )
  const activeCodeTheme = theme === ThemeMode.light ? codeThemes[0] : codeThemes[1]
  const [themeAppearance, setThemeAppearance] = useState<{ name: string; dark: boolean } | null>(null)
  const isCodeThemeDark = themeAppearance?.name === activeCodeTheme ? themeAppearance.dark : theme !== ThemeMode.light

  useEffect(() => {
    let cancelled = false
    void loadCodeTheme(activeCodeTheme).then((resolved) => {
      if (!cancelled) setThemeAppearance({ name: activeCodeTheme, dark: resolved.appearance === 'dark' })
    })
    return () => {
      cancelled = true
    }
  }, [activeCodeTheme])

  const themeNames = useMemo(
    () => (codeEditorEnabled ? cmThemeNames : ['auto', ...CODE_THEME_NAMES]),
    [codeEditorEnabled, cmThemeNames]
  )
  const loadThemeNames = useCallback(async () => {
    if (!codeEditorEnabled) return ['auto', ...CODE_THEME_NAMES]
    const names = await getCmThemeNames()
    setCmThemeNames(names)
    return names
  }, [codeEditorEnabled])

  // 获取当前使用的 CodeMirror 主题对象（只用于编辑器；异步解析，到位前用基础明暗主题）
  const [activeCmTheme, setActiveCmTheme] = useState<CodeMirrorTheme>(() =>
    theme === ThemeMode.light ? 'light' : 'dark'
  )

  // The themes-all catalog is only resolved after an editor boundary demands a theme, so
  // windows that never render a CodeMirror editor never load it.
  const [cmThemeRequested, setCmThemeRequested] = useState(false)
  const requestCmTheme = useCallback(() => setCmThemeRequested(true), [])

  useEffect(() => {
    if (!cmThemeRequested) return
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
  }, [cmThemeRequested, theme, codeEditorThemeLight, codeEditorThemeDark])

  const highlightRange = useCallback(
    (code: string, language: string, callerId: string, range: HighlightRange) =>
      codeHighlightService.highlightRange(code, language, activeCodeTheme, callerId, range),
    [activeCodeTheme]
  )
  const cleanupTokenizers = useCallback((callerId: string) => codeHighlightService.cleanupTokenizers(callerId), [])
  const highlightCode = useCallback(
    (code: string, language: string) => codeHighlightService.highlightCodeToHtml(code, language, activeCodeTheme),
    [activeCodeTheme]
  )
  const renderMarkdown = useCallback(
    (code: string) => codeHighlightService.renderMarkdown(code, activeCodeTheme),
    [activeCodeTheme]
  )
  const getCodePreProperties = useCallback(async () => {
    const resolved = await loadCodeTheme(activeCodeTheme)
    const { style } = resolved
    const foreground = style['editor.foreground'] ?? style.text ?? style.foreground ?? 'var(--foreground)'
    const background = style['editor.background'] ?? style.background ?? 'var(--background)'
    return { class: 'shiki highlights', style: `color:${foreground};background-color:${background}` }
  }, [activeCodeTheme])
  const contextValue = useMemo(
    () => ({
      highlightRange,
      cleanupTokenizers,
      getCodePreProperties,
      highlightCode,
      renderMarkdown,
      codeThemes,
      activeCodeTheme,
      isCodeThemeDark,
      activeCmTheme,
      requestCmTheme
    }),
    [
      highlightRange,
      cleanupTokenizers,
      getCodePreProperties,
      highlightCode,
      renderMarkdown,
      codeThemes,
      activeCodeTheme,
      isCodeThemeDark,
      activeCmTheme,
      requestCmTheme
    ]
  )
  const themeCatalogContextValue = useMemo(() => ({ loadThemeNames, themeNames }), [loadThemeNames, themeNames])
  return (
    <CodeStyleContext value={contextValue}>
      <CodeStyleThemeCatalogContext value={themeCatalogContextValue}>{children}</CodeStyleThemeCatalogContext>
    </CodeStyleContext>
  )
}
