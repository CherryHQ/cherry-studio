import { createContext, use, useEffect } from 'react'

import type { CodeMirrorTheme } from '@cherrystudio/ui'
import type { HighlightRange, HighlightResult } from '@renderer/types/codeHighlight'

interface CodeStyleContextType {
  highlightRange: (code: string, language: string, callerId: string, range: HighlightRange) => Promise<HighlightResult>
  cleanupTokenizers: (callerId: string) => void
  getCodePreProperties: () => Promise<{ class: string; style: string }>
  highlightCode: (code: string, language: string) => Promise<string>
  renderMarkdown: (code: string) => Promise<string>
  codeThemes: [string, string]
  activeCodeTheme: string
  isCodeThemeDark: boolean
  activeCmTheme: CodeMirrorTheme
  requestCmTheme: () => void
}

interface CodeStyleThemeCatalogContextType {
  loadThemeNames: () => Promise<string[]>
  themeNames: string[]
}

export const CodeStyleContext = createContext<CodeStyleContextType | null>(null)
export const CodeStyleThemeCatalogContext = createContext<CodeStyleThemeCatalogContextType | null>(null)

export const useCodeStyle = () => {
  const context = use(CodeStyleContext)
  if (!context) {
    throw new Error('useCodeStyle must be used within a CodeStyleProvider')
  }
  return context
}

export const useCodeStyleThemeCatalog = () => {
  const context = use(CodeStyleThemeCatalogContext)
  if (!context) {
    throw new Error('useCodeStyleThemeCatalog must be used within a CodeStyleProvider')
  }
  return context
}

/**
 * Reads the active CodeMirror theme for an editor boundary being rendered (`active`).
 * Demanding the theme is what triggers catalog resolution, so windows without editors
 * never load it; the base light/dark string is returned until resolution lands.
 */
export const useCmTheme = (active = true): CodeMirrorTheme => {
  const { activeCmTheme, requestCmTheme } = useCodeStyle()
  useEffect(() => {
    if (active) requestCmTheme()
  }, [active, requestCmTheme])
  return activeCmTheme
}
