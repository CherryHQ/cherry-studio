import type { MessageCreateParams } from '@anthropic-ai/sdk/resources/messages'
import { describe, expect, it } from 'vitest'

import { MINIMAL_CHERRY_SUPPORT_INSTRUCTIONS, normalizeAnthropicSupportSystemPrompt } from '../supportPrompt'

function createParams(system: MessageCreateParams['system']): MessageCreateParams {
  return {
    model: 'claude-opus-5',
    max_tokens: 1,
    messages: [],
    system
  }
}

describe('normalizeAnthropicSupportSystemPrompt', () => {
  it('keeps the explicit non-human boundary in the minimal Support identity', () => {
    expect(MINIMAL_CHERRY_SUPPORT_INSTRUCTIONS).toContain('not a human employee')
  })

  it('removes a later exact SDK identity from a string without a bundled Support marker', () => {
    const params = createParams(
      ['Runtime context', 'You are Claude Code, Anthropic official CLI for Claude.', 'Workspace instructions'].join(
        '\n\n'
      )
    )

    expect(normalizeAnthropicSupportSystemPrompt(params).system).toBe(
      [MINIMAL_CHERRY_SUPPORT_INSTRUCTIONS, 'Runtime context', 'Workspace instructions'].join('\n\n')
    )
  })

  it('preserves text after an earlier SDK identity when another SDK identity follows', () => {
    const params = createParams(
      [
        'You are Claude Code, Anthropic official CLI for Claude.\nKeep this workspace instruction.',
        "You are a Claude agent, built on Anthropic's Claude Agent SDK."
      ].join('\n\n')
    )

    expect(normalizeAnthropicSupportSystemPrompt(params).system).toBe(
      [MINIMAL_CHERRY_SUPPORT_INSTRUCTIONS, 'Keep this workspace instruction.'].join('\n\n')
    )
  })

  it('removes a later exact SDK identity from blocks without a bundled Support marker', () => {
    const params = createParams([
      { type: 'text', text: 'Runtime context' },
      { type: 'text', text: 'You are Claude Code, Anthropic official CLI for Claude.' },
      { type: 'text', text: 'Workspace instructions' }
    ])

    expect(normalizeAnthropicSupportSystemPrompt(params).system).toEqual([
      { type: 'text', text: MINIMAL_CHERRY_SUPPORT_INSTRUCTIONS },
      { type: 'text', text: 'Runtime context' },
      { type: 'text', text: 'Workspace instructions' }
    ])
  })

  it('removes an SDK identity after Cherry Support in a string while preserving later context', () => {
    const params = createParams(
      [
        MINIMAL_CHERRY_SUPPORT_INSTRUCTIONS,
        "You are a Claude agent, built on Anthropic's Claude Agent SDK.",
        'Workspace instructions'
      ].join('\n\n')
    )

    expect(normalizeAnthropicSupportSystemPrompt(params).system).toBe(
      [MINIMAL_CHERRY_SUPPORT_INSTRUCTIONS, 'Workspace instructions'].join('\n\n')
    )
  })

  it('removes an SDK identity after Cherry Support in blocks while preserving later context', () => {
    const params = createParams([
      { type: 'text', text: MINIMAL_CHERRY_SUPPORT_INSTRUCTIONS },
      { type: 'text', text: "You are a Claude agent, built on Anthropic's Claude Agent SDK." },
      { type: 'text', text: 'Workspace instructions' }
    ])

    expect(normalizeAnthropicSupportSystemPrompt(params).system).toEqual([
      { type: 'text', text: MINIMAL_CHERRY_SUPPORT_INSTRUCTIONS },
      { type: 'text', text: 'Workspace instructions' }
    ])
  })
})
