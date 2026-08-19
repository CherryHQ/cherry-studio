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
})
