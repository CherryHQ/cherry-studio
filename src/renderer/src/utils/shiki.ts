import { ThemeMode } from '@renderer/types'
import { MarkdownItShikiOptions, setupMarkdownIt } from '@shikijs/markdown-it'
import MarkdownIt from 'markdown-it'
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
