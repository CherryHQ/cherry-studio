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

  // The migrated/default base runs structured mode with chunkSeparator='\n\n' (the column
  // default), not "no separator". That adds a paragraph-level break (score 30) just after
  // each '\n\n', so the default is an *active* break, not a no-op: it keeps the chunk count
  // but shifts some interior cut offsets versus a no-separator run, while staying verbatim.
  // This is why "reproduces the previous behavior" only holds for already-indexed content
  // (chunking affects newly-added content only), not byte-for-byte under re-chunking.
  it('treats the migrated "\\n\\n" default as an active paragraph-level break in structured mode', () => {
    const text = [
      '# Title',
      'First paragraph with several words to fill up some space here for chunking.',
      'Second paragraph that also carries a fair amount of words for the splitter.',
      'Third paragraph continuing the document with yet more filler content inside.',
      'Fourth and final paragraph wrapping up this example body of text quite nicely.'
    ].join('\n\n')

    const withDefaultSeparator = splitTextWithOffsets(text, {
      chunkSize: 12,
      chunkOverlap: 4,
      separator: '\\n\\n',
      strategy: 'structured'
    })
    const withoutSeparator = splitTextWithOffsets(text, {
      chunkSize: 12,
      chunkOverlap: 4,
      strategy: 'structured'
    })

    expect(withDefaultSeparator).not.toEqual(withoutSeparator)
    expect(withDefaultSeparator.length).toBe(withoutSeparator.length)
    expectVerbatimSlices(text, withDefaultSeparator)
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
