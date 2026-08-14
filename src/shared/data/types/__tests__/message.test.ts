import { describe, expect, it } from 'vitest'

import { coerceSearchRole, MessageDataSchema, TOPIC_MESSAGE_SEARCH_ROLES } from '../message'

describe('coerceSearchRole', () => {
  it('returns the role only when it is in the allowed search role set', () => {
    expect(coerceSearchRole('assistant', TOPIC_MESSAGE_SEARCH_ROLES)).toBe('assistant')
    expect(coerceSearchRole('system', TOPIC_MESSAGE_SEARCH_ROLES)).toBeUndefined()
    expect(coerceSearchRole('tool', TOPIC_MESSAGE_SEARCH_ROLES)).toBeUndefined()
  })
})

describe('MessageDataSchema', () => {
  it('accepts persisted assistant turn options', () => {
    expect(
      MessageDataSchema.safeParse({
        parts: [],
        turnOptions: { reasoningEffort: 'high', fastMode: true }
      }).success
    ).toBe(true)
  })

  it('rejects invalid persisted assistant turn options', () => {
    expect(MessageDataSchema.safeParse({ parts: [], turnOptions: { reasoningEffort: 'turbo' } }).success).toBe(false)
    expect(MessageDataSchema.safeParse({ parts: [], turnOptions: { fastMode: 'true' } }).success).toBe(false)
  })
})
