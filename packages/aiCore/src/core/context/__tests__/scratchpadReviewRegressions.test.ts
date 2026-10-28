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
    // No wall-clock assertion (runner speed varies): the quadratic regex this guards against
    // ran past 100 s on this input, so the generous test timeout is the gate.
    expect(stripModelScratchpadBlocks(input)).toBe(input)
  }, 60000)

  it('round-trips literal multi-private-use CODE_FENCE tokens next to a real fence', () => {
    const lit = '\uE000\uE000CODE_FENCE_1\uE001'
    const all = ['\uE000', '\uE002', '\uE004', '\uE006'].map((b) => `${b}CODE_FENCE_1\uE001`).join('')
    const input = `${all}${lit}\n- A\n${lit}\n\n\`\`\`\n<thinking>x</thinking>\n\`\`\`\n<thinking>y</thinking> tail`
    const out = stripModelScratchpadBlocks(input)
    expect(out).toBe(`${all}${lit}\n- A\n${lit}\n\n\`\`\`\n<thinking>x</thinking>\n\`\`\`\n tail`)
  })
})

describe('HTML text body fence ownership', () => {
  it('does not let literal HTML in a real fence own later Markdown code', () => {
    const raw = '```\n<textarea>\n```\n\n```\n<analysis>literal</analysis>\n```\n<analysis>SECRET</analysis>'
    expect(ContextPrompts.formatCompactSummary(raw)).toBe(
      '```\n<textarea>\n```\n\n```\n<analysis>literal</analysis>\n```'
    )
  })
  it('formatCompactSummary removes analysis following literal text-element ticks', () => {
    for (const tag of ['textarea', 'script', 'style', 'title']) {
      const raw = `<${tag}>\n\`\`\`\n</${tag}>\n<analysis>SECRET</analysis>\n<summary>Public</summary>`
      expect(ContextPrompts.formatCompactSummary(raw)).toBe(`<${tag}>\n\`\`\`\n</${tag}>\n\n<summary>Public</summary>`)
    }
  })
})

describe('HTML body inline-tick ownership', () => {
  it('formatCompactSummary removes real analysis after closed literal bodies containing ticks', () => {
    for (const tag of ['textarea', 'script', 'style', 'title']) {
      expect(
        ContextPrompts.formatCompactSummary(
          `<summary>Keep<${tag}>\`</${tag}><analysis>SECRET</analysis> public \`x\`</summary>`
        )
      ).toBe(`Keep<${tag}>\`</${tag}> public \`x\``)
    }
  })
})

describe('literal body ownership boundaries', () => {
  it('keeps later actual code spans after code-literal HTML tags', () => {
    for (const lead of ['`<textarea>` ', '```\n<textarea>\n```\n\n']) {
      const raw = lead + '`<analysis>literal</analysis>` <analysis>SECRET</analysis>'
      expect(ContextPrompts.formatCompactSummary(raw)).toBe((lead + '`<analysis>literal</analysis>`').trim())
    }
  })
})

describe('summary fence HTML literal boundary', () => {
  it('strips real analysis after a fenced HTML opener', () => {
    const raw = '<summary>```html\n<textarea>\n```\n<analysis>SECRET</analysis> `<analysis>lit</analysis>`</summary>'
    expect(ContextPrompts.formatCompactSummary(raw)).toBe('```html\n<textarea>\n```\n `<analysis>lit</analysis>`')
    expect(ContextPrompts.formatCompactSummary(raw.replace('<summary>', '<summary>\n'))).toBe(
      '```html\n<textarea>\n```\n `<analysis>lit</analysis>`'
    )
  })
})

describe('inline body lookup scaling', () => {
  it('bounds repeated inline code with interleaved HTML', () => {
    const raw = '<summary>' + 'word `code` more <b>x</b> '.repeat(2000) + '</summary>'
    const start = performance.now()
    expect(ContextPrompts.formatCompactSummary(raw)).toBe(raw.slice(9, -10).trim())
    expect(performance.now() - start).toBeLessThan(1500)
  })
})

describe('summary envelope normalization order', () => {
  it('pins nested whole-envelope unwrapping before and after cleanup', () => {
    expect(ContextPrompts.formatCompactSummary('<summary><summary>Public</summary></summary>')).toBe('Public')
  })
})
