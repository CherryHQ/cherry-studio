import { describe, expect, it } from 'vitest'

import { extractStaleConversationId, isStaleResumeError } from '../staleResume'

describe('isStaleResumeError', () => {
  it('matches the exact SDK wording', () => {
    expect(isStaleResumeError(new Error('No conversation found with session ID: abc'))).toBe(true)
  })

  it('finds the text inside errors array and cause chain', () => {
    const wrapped = new Error('query failed') as Error & { errors: unknown[] }
    wrapped.errors = [{ code: 1 }, 'No conversation found with session ID: stale']
    expect(isStaleResumeError(wrapped)).toBe(true)

    const outer = new Error('outer')
    ;(outer as Error & { cause: unknown }).cause = new Error('inner: No conversation found with session ID: x')
    expect(isStaleResumeError(outer)).toBe(true)
  })

  it('matches plain payload shapes', () => {
    expect(isStaleResumeError({ message: 'No conversation found with session ID: abc' })).toBe(true)
    expect(isStaleResumeError({ errors: ['No conversation found with session ID: abc'] })).toBe(true)
  })

  it('rejects unrelated errors', () => {
    expect(isStaleResumeError(new Error('tool_use ids must be unique'))).toBe(false)
    expect(isStaleResumeError(null)).toBe(false)
    expect(isStaleResumeError(undefined)).toBe(false)
  })
})

describe('extractStaleConversationId', () => {
  it('extracts the trailing id', () => {
    expect(extractStaleConversationId(new Error('No conversation found with session ID: abc'))).toBe('abc')
  })

  it('strips trailing delimiters from wrapped messages', () => {
    expect(extractStaleConversationId(new Error('query failed (No conversation found with session ID: abc)'))).toBe(
      'abc'
    )
    expect(extractStaleConversationId('No conversation found with session ID: stale-token.')).toBe('stale-token')
    expect(extractStaleConversationId('No conversation found with session ID: "quoted-id", retry')).toBe('quoted-id')
    expect(extractStaleConversationId('No conversation found with session ID: abc]')).toBe('abc')
    expect(extractStaleConversationId('No conversation found with session ID: <abc>')).toBe('abc')
    expect(extractStaleConversationId('No conversation found with session ID: {abc}')).toBe('abc')
  })

  it('finds the id inside errors array and cause chain', () => {
    const wrapped = new Error('query failed') as Error & { errors: unknown[] }
    wrapped.errors = ['No conversation found with session ID: from-errors']
    expect(extractStaleConversationId(wrapped)).toBe('from-errors')

    const outer = new Error('outer')
    ;(outer as Error & { cause: unknown }).cause = new Error('inner: No conversation found with session ID: from-cause')
    expect(extractStaleConversationId(outer)).toBe('from-cause')
  })

  it('returns undefined when no id is present', () => {
    expect(extractStaleConversationId(new Error('No conversation found with session ID'))).toBeUndefined()
    expect(extractStaleConversationId(new Error('tool_use ids must be unique'))).toBeUndefined()
    expect(extractStaleConversationId(null)).toBeUndefined()
  })
})
