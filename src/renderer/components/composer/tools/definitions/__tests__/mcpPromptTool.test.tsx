import { describe, expect, it } from 'vitest'

import {
  buildMcpPromptPlaceholderArgs,
  createMcpPromptNonce,
  flattenMcpPromptMessages,
  renderMcpPromptSegmentsAsText,
  splitMcpPromptText
} from '../mcpPromptTool'

const NONCE = 'abc12345'

describe('buildMcpPromptPlaceholderArgs', () => {
  it('sends a marker for required arguments only, so optional defaults survive', () => {
    const args = buildMcpPromptPlaceholderArgs(
      { arguments: [{ name: 'language', required: true }, { name: 'style' }] },
      NONCE
    )

    expect(args).toEqual({ language: `«cs-arg:${NONCE}:language»` })
    expect(args).not.toHaveProperty('style')
  })

  it('sends no args at all when nothing is required', () => {
    expect(buildMcpPromptPlaceholderArgs({ arguments: [{ name: 'style' }] }, NONCE)).toBeUndefined()
    expect(buildMcpPromptPlaceholderArgs({ arguments: [] }, NONCE)).toBeUndefined()
    expect(buildMcpPromptPlaceholderArgs({}, NONCE)).toBeUndefined()
  })

  it('mints a fresh nonce per insertion', () => {
    expect(createMcpPromptNonce()).not.toBe(createMcpPromptNonce())
  })
})

describe('splitMcpPromptText', () => {
  it('turns this insertion’s markers into fields', () => {
    const text = `Review «cs-arg:${NONCE}:language» carefully`

    expect(splitMcpPromptText(text, NONCE)).toEqual([
      { type: 'text', value: 'Review ' },
      { type: 'argument', name: 'language' },
      { type: 'text', value: ' carefully' }
    ])
  })

  it('leaves the server’s own ${...} expressions as literal text', () => {
    const text = 'Run echo ${HOME} and ${{ github.sha }}'

    expect(splitMcpPromptText(text, NONCE)).toEqual([{ type: 'text', value: text }])
  })

  it('ignores a marker minted for a different insertion', () => {
    const text = `stale «cs-arg:deadbeef:language» marker`

    expect(splitMcpPromptText(text, NONCE)).toEqual([{ type: 'text', value: text }])
  })
})

describe('renderMcpPromptSegmentsAsText', () => {
  it('falls back to ${name} holes for composers with no token support', () => {
    expect(
      renderMcpPromptSegmentsAsText([
        { type: 'text', value: 'Review ' },
        { type: 'argument', name: 'language' }
      ])
    ).toBe('Review ${language}')
  })
})

describe('flattenMcpPromptMessages', () => {
  it('joins text parts in order and drops parts with no composer form', () => {
    const result = flattenMcpPromptMessages({
      messages: [
        { role: 'user', content: { type: 'text', text: 'Review this' } },
        { role: 'user', content: { type: 'image', data: 'AAAA' } },
        { role: 'assistant', content: { type: 'text', text: 'in detail' } }
      ]
    })

    expect(result).toBe('Review this\n\nin detail')
  })

  it('returns an empty string for a malformed or empty result', () => {
    expect(flattenMcpPromptMessages(undefined)).toBe('')
    expect(flattenMcpPromptMessages({ messages: [] })).toBe('')
    expect(flattenMcpPromptMessages({ messages: [{ content: { type: 'image' } }] })).toBe('')
  })
})
