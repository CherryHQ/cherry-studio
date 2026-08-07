import { describe, expect, it } from 'vitest'

import { buildMcpPromptPlaceholderArgs, flattenMcpPromptMessages } from '../mcpPromptTool'

describe('buildMcpPromptPlaceholderArgs', () => {
  it('maps every declared argument to its ${name} marker', () => {
    expect(
      buildMcpPromptPlaceholderArgs({
        arguments: [{ name: 'language', required: true }, { name: 'style' }]
      })
    ).toEqual({ language: '${language}', style: '${style}' })
  })

  it('sends no args for a prompt that declares none', () => {
    expect(buildMcpPromptPlaceholderArgs({ arguments: [] })).toBeUndefined()
    expect(buildMcpPromptPlaceholderArgs({})).toBeUndefined()
  })
})

describe('flattenMcpPromptMessages', () => {
  it('joins text parts in order and drops parts with no composer form', () => {
    const result = flattenMcpPromptMessages({
      messages: [
        { role: 'user', content: { type: 'text', text: 'Review ${language}' } },
        { role: 'user', content: { type: 'image', data: 'AAAA' } },
        { role: 'assistant', content: { type: 'text', text: 'in ${style} style' } }
      ]
    })

    expect(result).toBe('Review ${language}\n\nin ${style} style')
  })

  it('returns an empty string for a malformed or empty result', () => {
    expect(flattenMcpPromptMessages(undefined)).toBe('')
    expect(flattenMcpPromptMessages({ messages: [] })).toBe('')
    expect(flattenMcpPromptMessages({ messages: [{ content: { type: 'image' } }] })).toBe('')
  })
})
