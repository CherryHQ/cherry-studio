import type { PropsWithChildren } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'

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
  const [codeViewerThemeLight] = usePreference('chat.code.viewer.theme_light')
  const [codeViewerThemeDark] = usePreference('chat.code.viewer.theme_dark')
  const { theme } = useTheme()
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
      isCodeThemeDark
    }),
    [
      codeBlockStyle,
      highlightRange,
      cleanupTokenizers,
      highlightCode,
      renderMarkdown,
      codeThemes,
      activeCodeTheme,
      isCodeThemeDark
    ]
  )
  const themeCatalogContextValue = useMemo(() => ({ loadThemeNames, themeNames }), [loadThemeNames, themeNames])
  return (
    <CodeStyleContext value={contextValue}>
      <CodeStyleThemeCatalogContext value={themeCatalogContextValue}>
        <style>{codeBlockSyntaxCss}</style>
        {children}
      </CodeStyleThemeCatalogContext>
    </CodeStyleContext>
  )
}
