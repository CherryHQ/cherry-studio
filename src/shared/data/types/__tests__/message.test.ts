import { describe, expect, it } from 'vitest'

import { coerceSearchRole, MessageDataSchema, ModelSnapshotSchema, TOPIC_MESSAGE_SEARCH_ROLES } from '../message'

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

  it('accepts a frozen model snapshot and rejects invalid priority data', () => {
    const modelSnapshot = {
      id: 'm2.1',
      name: 'MiniMax M2.1',
      provider: 'minimax',
      priorityMode: 'minimax'
    }

    expect(MessageDataSchema.safeParse({ parts: [], modelSnapshot }).success).toBe(true)
    expect(
      MessageDataSchema.safeParse({ parts: [], modelSnapshot: { ...modelSnapshot, priorityMode: 'fastest' } }).success
    ).toBe(false)
  })

  it('rejects invalid persisted assistant turn options', () => {
    expect(MessageDataSchema.safeParse({ parts: [], turnOptions: { reasoningEffort: 'turbo' } }).success).toBe(false)
    expect(MessageDataSchema.safeParse({ parts: [], turnOptions: { fastMode: 'true' } }).success).toBe(false)
  })
})

describe('ModelSnapshotSchema', () => {
  it('keeps legacy snapshots compatible and preserves a frozen priority mode', () => {
    const legacySnapshot = { id: 'm2.1', name: 'MiniMax M2.1', provider: 'minimax' }

    expect(ModelSnapshotSchema.parse(legacySnapshot)).toEqual(legacySnapshot)
    expect(ModelSnapshotSchema.parse({ ...legacySnapshot, priorityMode: 'minimax' })).toEqual({
      ...legacySnapshot,
      priorityMode: 'minimax'
    })
  })
})
