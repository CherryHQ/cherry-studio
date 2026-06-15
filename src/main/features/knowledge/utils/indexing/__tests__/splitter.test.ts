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
