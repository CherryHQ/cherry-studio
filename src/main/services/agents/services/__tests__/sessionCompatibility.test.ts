import { describe, expect, it } from 'vitest'

import { canResumeClaudeSession } from '../claudecode/sessionCompatibility'

describe('canResumeClaudeSession', () => {
  it('allows resuming when the provider stays the same', () => {
    expect(canResumeClaudeSession('openai:gpt-4o', 'openai:gpt-4.1')).toBe(true)
  })

  it('blocks resuming when the provider changes', () => {
    expect(canResumeClaudeSession('openai:gpt-4o', 'minimax:abab6.5')).toBe(false)
  })

  it('blocks resuming when the previous model metadata is missing', () => {
    expect(canResumeClaudeSession('openai:gpt-4o', undefined)).toBe(false)
  })
})
