import type { PropsWithChildren } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { getCmThemeByName, getCmThemeNames, type CodeMirrorTheme } from '@cherrystudio/ui'
import { codeBlockSyntaxCss, getCodeBlockPalette } from '@cherrystudio/ui/code-block'
import { resolveCodeTheme } from '@cherrystudio/ui/code-highlight'
import { usePreference } from '@data/hooks/usePreference'
import { CodeStyleContext, CodeStyleThemeCatalogContext } from '@renderer/hooks/useCodeStyle'
import { useTheme } from '@renderer/hooks/useTheme'
import { codeHighlightService } from '@renderer/services/CodeHighlightService'
import type { HighlightRange } from '@renderer/types/codeHighlight'
import { CODE_THEME_NAMES, loadCodeTheme } from '@renderer/utils/codeHighlight'
import { ThemeMode } from '@shared/data/preference/preferenceTypes'

export function CodeStyleProvider({ children }: PropsWithChildren) {
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
  const [themeAppearance, setThemeAppearance] = useState<{
    name: string
    dark: boolean
    palette: Record<string, string>
  } | null>(null)
  const isCodeThemeDark = themeAppearance?.name === activeCodeTheme ? themeAppearance.dark : theme !== ThemeMode.light

  useEffect(() => {
    let cancelled = false
    void loadCodeTheme(activeCodeTheme).then((resolved) => {
      if (!cancelled)
        setThemeAppearance({
          name: activeCodeTheme,
          dark: resolved.appearance === 'dark',
          palette: getCodeBlockPalette(resolved)
        })
    })
    return () => {
      cancelled = true
    }
  }, [activeCodeTheme])

  const themeNames = useMemo(() => ['auto', ...CODE_THEME_NAMES], [])
  const loadThemeNames = useCallback(async () => themeNames, [themeNames])
  const loadCmThemeNames = useCallback(async () => {
    const names = await getCmThemeNames()
    setCmThemeNames(names)
    return names
  }, [])

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
    // Remaining CodeMirror consumers also include Notes and configuration editors.
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
  const codeBlockStyle = themeAppearance?.name === activeCodeTheme ? themeAppearance.palette : undefined
  const contextValue = useMemo(
    () => ({
      codeBlockStyle,
      highlightRange,
      cleanupTokenizers,
      highlightCode,
      renderMarkdown,
      codeThemes,
      activeCodeTheme,
      isCodeThemeDark,
      activeCmTheme,
      requestCmTheme
    }),
    [
      codeBlockStyle,
      highlightRange,
      cleanupTokenizers,
      highlightCode,
      renderMarkdown,
      codeThemes,
      activeCodeTheme,
      isCodeThemeDark,
      activeCmTheme,
      requestCmTheme
    ]
  )
  const themeCatalogContextValue = useMemo(
    () => ({ loadThemeNames, themeNames, loadCmThemeNames, cmThemeNames }),
    [loadThemeNames, themeNames, loadCmThemeNames, cmThemeNames]
  )
  return (
    <CodeStyleContext value={contextValue}>
      <CodeStyleThemeCatalogContext value={themeCatalogContextValue}>
        <style>{codeBlockSyntaxCss}</style>
        {children}
      </CodeStyleThemeCatalogContext>
    </CodeStyleContext>
  )
}
