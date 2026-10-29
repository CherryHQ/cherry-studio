import katex from 'katex'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { findComposerMathCandidates, serializeComposerMath, transformComposerMathTextRun } from '../composerMath'

function transform(text: string) {
  return transformComposerMathTextRun(text, [{ from: 0, to: text.length }])
}

afterEach(() => vi.restoreAllMocks())

describe('composer inline math', () => {
  it('serializes the exact source, including empty latex', () => {
    expect(serializeComposerMath('x + y')).toBe('$x + y$')
    expect(serializeComposerMath('')).toBe('$$')
    expect(serializeComposerMath(' x ')).toBe('$ x $')
  })

  it('converts a complete formula and reports the source span', () => {
    expect(transform('$x$')).toEqual([{ type: 'inlineMath', latex: 'x', from: 0, to: 3 }])
    expect(findComposerMathCandidates('see $x$')).toEqual([{ latex: 'x', from: 4, to: 7 }])
  })

  it('finds a formula after an escaped currency prefix', () => {
    const escapedMoney = String.raw`\$5 and $x$`
    expect(escapedMoney.length).toBe(11)
    expect(findComposerMathCandidates(escapedMoney)).toEqual([{ latex: 'x', from: 8, to: 11 }])
  })

  it('keeps the formula after an escaped pair whose body is followed by a digit', () => {
    const text = String.raw`\$x$5 and $y$`
    expect(text.length).toBe(13)
    expect(findComposerMathCandidates(text)).toEqual([{ latex: 'y', from: 10, to: 13 }])
  })

  it('does not let a released closer re-pair the digits of an escaped pair', () => {
    const text = String.raw`\$x$5$y$`
    expect(text.length).toBe(8)
    expect(findComposerMathCandidates(text)).toEqual([{ latex: 'y', from: 5, to: 8 }])
  })

  it.each([
    { from: 0, to: 11 },
    { from: 8, to: 11 }
  ])('converts a formula after escaped currency within range %j', (range) => {
    const escapedMoney = String.raw`\$5 and $x$`
    expect(escapedMoney.length).toBe(11)
    expect(transformComposerMathTextRun(escapedMoney, [range])).toEqual([
      { type: 'text', text: String.raw`\$5 and ` },
      { type: 'inlineMath', latex: 'x', from: 8, to: 11 }
    ])
    const currencyOnly = String.raw`\$5 and 6`
    expect(currencyOnly.length).toBe(9)
    expect(transformComposerMathTextRun(currencyOnly, [{ from: 0, to: 9 }])).toEqual([
      { type: 'text', text: currencyOnly }
    ])
  })

  it('preserves English and Chinese text immediately surrounding a formula', () => {
    expect(transform('A$x$B')).toEqual([
      { type: 'text', text: 'A' },
      { type: 'inlineMath', latex: 'x', from: 1, to: 4 },
      { type: 'text', text: 'B' }
    ])
    expect(transform('计算$x$的值')).toEqual([
      { type: 'text', text: '计算' },
      { type: 'inlineMath', latex: 'x', from: 2, to: 5 },
      { type: 'text', text: '的值' }
    ])
    expect(transform('1_$x$')).toEqual([
      { type: 'text', text: '1_' },
      { type: 'inlineMath', latex: 'x', from: 2, to: 5 }
    ])
  })

  it('preserves internal whitespace and multiple formula spans', () => {
    expect(transform('$x + y$ and $z$')).toEqual([
      { type: 'inlineMath', latex: 'x + y', from: 0, to: 7 },
      { type: 'text', text: ' and ' },
      { type: 'inlineMath', latex: 'z', from: 12, to: 15 }
    ])
    expect(transform('$x  +\ty$')).toEqual([{ type: 'inlineMath', latex: 'x  +\ty', from: 0, to: 8 }])
  })

  it('accepts a valid long formula below 600 characters', () => {
    const latex = 'x+'.repeat(250) + 'y'
    expect(transform(`$${latex}$`)).toEqual([{ type: 'inlineMath', latex, from: 0, to: 503 }])
  })

  it('keeps invalid or excluded source byte for byte without trimming', () => {
    for (const text of [
      '$$x$$',
      '$x',
      '$x^',
      '$ x $',
      '$ x$',
      '$x $',
      '$\tx$',
      '$x\t$',
      '$5 and $10',
      '$x$2',
      String.raw`\$x$`,
      String.raw`$x\$`,
      String.raw`\\\$x$`,
      '$x^{$',
      String.raw`$\notARealCommand$`,
      '${x}$',
      '$a${x}$',
      '$x\ny$',
      '$x\ry$'
    ]) {
      expect(transform(text), text).toEqual([{ type: 'text', text }])
      expect(findComposerMathCandidates(text), text).toEqual([])
    }
  })

  it('does not validate unclosed math or candidates outside the changed ranges', () => {
    const render = vi.spyOn(katex, 'renderToString')
    expect(transform('$x^')).toEqual([{ type: 'text', text: '$x^' }])
    expect(transformComposerMathTextRun('$x$ tail', [{ from: 5, to: 8 }])).toEqual([{ type: 'text', text: '$x$ tail' }])
    expect(render).not.toHaveBeenCalled()
  })

  it('retains even backslashes before either delimiter', () => {
    expect(transform(String.raw`\\$x$`)).toEqual([
      { type: 'text', text: String.raw`\\` },
      { type: 'inlineMath', latex: 'x', from: 2, to: 5 }
    ])
    expect(transform(String.raw`$x\\$`)).toEqual([{ type: 'inlineMath', latex: String.raw`x\\`, from: 0, to: 5 }])
  })

  it('continues scanning after rejected whitespace, escaped, and invalid candidates', () => {
    expect(transform('$ x $a$b$')).toEqual([
      { type: 'text', text: '$ x $a' },
      { type: 'inlineMath', latex: 'b', from: 6, to: 9 }
    ])
    const text = String.raw`\$x$ $\notARealCommand$ $y$`
    expect(transform(text)).toEqual([
      { type: 'text', text: String.raw`\$x$ $\notARealCommand$ ` },
      { type: 'inlineMath', latex: 'y', from: 24, to: 27 }
    ])
  })

  it('cannot join formulas across separate text runs at hard breaks or tokens', () => {
    expect(transform('$x')).toEqual([{ type: 'text', text: '$x' }])
    expect(transform('y$')).toEqual([{ type: 'text', text: 'y$' }])
  })

  it('converts only affected candidates and merges the remaining text', () => {
    expect(transformComposerMathTextRun('$x$ and $y$ tail', [{ from: 9, to: 10 }])).toEqual([
      { type: 'text', text: '$x$ and ' },
      { type: 'inlineMath', latex: 'y', from: 8, to: 11 },
      { type: 'text', text: ' tail' }
    ])
    expect(transformComposerMathTextRun('$x$ and $y$', [])).toEqual([{ type: 'text', text: '$x$ and $y$' }])
    expect(transform('')).toEqual([])
  })

  it('includes zero-width and nonempty changes touching either source boundary', () => {
    for (const range of [
      { from: 0, to: 0 },
      { from: 3, to: 3 },
      { from: 3, to: 5 }
    ]) {
      expect(transformComposerMathTextRun('$x$ tail', [range])).toEqual([
        { type: 'inlineMath', latex: 'x', from: 0, to: 3 },
        { type: 'text', text: ' tail' }
      ])
    }
    expect(transformComposerMathTextRun('a $x$', [{ from: 0, to: 2 }])).toEqual([
      { type: 'text', text: 'a ' },
      { type: 'inlineMath', latex: 'x', from: 2, to: 5 }
    ])
  })
})
