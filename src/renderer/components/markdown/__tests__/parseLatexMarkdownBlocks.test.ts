import { describe, expect, it } from 'vitest'

import { createLatexMarkdownBlockParser } from '../parseLatexMarkdownBlocks'

describe('LaTeX streaming blocks', () => {
  it('keeps newly closed formulas together as a message grows and is edited', () => {
    const parse = createLatexMarkdownBlockParser()
    const first = '\\[\nx\n=\n\ny\n\\]'
    const second = '\\[\na\n=\n\nb\n\\]'

    parse(`Intro\n\n${first.slice(0, -2)}`)
    for (const source of [
      `Intro\n\n${first}\n\nAfter`,
      `Intro\n\n${first}\n\nAfter more text`,
      `Intro\n\n${first}\n\n${second}\n\nAfter`,
      `Edited introduction\n\n${first}\n\nAfter`
    ]) {
      const blocks = parse(source)
      expect(blocks.join('')).toBe(source)
      expect(blocks.some((block) => block.includes(first))).toBe(true)
      if (source.includes(second)) expect(blocks.some((block) => block.includes(second))).toBe(true)
    }
  })

  it('rechecks the closing line when appended text makes the delimiter inline', () => {
    const parse = createLatexMarkdownBlockParser()
    const formula = '\\[\nx\n=\n\ny\n\\]'

    expect(parse(formula)).toEqual([formula])
    const source = `${formula} ordinary text`
    const blocks = parse(source)
    expect(blocks.join('')).toBe(source)
    expect(blocks.some((block) => block.includes(formula))).toBe(false)
  })

  it('preserves Markdown containers and literal delimiters in fenced code', () => {
    const parse = createLatexMarkdownBlockParser()
    const quote = '> \\[\n> x\n> =\n> \n> y\n> \\]'
    const code = '```text\n\\[\nx\n=\n\ny\n\\]\n```'
    const source = `${quote}\n\n${code}\n\nAfter`
    const blocks = parse(source)

    expect(blocks.join('')).toBe(source)
    expect(blocks.some((block) => block.includes(quote))).toBe(true)
    expect(blocks.some((block) => block.includes(code))).toBe(true)
  })
})
