import type { BundledLanguage, CodeHighlighterPlugin, ThemeInput } from 'streamdown'
import { describe, expect, it } from 'vitest'

import { createCodeHighlightPlugin } from '../../plugins'

type HighlightResult = NonNullable<ReturnType<CodeHighlighterPlugin['highlight']>>

function highlight(
  plugin: CodeHighlighterPlugin,
  code: string,
  language: BundledLanguage = 'typescript',
  themes: [ThemeInput, ThemeInput] = ['github-light', 'github-dark']
) {
  return new Promise<HighlightResult>((resolve) => {
    const result = plugin.highlight({ code, language, themes }, resolve)
    if (result) resolve(result)
  })
}

const source = (result: HighlightResult) =>
  result.tokens.map((line) => line.map((token) => token.content).join('')).join('\n')

describe('Highlights Streamdown plugin', () => {
  it('preserves Unicode and trailing lines while supplying light and dark token styles', async () => {
    const code = 'const message = "中文 🍒";  \n\n'
    const result = await highlight(createCodeHighlightPlugin(), code)
    expect(source(result)).toBe(code)
    expect(result.tokens.flat().some((token) => token.htmlStyle?.color && token.htmlStyle?.['--shiki-dark'])).toBe(true)
    expect(result.rootStyle).toContain('--shiki-dark-bg')
    expect(result.bg).not.toContain(';')
    expect(result.fg).not.toContain(';')
  })

  it('does not return stale tokens for equal-length edits in the middle of a code block', async () => {
    const plugin = createCodeHighlightPlugin()
    const prefix = '// prefix\n'.repeat(20)
    const suffix = '// suffix\n'.repeat(20)
    const first = `${prefix}const a = "one";\n${suffix}`
    const next = `${prefix}const b = "two";\n${suffix}`
    expect(source(await highlight(plugin, first))).toBe(first)
    expect(source(await highlight(plugin, next))).toBe(next)
    expect(source(await highlight(plugin, first))).toBe(first)
  })

  it('finishes every concurrent callback and preserves appended multiline code', async () => {
    const plugin = createCodeHighlightPlugin()
    const code = '/* streaming comment'
    const results = await Promise.all([highlight(plugin, code), highlight(plugin, code)])
    expect(results.map(source)).toEqual([code, code])
    const completed = `${code}\n */\nconst answer = 42`
    const result = await highlight(plugin, completed)
    expect(source(result)).toBe(completed)
    expect(result.tokens[2].filter((token) => token.htmlStyle?.color).length).toBeGreaterThan(1)
  })

  it('accepts aliases and preserves unsupported languages as plain text', async () => {
    const plugin = createCodeHighlightPlugin()
    expect(plugin.supportsLanguage('ts')).toBe(true)
    expect(plugin.getSupportedLanguages().every((language) => plugin.supportsLanguage(language))).toBe(true)
    const code = '<unsafe>中文🍒\n'
    const result = await highlight(plugin, code, 'abap')
    expect(source(result)).toBe(code)
    expect(plugin.supportsLanguage('abap')).toBe(false)
  })

  it('keeps minified lines intact without creating thousands of token spans', async () => {
    const code = 'const a = 1;'.repeat(2000)
    const result = await highlight(createCodeHighlightPlugin(), code)
    expect(source(result)).toBe(code)
    expect(result.tokens[0]).toHaveLength(1)
  })

  it('uses bundled defaults when a custom TextMate theme has no Highlights equivalent', async () => {
    const result = await highlight(createCodeHighlightPlugin(), 'const answer = 42', 'typescript', [
      { name: 'custom-textmate', settings: [] },
      'github-dark'
    ])
    expect(source(result)).toBe('const answer = 42')
    expect(result.tokens.flat().some((token) => token.htmlStyle?.color)).toBe(true)
  })
})
