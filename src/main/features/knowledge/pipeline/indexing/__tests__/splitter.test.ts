import { estimateTokenCount } from 'tokenx'
import { describe, expect, it } from 'vitest'

import { splitTextWithOffsets, type TextChunk } from '../splitter'

/** The load-bearing invariant: every chunk's text is a verbatim slice of the source. */
const expectVerbatimSlices = (text: string, chunks: TextChunk[]) => {
  for (const chunk of chunks) {
    expect(text.slice(chunk.start, chunk.end)).toBe(chunk.text)
    expect(chunk.start).toBeGreaterThanOrEqual(0)
    expect(chunk.end).toBeLessThanOrEqual(text.length)
    expect(chunk.end).toBeGreaterThan(chunk.start)
  }
}

describe('splitTextWithOffsets', () => {
  it('returns nothing for empty or whitespace-only text', () => {
    expect(splitTextWithOffsets('', { chunkSize: 50, chunkOverlap: 10 })).toEqual([])
    expect(splitTextWithOffsets('   \n\t  ', { chunkSize: 50, chunkOverlap: 10 })).toEqual([])
  })

  it('keeps every chunk a verbatim slice of the source', () => {
    const text =
      'The first sentence is short. The second sentence is a little longer than the first. ' +
      'A third one follows here! And a fourth, with a question? Plus a final clause.'
    const chunks = splitTextWithOffsets(text, { chunkSize: 12, chunkOverlap: 4 })

    expect(chunks.length).toBeGreaterThan(1)
    expectVerbatimSlices(text, chunks)
  })

  it('trims whitespace at chunk edges while keeping offsets aligned', () => {
    const text = 'Alpha.    Beta.    Gamma.'
    const chunks = splitTextWithOffsets(text, { chunkSize: 3, chunkOverlap: 0 })

    expectVerbatimSlices(text, chunks)
    for (const chunk of chunks) {
      expect(chunk.text).toBe(chunk.text.trim())
    }
  })

  it('produces overlapping chunks when chunkOverlap > 0', () => {
    const text = Array.from({ length: 8 }, (_, i) => `Sentence number ${i} ends here.`).join(' ')
    const overlapping = splitTextWithOffsets(text, { chunkSize: 16, chunkOverlap: 8 })
    const disjoint = splitTextWithOffsets(text, { chunkSize: 16, chunkOverlap: 0 })

    expect(overlapping.length).toBeGreaterThan(1)
    expectVerbatimSlices(text, overlapping)
    // Some consecutive overlapping chunks must share source range; disjoint ones must not.
    const hasOverlap = overlapping.slice(1).some((chunk, i) => chunk.start < overlapping[i].end)
    expect(hasOverlap).toBe(true)
    const disjointOverlap = disjoint.slice(1).some((chunk, i) => chunk.start < disjoint[i].end)
    expect(disjointOverlap).toBe(false)
  })

  it('covers all non-whitespace content (no dropped text)', () => {
    const text = 'One. Two. Three. Four. Five. Six. Seven. Eight. Nine. Ten.'
    const chunks = splitTextWithOffsets(text, { chunkSize: 4, chunkOverlap: 0 })

    // With zero overlap the chunks partition the content; concatenating their
    // trimmed bodies must contain every non-space character of the source.
    const covered = new Array(text.length).fill(false)
    for (const chunk of chunks) {
      for (let i = chunk.start; i < chunk.end; i++) {
        covered[i] = true
      }
    }
    for (let i = 0; i < text.length; i++) {
      if (!/\s/.test(text[i])) {
        expect(covered[i]).toBe(true)
      }
    }
  })

  it('prefers heading boundaries as cut points', () => {
    // Headings spaced closer than the look-back window, so a heading (score 90)
    // outscores every sentence/newline break in range — cuts snap to headings.
    const text = '\n## Section\nshort body line.'.repeat(50)
    const chunks = splitTextWithOffsets(text, { chunkSize: 40, chunkOverlap: 4 })

    expect(chunks.length).toBeGreaterThan(1)
    expectVerbatimSlices(text, chunks)
    expect(chunks.some((c) => c.text.startsWith('## '))).toBe(true)
  })

  it('hard-splits a single oversized unpunctuated run', () => {
    const text = `${'x'.repeat(5000)}.`
    const chunks = splitTextWithOffsets(text, { chunkSize: 20, chunkOverlap: 0 })

    expect(chunks.length).toBeGreaterThan(1)
    expectVerbatimSlices(text, chunks)
  })

  it('handles CJK text with full-width terminators', () => {
    const text = '第一句话在这里。第二句稍微长一点点哦！第三句是一个问题吗？最后一句结束了。'
    const chunks = splitTextWithOffsets(text, { chunkSize: 8, chunkOverlap: 2 })

    expect(chunks.length).toBeGreaterThan(1)
    expectVerbatimSlices(text, chunks)
  })

  it('keeps the invariant across many generated inputs (fuzz)', () => {
    const fragments = [
      'Hello world. ',
      'Short! ',
      '一段中文。',
      'A question? ',
      '\n\n',
      '   ',
      'tail',
      '😀🚀 ',
      '12.5 km. '
    ]
    // Deterministic LCG so the fuzz is reproducible without Math.random.
    let seed = 0x2545f491
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed / 0x7fffffff
    }

    for (let iter = 0; iter < 50; iter++) {
      const pieces = Math.floor(rand() * 40)
      let text = ''
      for (let p = 0; p < pieces; p++) {
        text += fragments[Math.floor(rand() * fragments.length)]
      }
      const chunkSize = 1 + Math.floor(rand() * 30)
      const chunkOverlap = Math.floor(rand() * chunkSize)
      const chunks = splitTextWithOffsets(text, { chunkSize, chunkOverlap })
      expectVerbatimSlices(text, chunks)
    }
  })
})

describe('splitTextWithOffsets — separator and strategy', () => {
  it('splits by a custom separator in delimiter mode and stays verbatim', () => {
    const text = 'Alpha block.\n\nBeta block.\n\nGamma block.\n\nDelta block.'
    const chunks = splitTextWithOffsets(text, {
      chunkSize: 4,
      chunkOverlap: 0,
      separator: '\n\n',
      strategy: 'delimiter'
    })

    expect(chunks.length).toBeGreaterThan(1)
    expectVerbatimSlices(text, chunks)
  })

  it('treats an escaped separator the same as its literal characters', () => {
    const text = 'Alpha block.\n\nBeta block.\n\nGamma block.'
    const escaped = splitTextWithOffsets(text, {
      chunkSize: 5,
      chunkOverlap: 0,
      separator: '\\n\\n',
      strategy: 'delimiter'
    })
    const literal = splitTextWithOffsets(text, {
      chunkSize: 5,
      chunkOverlap: 0,
      separator: '\n\n',
      strategy: 'delimiter'
    })

    expect(escaped).toEqual(literal)
    expectVerbatimSlices(text, escaped)
  })

  it('matches the structured strategy when called with default options', () => {
    const text = '\n## Section\nbody line here for a while.'.repeat(20)
    const withDefault = splitTextWithOffsets(text, { chunkSize: 30, chunkOverlap: 5 })
    const withStructured = splitTextWithOffsets(text, { chunkSize: 30, chunkOverlap: 5, strategy: 'structured' })

    expect(withDefault).toEqual(withStructured)
  })

  // The default '\n\n' break sits in whitespace, so trimming can make two cuts
  // indistinguishable in the emitted chunks. Use a visible separator to verify
  // that structured mode still honors the configured separator.
  it('uses the configured separator as a structured break', () => {
    const text = 'alpha beta gamma||delta epsilon zeta||eta theta iota kappa lambda'
    const separatorEnd = text.indexOf('||') + 2
    const charsPerToken = text.length / estimateTokenCount(text)
    const chunkSize = Math.max(1, Math.ceil((separatorEnd * 1.1) / charsPerToken))

    const withSeparator = splitTextWithOffsets(text, {
      chunkSize,
      chunkOverlap: 0,
      separator: '||',
      strategy: 'structured'
    })
    const withoutSeparator = splitTextWithOffsets(text, {
      chunkSize,
      chunkOverlap: 0,
      strategy: 'structured'
    })

    expect(withSeparator).not.toEqual(withoutSeparator)
    expectVerbatimSlices(text, withSeparator)
    expectVerbatimSlices(text, withoutSeparator)
  })

  it('keeps the invariant across strategies and separators (fuzz)', () => {
    const fragments = [
      'Hello world. ',
      '一段中文。',
      'A question? ',
      '\n\n',
      '## Head\n',
      '```\ncode\n```\n',
      '   ',
      'tail',
      '12.5 km. ',
      '|'
    ]
    const separators = ['', '\\n\\n', '。', '. ', '|']
    const strategies = ['structured', 'delimiter'] as const
    // Deterministic LCG so the fuzz is reproducible without Math.random.
    let seed = 0x13572468
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed / 0x7fffffff
    }

    for (let iter = 0; iter < 80; iter++) {
      const pieces = Math.floor(rand() * 30)
      let text = ''
      for (let p = 0; p < pieces; p++) {
        text += fragments[Math.floor(rand() * fragments.length)]
      }
      const chunkSize = 1 + Math.floor(rand() * 30)
      const chunkOverlap = Math.floor(rand() * chunkSize)
      const separator = separators[Math.floor(rand() * separators.length)]
      const strategy = strategies[Math.floor(rand() * strategies.length)]
      const chunks = splitTextWithOffsets(text, { chunkSize, chunkOverlap, separator, strategy })
      expectVerbatimSlices(text, chunks)
    }
  })
})

describe('splitTextWithOffsets — sentence and atomic boundaries', () => {
  it('cuts after CJK sentence punctuation and keeps the closing quote', () => {
    const text = '他说：“第一句。”然后第二句！最后第三句？'
    const chunks = splitTextWithOffsets(text, { chunkSize: 10, chunkOverlap: 0 })

    expect(chunks.length).toBeGreaterThan(1)
    expectVerbatimSlices(text, chunks)
    for (const chunk of chunks.slice(0, -1)) {
      expect(chunk.text).toMatch(/[。！？][”’]?$/)
    }
  })

  it('cuts after Latin sentence punctuation', () => {
    const text = 'First sentence. Second sentence! Third sentence?'
    const chunks = splitTextWithOffsets(text, { chunkSize: 6, chunkOverlap: 0 })

    expect(chunks.length).toBeGreaterThan(1)
    expectVerbatimSlices(text, chunks)
    for (const chunk of chunks.slice(0, -1)) {
      expect(chunk.text).toMatch(/[.!?]$/)
    }
  })

  it('never splits a display-math block', () => {
    const text = '公式如下：\n\n$$\na + b = c\n$$\n\n然后继续。'
    const chunks = splitTextWithOffsets(text, { chunkSize: 6, chunkOverlap: 0 })

    expect(chunks.length).toBeGreaterThan(1)
    expectVerbatimSlices(text, chunks)
    for (const chunk of chunks) {
      expect((chunk.text.match(/\$\$/g) ?? []).length % 2).toBe(0)
    }
  })

  it('never splits an inline-math expression', () => {
    const text = '设 $a+b$ 为和。下一句。'
    const chunks = splitTextWithOffsets(text, { chunkSize: 5, chunkOverlap: 0 })

    expect(chunks.length).toBeGreaterThan(1)
    expectVerbatimSlices(text, chunks)
    for (const chunk of chunks) {
      expect((chunk.text.match(/\$/g) ?? []).length % 2).toBe(0)
    }
  })

  it('never splits a table block', () => {
    const text = '前文。\n\n<table><tr><td>1</td></tr></table>\n\n后文。'
    const chunks = splitTextWithOffsets(text, { chunkSize: 6, chunkOverlap: 0 })

    expect(chunks.length).toBeGreaterThan(1)
    expectVerbatimSlices(text, chunks)
    for (const chunk of chunks) {
      const opens = (chunk.text.match(/<table\b/g) ?? []).length
      const closes = (chunk.text.match(/<\/table>/g) ?? []).length
      expect(opens).toBe(closes)
    }
  })

  it('starts overlapping chunks at a sentence boundary', () => {
    const text = '第一句。第二句。第三句。第四句。第五句。第六句。'
    const chunks = splitTextWithOffsets(text, { chunkSize: 5, chunkOverlap: 4 })

    expect(chunks.length).toBeGreaterThan(1)
    expectVerbatimSlices(text, chunks)
    for (const chunk of chunks.slice(1)) {
      const before = text.slice(0, chunk.start).trimEnd()
      expect(before.endsWith('。')).toBe(true)
    }
  })

  it('does not start an overlapping chunk inside a display-math block', () => {
    const text = '前文说明。\n\n$$\na + b = c\n$$\n\n后文说明。'
    const chunks = splitTextWithOffsets(text, { chunkSize: 5, chunkOverlap: 4 })

    expect(chunks.length).toBeGreaterThan(1)
    expectVerbatimSlices(text, chunks)
    for (const chunk of chunks) {
      expect((chunk.text.match(/\$\$/g) ?? []).length % 2).toBe(0)
    }
  })

  it('fits each chunk to the token budget when sentence boundaries are available', () => {
    const text = `${'A'.repeat(400)}。${'这是中文句子。'.repeat(30)}`
    const chunks = splitTextWithOffsets(text, { chunkSize: 30, chunkOverlap: 0 })

    expect(chunks.length).toBeGreaterThan(1)
    expectVerbatimSlices(text, chunks)
    for (const chunk of chunks) {
      expect(estimateTokenCount(chunk.text)).toBeLessThanOrEqual(30)
    }
  })
})
