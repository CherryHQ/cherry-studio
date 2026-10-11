import { describe, expect, it } from 'vitest'

import { composeParagraph, MAX_PARAGRAPH_LENGTH, type ParagraphRun } from './paragraph-layout'

const metrics: ParagraphRun['metrics'] = {
  fontKey: 'test',
  familyKey: 'test',
  space: { width: 4, stretch: 2, shrink: 1 },
  hyphenWidth: 4,
  ratioAtMax: 1,
  ratioAtMin: 1
}
const measure = { width: (text: string) => Array.from(text).length * 8, charAdvance: () => 8 }
const run = (text: string): ParagraphRun => ({ text, metrics })

describe('paragraph source mapping', () => {
  // Lost whitespace or inserted hyphens would corrupt copying and ProseMirror document positions.
  it('preserves every source character across marks, collapsed spaces and automatic hyphens', () => {
    const runs = [run('  Internationalization  '), run('keeps bold '), run(' words intact.  ')]
    const layout = composeParagraph(runs, 120, measure, 'en')!
    expect(layout).not.toBeNull()
    expect(layout.lineCount).toBeGreaterThan(1)
    expect(layout.runs.flat().some((piece) => piece.kind === 'hyphen')).toBe(true)
    runs.forEach((source, index) => {
      const ranges = layout.runs[index].filter((piece) => piece.to > piece.from)
      expect(ranges.map((piece) => source.text.slice(piece.from, piece.to)).join('')).toBe(source.text)
      expect(ranges.every((piece, i) => piece.from === (ranges[i - 1]?.to ?? 0))).toBe(true)
    })
  })

  it('keeps atomic objects at their source position and allows breaks on either side', () => {
    const runs = [run('First equation '), { ...run('\ufffc'), atomicWidth: 100 }, run(' followed by more text.')]
    const layout = composeParagraph(runs, 150, measure)!
    expect(layout).not.toBeNull()
    expect(layout.runs[1].filter((piece) => piece.kind === 'atomic')).toEqual([
      { kind: 'atomic', from: 0, to: 1, width: 100 }
    ])
    expect(layout.runs.flat().filter((piece) => piece.kind === 'break').length).toBeGreaterThan(0)
  })

  it('does not introduce spaces or illegal punctuation breaks in Chinese', () => {
    const source = '阅读文章时，关注内容（包括标点规则），让文字清晰、均匀。中文排版不能把句号放在行首。'
    const layout = composeParagraph([run(source)], 88, measure)!
    expect(layout).not.toBeNull()
    const breaks = layout.runs[0].filter((piece) => piece.kind === 'break')
    expect(breaks.length).toBeGreaterThan(0)
    for (const piece of breaks) {
      expect('，。）、'.includes(source[piece.from])).toBe(false)
      expect(source[piece.from - 1]).not.toBe('（')
    }
    expect(layout.runs[0].filter((piece) => piece.kind === 'space').every((piece) => piece.from === piece.to)).toBe(
      true
    )
  })

  it.each([0, 20])('falls back when an indivisible object cannot fit at width %i', (width) => {
    expect(composeParagraph([run('Math '), { ...run('\ufffc'), atomicWidth: 100 }], width, measure)).toBeNull()
  })

  it.each(['a'.repeat(MAX_PARAGRAPH_LENGTH + 1), 'مرحبا بالعالم', 'soft\u00adhyphen'])(
    'preserves unsupported input through native fallback',
    (source) => {
      expect(composeParagraph([run(source)], 300, measure)).toBeNull()
    }
  )
})
