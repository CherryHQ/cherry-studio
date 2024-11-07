import { useTheme } from '@renderer/context/ThemeProvider'
import { useSettings } from '@renderer/hooks/useSettings'
import { CodeStyleVarious, ThemeMode } from '@renderer/types'
import { loadScript } from '@renderer/utils'
import React, { createContext, PropsWithChildren, useContext, useEffect, useMemo, useState } from 'react'
import {
  BundledLanguage,
  bundledLanguages,
  BundledTheme,
  bundledThemes,
  createHighlighter,
  HighlighterGeneric
} from 'shiki'

interface SyntaxHighlighterContextType {
  codeToHtml: (code: string, language: string) => string
}

const SyntaxHighlighterContext = createContext<SyntaxHighlighterContextType | undefined>(undefined)

export const SyntaxHighlighterProvider: React.FC<PropsWithChildren> = ({ children }) => {
  const { theme } = useTheme()
  const [highlighter, setHighlighter] = useState<HighlighterGeneric<BundledLanguage, BundledTheme> | null>(null)
  const { codeStyle } = useSettings()

  const highlighterTheme = useMemo(() => {
    if (codeStyle === 'auto') return theme === ThemeMode.light ? 'one-light' : 'material-theme-darker'
    else return codeStyle
  }, [theme, codeStyle])

  useEffect(() => {
    const initMermaid = async () => {
      if (!window.mermaid) {
        await loadScript('https://unpkg.com/mermaid@10.9.1/dist/mermaid.min.js')
        window.mermaid.initialize({
          startOnLoad: true,
          theme: theme === ThemeMode.dark ? 'dark' : 'default',
          securityLevel: 'loose'
        })
        window.mermaid.contentLoaded()
      }
    }

    initMermaid()
  }, [theme])

  useEffect(() => {
    const initHighlighter = async () => {
      const hl = await createHighlighter({
        themes: Object.keys(bundledThemes),
        langs: Object.keys(bundledLanguages)
      })
      setHighlighter(hl)
    }

    initHighlighter()
  }, [])

  const codeToHtml = (code: string, language: string) => {
    if (!highlighter) return ''

    return highlighter.codeToHtml(code, {
      lang: language,
      theme: highlighterTheme,
      transformers: [
        {
          preprocess(code) {
            if (code.endsWith('\n')) code = code.slice(0, -1)
            return code
          }
        }
      ]
    })
  }

  return <SyntaxHighlighterContext.Provider value={{ codeToHtml }}>{children}</SyntaxHighlighterContext.Provider>
}

export const useSyntaxHighlighter = () => {
  const context = useContext(SyntaxHighlighterContext)
  if (!context) {
    throw new Error('useSyntaxHighlighter must be used within a SyntaxHighlighterProvider')
  }
  return context
}

export const codeThemes = ['auto', ...Object.keys(bundledThemes)] as CodeStyleVarious[]
