import type { MessageCreateParams } from '@anthropic-ai/sdk/resources/messages'
import { describe, expect, it } from 'vitest'

import { stripAnthropicBillingHeader } from '../anthropicBillingHeader'

const makeParams = (overrides: Partial<MessageCreateParams> = {}): MessageCreateParams => ({
  model: 'custom:deepseek',
  max_tokens: 1024,
  messages: [{ role: 'user', content: 'hi' }],
  ...overrides
})

describe('stripAnthropicBillingHeader', () => {
  it('drops a standalone billing-header block while keeping subsequent system blocks and cache_control', () => {
    const params = makeParams({
      system: [
        { type: 'text', text: 'x-anthropic-billing-header: cc_version=2.2.3; cc_entrypoint=sdk-ts;' },
        { type: 'text', text: 'You are Claude Code.', cache_control: { type: 'ephemeral' } }
      ]
    })

    expect(stripAnthropicBillingHeader(params).system).toEqual([
      { type: 'text', text: 'You are Claude Code.', cache_control: { type: 'ephemeral' } }
    ])
  })

  it('strips leading billing-header lines and trailing blank lines from multi-line text blocks and strings', () => {
    const blockParams = makeParams({
      system: [
        {
          type: 'text',
          text: 'x-anthropic-billing-header: cc_version=2.2.3\r\n\r\nYou are Claude Code.',
          cache_control: { type: 'ephemeral' }
        }
      ]
    })
    expect(stripAnthropicBillingHeader(blockParams).system).toEqual([
      { type: 'text', text: 'You are Claude Code.', cache_control: { type: 'ephemeral' } }
    ])

    const stringParams = makeParams({
      system: 'x-anthropic-billing-header: cc_version=2.2.3\n\nYou are Claude Code.'
    })
    expect(stripAnthropicBillingHeader(stringParams).system).toBe('You are Claude Code.')
  })

  it('clears system to undefined when only the billing-header line was present', () => {
    expect(
      stripAnthropicBillingHeader(makeParams({ system: 'x-anthropic-billing-header: cc_version=2.2.3' })).system
    ).toBeUndefined()
    expect(
      stripAnthropicBillingHeader(
        makeParams({ system: [{ type: 'text', text: 'x-anthropic-billing-header: cc_version=2.2.3' }] })
      ).system
    ).toBeUndefined()
  })

  it('leaves normal system prompts, mid-prompt mentions, and user/assistant messages untouched', () => {
    const params = makeParams({
      system: 'You are Claude Code.\nNever forward x-anthropic-billing-header: to relays.',
      messages: [
        { role: 'user', content: 'x-anthropic-billing-header: cc_version=2.2.3\nWhy did this fail?' },
        { role: 'assistant', content: 'x-anthropic-billing-header: explained' }
      ]
    })

    expect(stripAnthropicBillingHeader(params)).toBe(params)
  })

  it('strips billing-header lines from inline system messages without touching user turns', () => {
    const params = makeParams({
      messages: [
        { role: 'user', content: 'hello' },
        { role: 'system', content: 'x-anthropic-billing-header: cc_version=2.2.3' }
      ] as MessageCreateParams['messages']
    })

    expect(stripAnthropicBillingHeader(params).messages).toEqual([{ role: 'user', content: 'hello' }])
  })
})
