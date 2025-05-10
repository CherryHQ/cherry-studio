import { useTheme } from '@renderer/context/ThemeProvider'
import { ThemeMode } from '@renderer/types'
import { MarkdownItShikiOptions, setupMarkdownIt } from '@shikijs/markdown-it'
import MarkdownIt from 'markdown-it'
import { useEffect, useRef, useState } from 'react'
import { BuiltinLanguage, BuiltinTheme, bundledLanguages, createHighlighter } from 'shiki'

const defaultOptions = {
  themes: {
    light: 'one-light',
    dark: 'material-theme-darker'
  },
  defaultColor: 'light'
}

const initHighlighter = async (options: MarkdownItShikiOptions) => {
  const themeNames = ('themes' in options ? Object.values(options.themes) : [options.theme]).filter(
    Boolean
  ) as BuiltinTheme[]
  return await createHighlighter({
    themes: themeNames,
    langs: options.langs || (Object.keys(bundledLanguages) as BuiltinLanguage[])
  })
}

const highlighter = await initHighlighter(defaultOptions)

export function getShikiInstance(theme: ThemeMode) {
  const options = {
    ...defaultOptions,
    defaultColor: theme
  }

  return function (markdownit: MarkdownIt) {
    setupMarkdownIt(markdownit, highlighter, options)
  }
}

export function useShikiWithMarkdownIt(content: string) {
  const [renderedMarkdown, setRenderedMarkdown] = useState('')
  const md = useRef<MarkdownIt>(
    new MarkdownIt({
      linkify: true, // 自动转换 URL 为链接
      typographer: true // 启用印刷格式优化
    })
  )
  const { theme } = useTheme()
  useEffect(() => {
    const sk = getShikiInstance(theme)
    md.current.use(sk)
    setRenderedMarkdown(md.current.render(content))
  }, [content, theme])
  return {
    renderedMarkdown
  }
}
