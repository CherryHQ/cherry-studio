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

// 直接写法的白色兜底（含带 alpha 的 #ffffffff）。Shiki colorReplacements 按精确小写匹配，故逐个枚举
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
 * 计算浅色主题下的白色 token 颜色替换表，供 Shiki 原生 colorReplacements 使用。
 *
 * 关键点：one-light 等主题通过自身 colorReplacements 把哨兵色（如 `#00000001`）映射为 `white`，
 * 而 Shiki 只做单次替换，直接用 `white` 作 key 无法命中。故先读取主题自身的 colorReplacements，
 * 把"值为白色"的哨兵键改写为可读色，再附带直接白色写法做兜底。
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
 * 缓存 markdown-it 构造器，避免并发重复导入。
 * 注意：返回的是构造器而非单例实例 —— 每次渲染需创建独立实例，
 * 否则共享实例的 options.highlight 会在并发渲染/切主题时相互覆盖（串台）
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
  // 每次渲染创建独立的 markdown-it 实例，避免共享实例 options.highlight 并发串台
  const MarkdownIt = await mdInitializer.get()
  const md = MarkdownIt({
    linkify: true, // 自动转换 URL 为链接
    typographer: true // 启用印刷格式优化
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

  // 仅当默认主题为浅色时，用 Shiki 原生 colorReplacements 把白色 token 改写为可读色；
  // 按主题名嵌套，确保深色主题不受影响。colorReplacements 不在 MarkdownItShikiSetupOptions
  // 类型内，但 fromHighlighter 会把整个 options 原样透传给 codeToHtml，故经独立对象展开传入
  const colorReplacementOption = isActualThemeDark
    ? {}
    : { colorReplacements: { [actualTheme]: getLightThemeWhiteColorReplacements(actualThemeRegistration) } }

  md.use(
    fromHighlighter(highlighter, {
      themes,
      defaultColor: actualTheme,
      // 'text' 是 Shiki 内置 plain 语言，未纳入 BundledLanguage 类型联合，故做类型断言。
      // defaultLanguage 默认即为 'text'，无需显式声明；fallbackLanguage 仍需保留，
      // 否则未加载的未知语言会以原 lang 调用 codeToHtml 而抛错
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
