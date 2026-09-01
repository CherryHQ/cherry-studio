import { createContext, use } from 'react'

import type { CodeMirrorTheme } from '@cherrystudio/ui'
import type { HighlightChunkResult, ShikiPreProperties } from '@renderer/services/ShikiStreamService'

interface CodeStyleContextType {
  highlightCodeChunk: (trunk: string, language: string, callerId: string) => Promise<HighlightChunkResult>
  highlightStreamingCode: (code: string, language: string, callerId: string) => Promise<HighlightChunkResult>
  cleanupTokenizers: (callerId: string) => void
  getShikiPreProperties: (language: string) => Promise<ShikiPreProperties>
  highlightCode: (code: string, language: string) => Promise<string>
  shikiMarkdownIt: (code: string) => Promise<string>
  activeShikiTheme: string
  isShikiThemeDark: boolean
  activeCmTheme: CodeMirrorTheme
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
