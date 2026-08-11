import type { CodeMirrorTheme } from '@cherrystudio/ui'
import type { HighlightChunkResult, ShikiPreProperties } from '@renderer/services/ShikiStreamService'
import { createContext, use } from 'react'

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
  activeCmTheme: CodeMirrorTheme
}

export const CodeStyleContext = createContext<CodeStyleContextType | null>(null)

export const useCodeStyle = () => {
  const context = use(CodeStyleContext)
  if (!context) {
    throw new Error('useCodeStyle must be used within a CodeStyleProvider')
  }
  return context
}
