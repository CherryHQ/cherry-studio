import { loggerService } from '@logger'
import type { BundledLanguage, BundledTheme } from 'shiki/bundle/web'
import type { SpecialLanguage, ThemedToken } from 'shiki/core'
import { getTokenStyleObject, type HighlighterGeneric } from 'shiki/core'

import { AsyncInitializer } from './asyncInitializer'

export const DEFAULT_LANGUAGES = ['text', 'javascript', 'typescript', 'python', 'java', 'markdown', 'json']
export const DEFAULT_THEMES = ['one-light', 'material-theme-darker']

const logger = loggerService.withContext('Shiki')
const WHITE_TOKEN_COLOR_PATTERN = /^(?:white|#fff(?:fff)?)$/i
const READABLE_TEXT_COLOR = 'var(--color-foreground)'

// Literal white fallbacks (including #ffffffff with alpha). Shiki colorReplacements matches by exact, lowercased value, so enumerate each one.
const LITERAL_WHITE_COLOR_REPLACEMENTS: Record<string, string> = {
  white: READABLE_TEXT_COLOR,
  '#fff': READABLE_TEXT_COLOR,
  '#ffffff': READABLE_TEXT_COLOR,
  '#ffffffff': READABLE_TEXT_COLOR
}

function isWhiteTokenColor(color: string): boolean {
  return WHITE_TOKEN_COLOR_PATTERN.test(color)
}

/**
 * Build the white-token color replacement map for light themes, to feed Shiki's native colorReplacements.
 *
 * Key insight: themes like one-light map a sentinel color (e.g. `#00000001`) to `white` via their own
 * colorReplacements, and Shiki only replaces once, so using `white` as the key never matches. We therefore
 * read the theme's own colorReplacements, rewrite any sentinel whose value is white to the readable color,
 * and add the literal white spellings as a fallback.
 */
function getLightThemeWhiteColorReplacements(theme: {
  colorReplacements?: Record<string, string>
}): Record<string, string> {
  const replacements: Record<string, string> = { ...LITERAL_WHITE_COLOR_REPLACEMENTS }
  for (const [sentinel, value] of Object.entries(theme.colorReplacements ?? {})) {
    if (isWhiteTokenColor(value)) {
      replacements[sentinel] = READABLE_TEXT_COLOR
    }
  }
  return replacements
}

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
const highlighterInitializer = new AsyncInitializer(async (langs?: string[], themes?: string[]) => {
  const shiki = await getShiki()
  return shiki.createHighlighter({
    langs: langs || DEFAULT_LANGUAGES,
    themes: themes || DEFAULT_THEMES
  })
})

/**
 * 获取 shiki highlighter
 */
export async function getHighlighter(langs?: string[], themes?: string[]) {
  return highlighterInitializer.get(langs, themes)
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
export function getReactStyleFromToken(
  token: ThemedToken,
  options?: { isDarkTheme?: boolean }
): Record<string, string> {
  const style = token.htmlStyle || getTokenStyleObject(token)
  const reactStyle: Record<string, string> = {}
  for (const [key, value] of Object.entries(style)) {
    if (key === 'color' && !options?.isDarkTheme && isWhiteTokenColor(value)) {
      reactStyle.color = READABLE_TEXT_COLOR
      continue
    }

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
 * Cache the markdown-it constructor to avoid duplicate concurrent imports.
 * Note: this returns the constructor, not a singleton instance — each render must create its own instance,
 * otherwise a shared instance's options.highlight would overwrite one another (cross-contaminate) during
 * concurrent renders / theme switches.
 */
const mdInitializer = new AsyncInitializer(async () => {
  const md = await import('markdown-it')
  return md.default
})

/**
 * 获取 markdown-it 渲染器
 * @param theme - 主题
 * @param markdown
 */
export async function getMarkdownIt(theme: string, markdown: string) {
  const highlighter = await getHighlighter()
  await loadMarkdownLanguage(markdown, highlighter)
  // Create an independent markdown-it instance per render so a shared instance's options.highlight can't cross-contaminate under concurrency
  const MarkdownIt = await mdInitializer.get()
  const md = MarkdownIt({
    linkify: true, // auto-convert URLs to links
    typographer: true // enable typographic replacements
  })
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

  const actualThemeRegistration = highlighter.getTheme(actualTheme)
  const isActualThemeDark = actualThemeRegistration.type === 'dark'

  // Only when the default theme is light, use Shiki's native colorReplacements to rewrite white tokens to a
  // readable color; nest it by theme name so dark themes are unaffected. colorReplacements is not part of the
  // MarkdownItShikiSetupOptions type, but fromHighlighter forwards the whole options object to codeToHtml
  // as-is, so we spread it in via a separate object.
  const colorReplacementOption = isActualThemeDark
    ? {}
    : { colorReplacements: { [actualTheme]: getLightThemeWhiteColorReplacements(actualThemeRegistration) } }

  md.use(
    fromHighlighter(highlighter, {
      themes,
      defaultColor: actualTheme,
      // 'text' is Shiki's built-in plain language, not in the BundledLanguage union, hence the type assertion.
      // defaultLanguage already defaults to 'text', so it doesn't need to be declared; fallbackLanguage must
      // stay, otherwise an unloaded/unknown language would call codeToHtml with the original lang and throw.
      fallbackLanguage: 'text' as BundledLanguage,
      ...colorReplacementOption
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
