import { createContext, use, type CSSProperties } from 'react'

import type { HighlightRange, HighlightResult } from '@renderer/types/codeHighlight'

interface CodeStyleContextType {
  highlightRange: (code: string, language: string, callerId: string, range: HighlightRange) => Promise<HighlightResult>
  cleanupTokenizers: (callerId: string) => void
  codeBlockStyle?: CSSProperties
  highlightCode: (code: string, language: string) => Promise<string>
  renderMarkdown: (code: string) => Promise<string>
  codeThemes: [string, string]
  activeCodeTheme: string
  isCodeThemeDark: boolean
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
