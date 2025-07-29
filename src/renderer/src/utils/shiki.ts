import { loggerService } from '@logger'
import { BundledLanguage, BundledTheme } from 'shiki/bundle/web'
import { getTokenStyleObject, type HighlighterGeneric, SpecialLanguage, ThemedToken } from 'shiki/core'

import { AsyncInitializer } from './asyncInitializer'

export const DEFAULT_LANGUAGES = ['javascript', 'typescript', 'python', 'java', 'markdown', 'json']
export const DEFAULT_THEMES = ['one-light', 'material-theme-darker']

const logger = loggerService.withContext('Shiki')

/**
 * shiki 初始化器，避免并发问题
 */
const shikiInitializer = new AsyncInitializer(async () => {
  const shiki = await import('shiki')
  return shiki
})

/**
 * 获取 shiki package
 */
export async function getShiki() {
  return shikiInitializer.get()
}

/**
 * shiki highlighter 初始化器，避免并发问题
 */
const highlighterInitializer = new AsyncInitializer(async () => {
  const shiki = await getShiki()
  return shiki.createHighlighter({
    langs: DEFAULT_LANGUAGES,
    themes: DEFAULT_THEMES
  })
})

/**
 * 获取 shiki highlighter
 */
export async function getHighlighter() {
  return highlighterInitializer.get()
}

/**
 * 加载语言
 * @param highlighter - shiki highlighter
 * @param language - 语言
 * @returns 实际加载的语言
 */
export async function loadLanguageIfNeeded(
  highlighter: HighlighterGeneric<any, any>,
  language: string
): Promise<string> {
  const shiki = await getShiki()

  let loadedLanguage = language
  if (!highlighter.getLoadedLanguages().includes(language)) {
    try {
      if (['text', 'ansi'].includes(language)) {
        await highlighter.loadLanguage(language as SpecialLanguage)
      } else {
        const languageImportFn = shiki.bundledLanguages[language]
        const langData = await languageImportFn()
        await highlighter.loadLanguage(langData)
      }
    } catch (error) {
      await highlighter.loadLanguage('text')
      loadedLanguage = 'text'
    }
  }

  return loadedLanguage
}

/**
 * 加载主题
 * @param highlighter - shiki highlighter
 * @param theme - 主题
 * @returns 实际加载的主题
 */
export async function loadThemeIfNeeded(highlighter: HighlighterGeneric<any, any>, theme: string): Promise<string> {
  const shiki = await getShiki()

  let loadedTheme = theme
  if (!highlighter.getLoadedThemes().includes(theme)) {
    try {
      const themeImportFn = shiki.bundledThemes[theme]
      const themeData = await themeImportFn()
      await highlighter.loadTheme(themeData)
    } catch (error) {
      // 回退到 one-light
      logger.debug(`Failed to load theme '${theme}', falling back to 'one-light':`, error as Error)
      const oneLightTheme = await shiki.bundledThemes['one-light']()
      await highlighter.loadTheme(oneLightTheme)
      loadedTheme = 'one-light'
    }
  }

  return loadedTheme
}

/**
 * Shiki token 样式转换为 React 样式对象
 *
 * @param token Shiki themed token
 * @returns React 样式对象
 */
export function getReactStyleFromToken(token: ThemedToken): Record<string, string> {
  const style = token.htmlStyle || getTokenStyleObject(token)
  const reactStyle: Record<string, string> = {}
  for (const [key, value] of Object.entries(style)) {
    switch (key) {
      case 'font-style':
        reactStyle.fontStyle = value
        break
      case 'font-weight':
        reactStyle.fontWeight = value
        break
      case 'background-color':
        reactStyle.backgroundColor = value
        break
      case 'text-decoration':
        reactStyle.textDecoration = value
        break
      default:
        reactStyle[key] = value
    }
  }
  return reactStyle
}

/**
 * 获取 markdown-it，避免并发问题
 */
const mdInitializer = new AsyncInitializer(async () => {
  const md = await import('markdown-it')
  return md.default({
    linkify: true, // 自动转换 URL 为链接
    typographer: true // 启用印刷格式优化
  })
})

/**
 * 获取 markdown-it 渲染器
 * @param theme - 主题
 * @param markdown
 */
export async function getMarkdownIt(theme: string, markdown: string) {
  const highlighter = await getHighlighter()
  await loadMarkdownLanguage(markdown, highlighter)
  const md = await mdInitializer.get()
  const { fromHighlighter } = await import('@shikijs/markdown-it/core')

  let actualTheme = theme
  try {
    actualTheme = await loadThemeIfNeeded(highlighter, theme)
  } catch (error) {
    logger.debug(`Failed to load theme '${theme}', using 'one-light' as fallback:`, error as Error)
    actualTheme = 'one-light'
  }

  const themes: Record<string, string> = {
    'one-light': 'one-light',
    'material-theme-darker': 'material-theme-darker'
  }

  if (actualTheme !== 'one-light' && actualTheme !== 'material-theme-darker') {
    themes[actualTheme] = actualTheme
  }

  md.use(
    fromHighlighter(highlighter, {
      themes,
      defaultColor: actualTheme,
      defaultLanguage: 'json',
      fallbackLanguage: 'json'
    })
  )

  return md
}

/**
 * 加载markdown中所有代码块语言类型
 * @param markdown
 * @param highlighter
 */
async function loadMarkdownLanguage(markdown: string, highlighter: HighlighterGeneric<BundledLanguage, BundledTheme>) {
  const codeBlockRegex = /```(\w+)?/g
  let match: string[] | null
  while ((match = codeBlockRegex.exec(markdown)) !== null) {
    if (match[1]) {
      await loadLanguageIfNeeded(highlighter, match[1])
    }
  }
}
