import type { PropsWithChildren } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { getCherryCmTheme, getCmThemeByName, getCmThemeNames, type CodeMirrorTheme } from '@cherrystudio/ui'
import { codeBlockSyntaxCss, getCodeBlockPalette } from '@cherrystudio/ui/code-block'
import { CHERRY_CODE_THEME, resolveCodeTheme } from '@cherrystudio/ui/code-highlight'
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
  const codeThemes = useMemo<[string, string]>(
    () => [
      resolveCodeTheme(codeViewerThemeLight, CHERRY_CODE_THEME),
      resolveCodeTheme(codeViewerThemeDark, CHERRY_CODE_THEME)
    ],
    [codeViewerThemeLight, codeViewerThemeDark]
  )
  const activeCodeTheme = theme === ThemeMode.light ? codeThemes[0] : codeThemes[1]
  const [themeAppearance, setThemeAppearance] = useState<{
    name: string
    dark: boolean
    palette: Record<string, string>
  } | null>(null)
  // The Cherry palette follows the application mode instead of a fixed theme appearance.
  const isCodeThemeDark =
    activeCodeTheme !== CHERRY_CODE_THEME && themeAppearance?.name === activeCodeTheme
      ? themeAppearance.dark
      : theme !== ThemeMode.light

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

  const [activeCmTheme, setActiveCmTheme] = useState<CodeMirrorTheme>(() =>
    theme === ThemeMode.light ? 'light' : 'dark'
  )
  const [cmThemeRequested, setCmThemeRequested] = useState(false)
  const requestCmTheme = useCallback(() => setCmThemeRequested(true), [])
  useEffect(() => {
    if (!cmThemeRequested) return
    const selected = theme === ThemeMode.light ? codeEditorThemeLight : codeEditorThemeDark
    let cancelled = false
    const loading =
      !selected || selected === 'auto' ? getCherryCmTheme(theme !== ThemeMode.light) : getCmThemeByName(selected)
    void loading.then((resolved) => {
      if (!cancelled) setActiveCmTheme(resolved)
    })
    return () => {
      cancelled = true
    }
  }, [cmThemeRequested, theme, codeEditorThemeLight, codeEditorThemeDark])

  const [cmThemeNames, setCmThemeNames] = useState<string[]>([])
  const loadCmThemeNames = useCallback(async () => {
    const names = await getCmThemeNames()
    setCmThemeNames(names)
    return names
  }, [])

  const themeNames = useMemo(() => ['auto', ...CODE_THEME_NAMES], [])
  const loadThemeNames = useCallback(async () => themeNames, [themeNames])
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
