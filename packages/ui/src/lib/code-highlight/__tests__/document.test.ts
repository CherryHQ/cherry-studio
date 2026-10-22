import { codeToTokens } from '@pierre/highlights'
import oneLight from '@pierre/highlights/themes/one-light'
import { describe, expect, it } from 'vitest'

import { loadCodeHighlightRuntime } from '../../../code-highlight'
const runtime = await loadCodeHighlightRuntime()

describe('HighlightDocument', () => {
  it('returns only requested rows when jumping to the end of a large file', () => {
    const code = Array.from({ length: 10_000 }, (_, index) => `const row${index} = ${index}`).join('\n')
    const document = runtime.createDocument(code, 'typescript', oneLight)
    try {
      document.update({ type: 'replace', code })
      const result = document.read({ start: 9998, end: 10_000 })
      expect(result.start).toBe(9998)
      expect(result.lines.map((line) => line.map((token) => token.content).join(''))).toEqual([
        'const row9998 = 9998',
        'const row9999 = 9999'
      ])
    } finally {
      document.dispose()
    }
  })

  it('highlights unfinished lines and preserves multiline state across appends and replacements', () => {
    const document = runtime.createDocument('', 'typescript', oneLight)
    try {
      for (const code of [
        '/* comment',
        '/* comment\n中文 🍒',
        '/* comment\n中文 🍒 */\nconst done = "🍒"',
        'let replacement = 2'
      ]) {
        document.update({ type: 'replace', code })
        const result = document.read({ start: 0, end: 10 })
        const styles = (lines: typeof result.lines) =>
          lines.map((line) => line.map(({ content, color, fontStyle }) => ({ content, color, fontStyle })))
        expect(result.lines.map((line) => line.map((token) => token.content).join('')).join('\n')).toBe(code)
        expect(styles(result.lines)).toEqual(styles(codeToTokens(code, { lang: 'typescript', theme: oneLight }).tokens))
      }
    } finally {
      document.dispose()
    }
  })

  it('shows unsupported languages as plain text without losing whitespace or trailing lines', () => {
    const code = '<unsupported>  \n\t🍒\n'
    const document = runtime.createDocument(code, 'unsupported-language', oneLight)
    try {
      document.update({ type: 'replace', code })
      const result = document.read({ start: 0, end: 10 })
      expect(result.lines.map((line) => line.map((token) => token.content).join(''))).toEqual([
        '<unsupported>  ',
        '\t🍒',
        ''
      ])
      expect(
        result.lines
          .flat()
          .every(
            (token) =>
              token.color === undefined ||
              token.color?.toLowerCase() === oneLight.style['editor.foreground']?.toLowerCase()
          )
      ).toBe(true)
    } finally {
      document.dispose()
    }
  })

  it('bounds token nodes for minified single-line code without truncating its content', () => {
    const code = 'const long = [' + '1234,'.repeat(10_000) + '0]'
    const document = runtime.createDocument(code, 'javascript', oneLight)
    try {
      document.update({ type: 'replace', code })
      const result = document.read({ start: 0, end: 1 })
      expect(result.lines[0]).toHaveLength(1)
      expect(result.lines[0][0].content).toBe(code)
    } finally {
      document.dispose()
    }
  })
})
