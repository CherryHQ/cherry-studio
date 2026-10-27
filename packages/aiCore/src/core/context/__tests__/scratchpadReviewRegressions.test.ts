import { describe, expect, it } from 'vitest'

import { ContextPrompts } from '../prompts'
import { maskIndentedCodeBlocks, maskIndentedCodeBlocksReference, stripModelScratchpadBlocks } from '../scratchpadText'

// cherry-review findings on head ce6f904e6b (heading boundary, quoted-list
// ownership, placeholder exhaustion). Each input was clean on the merge base.
describe('scratchpad strip review regressions', () => {
  it('keeps indented code after an unindented heading that follows a list', () => {
    const input = '- A\n# H\n    <thinking>literal</thinking>\n'
    expect(stripModelScratchpadBlocks(input)).toBe('- A\n# H\n    <thinking>literal</thinking>')
  })

  it('keeps indented code after an unindented thematic break that follows a list', () => {
    const input = '- A\n***\n    <thinking>literal</thinking>\n'
    expect(stripModelScratchpadBlocks(input)).toBe('- A\n***\n    <thinking>literal</thinking>')
  })

  it('still strips a paragraph tag indented under a list item', () => {
    expect(stripModelScratchpadBlocks('- A\n  <thinking>x</thinking> tail\n')).toBe('- A\n   tail')
  })

  it('does not keep private analysis inside a quoted list that starts outside an earlier list', () => {
    const input = '- A\n> - A\n>     <analysis>SECRET</analysis>\n\n<summary>Public</summary>'
    const out = stripModelScratchpadBlocks(input)
    expect(out).not.toContain('SECRET')
    expect(out).toContain('<summary>Public</summary>')
  })

  it('keeps a quote nested inside the outer list item owning it', () => {
    const input = '- A\n\n  > - B\n\n  >     <analysis>keep</analysis>\n'
    expect(stripModelScratchpadBlocks(input)).toContain('<analysis>keep</analysis>')
  })

  it('preserves literal placeholder tokens when all four preferred bases occur in the input', () => {
    const tokens = ['\uE000', '\uE002', '\uE004', '\uE006'].map((b) => `${b}INLINE_CODE_0\uE001`).join(' ')
    const input = `${tokens} \`code\` tail`
    expect(stripModelScratchpadBlocks(input)).toBe(input)
  })

  it('stays collision-free when every single-character placeholder base occurs literally', () => {
    const occupied = (kind: string) => {
      let out = ''
      for (let code = 0xe000; code < 0xf8ff; code += 2) out += `${String.fromCharCode(code)}${kind}_0\uE001`
      return out
    }
    for (const [kind, body, expected] of [
      ['INLINE_CODE', '`code` tail', '`code` tail'],
      [
        'CODE_FENCE',
        '\n```\n<thinking>x</thinking>\n```\n<thinking>y</thinking> tail',
        '\n```\n<thinking>x</thinking>\n```\n tail'
      ],
      [
        'INDENTED_CODE',
        '\n\n    <thinking>x</thinking>\n\n<thinking>y</thinking>tail',
        '\n\n    <thinking>x</thinking>\n\ntail'
      ]
    ] as const) {
      const literal = occupied(kind)
      expect(stripModelScratchpadBlocks(literal + body)).toBe(literal + expected)
    }
  })

  it('formatCompactSummary pins the exact output for the reviewer inputs', () => {
    const f = ContextPrompts.formatCompactSummary
    // Heading keeps its literal indented code.
    expect(f('- A\n# H\n    <thinking>literal</thinking>\n')).toBe('- A\n# H\n    <thinking>literal</thinking>')
    // Private analysis is removed. The summary tags stay because the PR only unwraps a
    // summary that wraps the whole output (the merge base used a naive regex extraction
    // and returned the bare "Public").
    expect(f('- A\n> - A\n>     <analysis>SECRET</analysis>\n\n<summary>Public</summary>')).toBe(
      '- A\n> - A\n>     \n\n<summary>Public</summary>'
    )
    // The input with no inner list marker is a quote holding indented code: preserved by design.
    expect(f('- A\n>     <analysis>kept</analysis>\n')).toBe('- A\n>     <analysis>kept</analysis>')
  })

  it('handles one-space, nested and setext heading shapes after a list', () => {
    const f = ContextPrompts.formatCompactSummary
    expect(f('- A\n # H\n    <thinking>x</thinking> tail\n')).toBe('- A\n # H\n    <thinking>x</thinking> tail')
    expect(f('- A\n  # H\n      <thinking>x</thinking> tail\n')).toBe('- A\n  # H\n      <thinking>x</thinking> tail')
    // A setext heading makes the following indented line a paragraph, so the tag is stripped.
    expect(f('- A\nH\n===\n    <thinking>x</thinking> tail\n')).toBe('- A\nH\n===\n     tail')
  })

  it('ownership: reference and stepped maskers agree and drop only unreached outer lists', () => {
    const cases: Array<[string, string]> = [
      ['- A\n  > - B\n  >     <analysis>q</analysis>\n', '- A\n  > - B\n  >'],
      ['1. A\n  > - B\n  >     <analysis>q</analysis>\n', '1. A\n  > - B\n  >'],
      ['> - A\n> > - B\n> >     <analysis>q</analysis>\n', '> - A\n> > - B\n> >'],
      ['- A\n>     <analysis>SECRET</analysis>\n', '- A\n>     <analysis>SECRET</analysis>']
    ]
    for (const [input, expected] of cases) {
      expect(maskIndentedCodeBlocks(input).text).toBe(maskIndentedCodeBlocksReference(input).text)
      expect(ContextPrompts.formatCompactSummary(input)).toBe(expected)
    }
  })

  it('placeholder allocation is collision-free for fence and indented kinds with closers and long runs', () => {
    const base = '\uE000'
    // Many literal tokens with a long run of the first base, for every mask kind.
    for (const [kind, body, expected] of [
      ['INLINE_CODE', '`code` tail', '`code` tail'],
      [
        'CODE_FENCE',
        '\n```\n<thinking>x</thinking>\n```\n<thinking>y</thinking> tail',
        '\n```\n<thinking>x</thinking>\n```\n tail'
      ],
      [
        'INDENTED_CODE',
        '\n\n    <thinking>x</thinking>\n\n<thinking>y</thinking>tail',
        '\n\n    <thinking>x</thinking>\n\ntail'
      ]
    ] as const) {
      let literal = ''
      let count = 0
      for (let code = 0xe000; code < 0xf8ff; code += 2, count++)
        literal += `${String.fromCharCode(code)}${kind}_0\uE001`
      // Every even private-use code point is a candidate base, 3200 of them: all occupied.
      expect(count).toBe(3200)
      literal += `${base.repeat(5)}${kind}_0\uE001${base.repeat(2)}${kind}_9\uE001`
      expect(stripModelScratchpadBlocks(literal + body)).toBe(literal + expected)
    }
  })

  it('keeps a long private-use run without a placeholder needle linear and intact', () => {
    const run = '\uE000'.repeat(300000) + 'x\uE001'.repeat(1000)
    const input = `${run} \`code\` tail`
    const start = performance.now()
    expect(stripModelScratchpadBlocks(input)).toBe(input)
    expect(performance.now() - start).toBeLessThan(5000)
  })

  it('round-trips literal multi-private-use CODE_FENCE tokens next to a real fence', () => {
    const lit = '\uE000\uE000CODE_FENCE_1\uE001'
    const all = ['\uE000', '\uE002', '\uE004', '\uE006'].map((b) => `${b}CODE_FENCE_1\uE001`).join('')
    const input = `${all}${lit}\n- A\n${lit}\n\n\`\`\`\n<thinking>x</thinking>\n\`\`\`\n<thinking>y</thinking> tail`
    const out = stripModelScratchpadBlocks(input)
    expect(out).toBe(`${all}${lit}\n- A\n${lit}\n\n\`\`\`\n<thinking>x</thinking>\n\`\`\`\n tail`)
  })
})
