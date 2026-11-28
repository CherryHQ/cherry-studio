import { describe, expect, it } from 'vitest'

import {
  advanceIndentedMaskState,
  initialIndentedMaskState,
  maskCodeFences,
  stripKnownModelScratchpadBlocksPreservingCodeFencesStepped
} from '../scratchpadText'

// Each expected occurrence was checked against markdown-it commonmark mode and CommonMark 0.31.2.
// The prefix ends on a complete line; the tail owns no previously emitted backtick.
const cases = [
  {
    prefix: 'x\n',
    tail: '`\n<analysis>MARK</analysis>\n`\n',
    literal: true
  },
  {
    prefix: 'x\n',
    tail: '`\n> <analysis>MARK</analysis>\n`\n',
    literal: false
  },
  {
    prefix: 'x\n',
    tail: '`\n  <analysis>MARK</analysis>\n`\n',
    literal: true
  },
  {
    prefix: 'x\n',
    tail: '    `\n    <analysis>MARK</analysis>\n    `\n',
    literal: true
  },
  {
    prefix: 'x\n',
    tail: '`<analysis>MARK</analysis>`\n',
    literal: true
  },
  {
    prefix: 'x\n',
    tail: '\n    <analysis>MARK</analysis>\n',
    literal: true
  },
  {
    prefix: 'x\n',
    tail: '\t<analysis>MARK</analysis>\n',
    literal: false
  },
  {
    prefix: 'x\n',
    tail: '```\n<analysis>MARK</analysis>\n```\n',
    literal: true
  },
  {
    prefix: 'x\n',
    tail: '`\n- <analysis>MARK</analysis>\n`\n',
    literal: false
  },
  {
    prefix: 'x\n',
    tail: '`\n> - <analysis>MARK</analysis>\n`\n',
    literal: false
  },
  {
    prefix: '> x\n',
    tail: '`\n<analysis>MARK</analysis>\n`\n',
    literal: true
  },
  {
    prefix: '> x\n',
    tail: '`\n> <analysis>MARK</analysis>\n`\n',
    literal: true
  },
  {
    prefix: '> x\n',
    tail: '`\n  <analysis>MARK</analysis>\n`\n',
    literal: true
  },
  {
    prefix: '> x\n',
    tail: '    `\n    <analysis>MARK</analysis>\n    `\n',
    literal: true
  },
  {
    prefix: '> x\n',
    tail: '`<analysis>MARK</analysis>`\n',
    literal: true
  },
  {
    prefix: '> x\n',
    tail: '\n    <analysis>MARK</analysis>\n',
    literal: true
  },
  {
    prefix: '> x\n',
    tail: '\t<analysis>MARK</analysis>\n',
    literal: false
  },
  {
    prefix: '> x\n',
    tail: '```\n<analysis>MARK</analysis>\n```\n',
    literal: true
  },
  {
    prefix: '> x\n',
    tail: '`\n- <analysis>MARK</analysis>\n`\n',
    literal: false
  },
  {
    prefix: '> x\n',
    tail: '`\n> - <analysis>MARK</analysis>\n`\n',
    literal: false
  },
  {
    prefix: '- x\n',
    tail: '`\n<analysis>MARK</analysis>\n`\n',
    literal: true
  },
  {
    prefix: '- x\n',
    tail: '`\n> <analysis>MARK</analysis>\n`\n',
    literal: false
  },
  {
    prefix: '- x\n',
    tail: '`\n  <analysis>MARK</analysis>\n`\n',
    literal: true
  },
  {
    prefix: '- x\n',
    tail: '    `\n    <analysis>MARK</analysis>\n    `\n',
    literal: true
  },
  {
    prefix: '- x\n',
    tail: '`<analysis>MARK</analysis>`\n',
    literal: true
  },
  {
    prefix: '- x\n',
    tail: '\n    <analysis>MARK</analysis>\n',
    literal: false
  },
  {
    prefix: '- x\n',
    tail: '\t<analysis>MARK</analysis>\n',
    literal: false
  },
  {
    prefix: '- x\n',
    tail: '```\n<analysis>MARK</analysis>\n```\n',
    literal: true
  },
  {
    prefix: '- x\n',
    tail: '`\n- <analysis>MARK</analysis>\n`\n',
    literal: false
  },
  {
    prefix: '- x\n',
    tail: '`\n> - <analysis>MARK</analysis>\n`\n',
    literal: false
  },
  {
    prefix: '> - x\n',
    tail: '`\n<analysis>MARK</analysis>\n`\n',
    literal: true
  },
  {
    prefix: '> - x\n',
    tail: '`\n> <analysis>MARK</analysis>\n`\n',
    literal: true
  },
  {
    prefix: '> - x\n',
    tail: '`\n  <analysis>MARK</analysis>\n`\n',
    literal: true
  },
  {
    prefix: '> - x\n',
    tail: '    `\n    <analysis>MARK</analysis>\n    `\n',
    literal: true
  },
  {
    prefix: '> - x\n',
    tail: '`<analysis>MARK</analysis>`\n',
    literal: true
  },
  {
    prefix: '> - x\n',
    tail: '\n    <analysis>MARK</analysis>\n',
    literal: true
  },
  {
    prefix: '> - x\n',
    tail: '\t<analysis>MARK</analysis>\n',
    literal: false
  },
  {
    prefix: '> - x\n',
    tail: '```\n<analysis>MARK</analysis>\n```\n',
    literal: true
  },
  {
    prefix: '> - x\n',
    tail: '`\n- <analysis>MARK</analysis>\n`\n',
    literal: false
  },
  {
    prefix: '> - x\n',
    tail: '`\n> - <analysis>MARK</analysis>\n`\n',
    literal: false
  },
  {
    prefix: '- > x\n',
    tail: '`\n<analysis>MARK</analysis>\n`\n',
    literal: true
  },
  {
    prefix: '- > x\n',
    tail: '`\n> <analysis>MARK</analysis>\n`\n',
    literal: false
  },
  {
    prefix: '- > x\n',
    tail: '`\n  <analysis>MARK</analysis>\n`\n',
    literal: true
  },
  {
    prefix: '- > x\n',
    tail: '    `\n    <analysis>MARK</analysis>\n    `\n',
    literal: true
  },
  {
    prefix: '- > x\n',
    tail: '`<analysis>MARK</analysis>`\n',
    literal: true
  },
  {
    prefix: '- > x\n',
    tail: '\n    <analysis>MARK</analysis>\n',
    literal: false
  },
  {
    prefix: '- > x\n',
    tail: '\t<analysis>MARK</analysis>\n',
    literal: false
  },
  {
    prefix: '- > x\n',
    tail: '```\n<analysis>MARK</analysis>\n```\n',
    literal: true
  },
  {
    prefix: '- > x\n',
    tail: '`\n- <analysis>MARK</analysis>\n`\n',
    literal: false
  },
  {
    prefix: '- > x\n',
    tail: '`\n> - <analysis>MARK</analysis>\n`\n',
    literal: false
  },
  {
    prefix: '> > x\n',
    tail: '`\n<analysis>MARK</analysis>\n`\n',
    literal: true
  },
  {
    prefix: '> > x\n',
    tail: '`\n> <analysis>MARK</analysis>\n`\n',
    literal: true
  },
  {
    prefix: '> > x\n',
    tail: '`\n  <analysis>MARK</analysis>\n`\n',
    literal: true
  },
  {
    prefix: '> > x\n',
    tail: '    `\n    <analysis>MARK</analysis>\n    `\n',
    literal: true
  },
  {
    prefix: '> > x\n',
    tail: '`<analysis>MARK</analysis>`\n',
    literal: true
  },
  {
    prefix: '> > x\n',
    tail: '\n    <analysis>MARK</analysis>\n',
    literal: true
  },
  {
    prefix: '> > x\n',
    tail: '\t<analysis>MARK</analysis>\n',
    literal: false
  },
  {
    prefix: '> > x\n',
    tail: '```\n<analysis>MARK</analysis>\n```\n',
    literal: true
  },
  {
    prefix: '> > x\n',
    tail: '`\n- <analysis>MARK</analysis>\n`\n',
    literal: false
  },
  {
    prefix: '> > x\n',
    tail: '`\n> - <analysis>MARK</analysis>\n`\n',
    literal: false
  },
  {
    prefix: '- x\n  - y\n',
    tail: '`\n<analysis>MARK</analysis>\n`\n',
    literal: true
  },
  {
    prefix: '- x\n  - y\n',
    tail: '`\n> <analysis>MARK</analysis>\n`\n',
    literal: false
  },
  {
    prefix: '- x\n  - y\n',
    tail: '`\n  <analysis>MARK</analysis>\n`\n',
    literal: true
  },
  {
    prefix: '- x\n  - y\n',
    tail: '    `\n    <analysis>MARK</analysis>\n    `\n',
    literal: true
  },
  {
    prefix: '- x\n  - y\n',
    tail: '`<analysis>MARK</analysis>`\n',
    literal: true
  },
  {
    prefix: '- x\n  - y\n',
    tail: '\n    <analysis>MARK</analysis>\n',
    literal: false
  },
  {
    prefix: '- x\n  - y\n',
    tail: '\t<analysis>MARK</analysis>\n',
    literal: false
  },
  {
    prefix: '- x\n  - y\n',
    tail: '```\n<analysis>MARK</analysis>\n```\n',
    literal: true
  },
  {
    prefix: '- x\n  - y\n',
    tail: '`\n- <analysis>MARK</analysis>\n`\n',
    literal: false
  },
  {
    prefix: '- x\n  - y\n',
    tail: '`\n> - <analysis>MARK</analysis>\n`\n',
    literal: false
  },
  {
    prefix: '> - x\n>   y\n',
    tail: '`\n<analysis>MARK</analysis>\n`\n',
    literal: true
  },
  {
    prefix: '> - x\n>   y\n',
    tail: '`\n> <analysis>MARK</analysis>\n`\n',
    literal: true
  },
  {
    prefix: '> - x\n>   y\n',
    tail: '`\n  <analysis>MARK</analysis>\n`\n',
    literal: true
  },
  {
    prefix: '> - x\n>   y\n',
    tail: '    `\n    <analysis>MARK</analysis>\n    `\n',
    literal: true
  },
  {
    prefix: '> - x\n>   y\n',
    tail: '`<analysis>MARK</analysis>`\n',
    literal: true
  },
  {
    prefix: '> - x\n>   y\n',
    tail: '\n    <analysis>MARK</analysis>\n',
    literal: true
  },
  {
    prefix: '> - x\n>   y\n',
    tail: '\t<analysis>MARK</analysis>\n',
    literal: false
  },
  {
    prefix: '> - x\n>   y\n',
    tail: '```\n<analysis>MARK</analysis>\n```\n',
    literal: true
  },
  {
    prefix: '> - x\n>   y\n',
    tail: '`\n- <analysis>MARK</analysis>\n`\n',
    literal: false
  },
  {
    prefix: '> - x\n>   y\n',
    tail: '`\n> - <analysis>MARK</analysis>\n`\n',
    literal: false
  }
]

describe('carried raw paragraph ownership', () => {
  it.each(cases)('keeps literal ownership after $prefix for $tail', ({ prefix, tail, literal }) => {
    const state = initialIndentedMaskState()
    advanceIndentedMaskState(state, maskCodeFences(prefix).text)
    const before = JSON.stringify(state)
    const output = stripKnownModelScratchpadBlocksPreservingCodeFencesStepped(tail, { initialMaskState: state })
    expect(output.includes('MARK')).toBe(literal)
    expect(JSON.stringify(state)).toBe(before)
  })
})
