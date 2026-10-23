import { codeToTokens } from '@pierre/highlights'
import oneLight from '@pierre/highlights/themes/one-light'
import { describe, expect, it } from 'vitest'

import { loadCodeHighlightRuntime } from '../../../code-highlight'
const runtime = await loadCodeHighlightRuntime()

describe('HighlightDocument', () => {
  it.each([
    [10, 11, '', 'const a=1;\nconst b=2;'],
    [11, 12, '', 'const a=1;\rconst b=2;'],
    [11, 11, 'x', 'const a=1;\rx\nconst b=2;']
  ])('preserves exact source when editing inside CRLF (%i, %i)', (start, end, newText, expected) => {
    const document = runtime.createDocument('const a=1;\r\nconst b=2;', 'typescript', oneLight)
    try {
      document.update({
        type: 'edits',
        edits: [
          {
            range: {
              start: { line: 0, character: start },
              end: end === 12 ? { line: 1, character: 0 } : { line: 0, character: end }
            },
            newText
          }
        ]
      })
      expect(document.code).toBe(expected)
      expect(
        document
          .read({ start: 0, end: 10 })
          .lines.map((line) => line.map((token) => token.content).join(''))
          .join('\n')
      ).toBe(expected)
      const lines = expected.split('\n')
      const point = { line: lines.length - 1, character: lines.at(-1)!.length }
      document.update({ type: 'edits', edits: [{ range: { start: point, end: point }, newText: ' // next' }] })
      expect(document.code).toBe(expected + ' // next')
    } finally {
      document.dispose()
    }
  })

  it('applies a batch that splits CRLF using pre-edit source positions', () => {
    const document = runtime.createDocument('a\r\nb\r\nc', 'text', oneLight)
    try {
      document.update({
        type: 'edits',
        edits: [
          { range: { start: { line: 1, character: 1 }, end: { line: 1, character: 2 } }, newText: '' },
          { range: { start: { line: 2, character: 1 }, end: { line: 2, character: 1 } }, newText: '🍒' },
          { range: { start: { line: 0, character: 1 }, end: { line: 0, character: 2 } }, newText: '' }
        ]
      })
      expect(document.code).toBe('a\nb\nc🍒')
      expect(
        document.read({ start: 1, end: 3 }).lines.map((line) => line.map((token) => token.content).join(''))
      ).toEqual(['b', 'c🍒'])
    } finally {
      document.dispose()
    }
  })

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
