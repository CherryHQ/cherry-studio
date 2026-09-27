import { describe, expect, it } from 'vitest'

import {
  type CherryUIMessage,
  coerceSearchRole,
  isFailedAssistantMessage,
  MessageDataSchema,
  TOPIC_MESSAGE_SEARCH_ROLES
} from '../message'

describe('coerceSearchRole', () => {
  it('returns the role only when it is in the allowed search role set', () => {
    expect(coerceSearchRole('assistant', TOPIC_MESSAGE_SEARCH_ROLES)).toBe('assistant')
    expect(coerceSearchRole('system', TOPIC_MESSAGE_SEARCH_ROLES)).toBeUndefined()
    expect(coerceSearchRole('tool', TOPIC_MESSAGE_SEARCH_ROLES)).toBeUndefined()
  })
})

describe('isFailedAssistantMessage', () => {
  const assistant = (status: CherryUIMessage['metadata']['status'], parts: CherryUIMessage['parts']): CherryUIMessage =>
    ({
      id: 'a1',
      role: 'assistant',
      parts,
      metadata: { status }
    }) as CherryUIMessage

  it('matches error, paused, and empty assistant rows that are not pending', () => {
    expect(isFailedAssistantMessage(assistant('error', [{ type: 'text', text: 'x' }]))).toBe(true)
    expect(isFailedAssistantMessage(assistant('paused', [{ type: 'text', text: 'x' }]))).toBe(true)
    expect(isFailedAssistantMessage(assistant('success', []))).toBe(true)
  })

  it('excludes pending assistants and successful responses with content', () => {
    expect(isFailedAssistantMessage(assistant('pending', []))).toBe(false)
    expect(isFailedAssistantMessage(assistant('success', [{ type: 'text', text: 'ok' }]))).toBe(false)
  })
})

describe('MessageDataSchema', () => {
  it('accepts persisted assistant turn options', () => {
    expect(
      MessageDataSchema.safeParse({
        parts: [],
        turnOptions: { reasoningEffort: 'high', fastMode: true, serviceTier: 'flex' }
      }).success
    ).toBe(true)
  })

  it('rejects invalid persisted assistant turn options', () => {
    expect(MessageDataSchema.safeParse({ parts: [], turnOptions: { reasoningEffort: 'turbo' } }).success).toBe(false)
    expect(MessageDataSchema.safeParse({ parts: [], turnOptions: { fastMode: 'true' } }).success).toBe(false)
    expect(MessageDataSchema.safeParse({ parts: [], turnOptions: { serviceTier: 'turbo' } }).success).toBe(false)
  })
})
