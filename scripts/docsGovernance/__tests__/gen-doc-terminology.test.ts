import { describe, expect, it } from 'vitest'

import { generateTerminology } from '../gen-doc-terminology'

describe('generateTerminology', () => {
  it('renders protected names and sorted bilingual terms', () => {
    const output = generateTerminology({
      doNotTranslate: ['Cherry Studio'],
      terms: {
        Provider: { 'zh-cn': '提供商', note: 'A model vendor.' },
        Agent: { 'zh-cn': '智能体', note: 'An autonomous tool user.' }
      }
    })
    expect(output).toContain('- Cherry Studio')
    expect(output.indexOf('| Agent |')).toBeLessThan(output.indexOf('| Provider |'))
  })

  it('rejects terms without a Chinese rendering', () => {
    expect(() => generateTerminology({ doNotTranslate: [], terms: { Agent: { note: 'Missing.' } } })).toThrow(
      'missing zh-cn'
    )
  })

  it.each([null, false, 42, [], { 'zh-cn': '智能体', note: '  ' }])(
    'rejects an unreadable term with its key',
    (term) => {
      expect(() => generateTerminology({ doNotTranslate: [], terms: { Agent: term } })).toThrow('Agent:')
    }
  )

  it('preserves whitespace, escaped Markdown and own prototype-named term keys', () => {
    const glossary = JSON.parse(
      '{"doNotTranslate":[],"terms":{"__proto__":{"zh-cn":" 原型 ","note":"Keep | pipes\\nand lines"}}}'
    )
    const output = generateTerminology(glossary)

    expect(output).toContain('| __proto__ |  原型  | Keep \\| pipes and lines |')
  })

  it.each([null, [], { doNotTranslate: [42], terms: {} }, { doNotTranslate: [], terms: [] }])(
    'rejects malformed glossary containers',
    (glossary) => {
      expect(() => generateTerminology(glossary)).toThrow()
    }
  )
})
