import { describe, expect, it, vi } from 'vitest'

import {
  coerceSearchRole,
  MessageDataSchema,
  MessageIdSchema,
  MessageSnapshotSchema,
  TOPIC_MESSAGE_SEARCH_ROLES
} from '../message'

it('accepts legacy and native message IDs and rejects non-UUID strings', () => {
  const legacyId = '550e8400-e29b-41d4-a716-446655440000'
  const nativeId = '019746de-59a3-7f00-8000-000000000000'
  expect(MessageIdSchema.parse(legacyId)).toBe(legacyId)
  expect(MessageIdSchema.parse(nativeId)).toBe(nativeId)
  expect(MessageIdSchema.safeParse('not-a-uuid').success).toBe(false)
})

describe('coerceSearchRole', () => {
  it('returns the role only when it is in the allowed search role set', () => {
    expect(coerceSearchRole('assistant', TOPIC_MESSAGE_SEARCH_ROLES)).toBe('assistant')
    expect(coerceSearchRole('system', TOPIC_MESSAGE_SEARCH_ROLES)).toBeUndefined()
    expect(coerceSearchRole('tool', TOPIC_MESSAGE_SEARCH_ROLES)).toBeUndefined()
  })
})

describe('MessageDataSchema', () => {
  it('accepts persisted assistant retry settings', () => {
    expect(
      MessageDataSchema.safeParse({
        parts: [],
        modelSelection: 'explicit',
        turnOptions: { reasoningEffort: 'high', fastMode: true, serviceTier: 'flex' }
      }).success
    ).toBe(true)
  })

  it('rejects invalid persisted assistant retry settings', () => {
    expect(MessageDataSchema.safeParse({ parts: [], modelSelection: 'unknown' }).success).toBe(false)
    expect(MessageDataSchema.safeParse({ parts: [], turnOptions: { reasoningEffort: 'turbo' } }).success).toBe(false)
    expect(MessageDataSchema.safeParse({ parts: [], turnOptions: { fastMode: 'true' } }).success).toBe(false)
    expect(MessageDataSchema.safeParse({ parts: [], turnOptions: { serviceTier: 'turbo' } }).success).toBe(false)
  })
})

describe('MessageSnapshotSchema avatar', () => {
  const snapshot = { id: 'author', name: 'Author', emoji: '🌟', model: { id: 'm', name: 'M', provider: 'p' } }
  it('freezes only a file ID and preserves legacy snapshots', () => {
    expect(MessageSnapshotSchema.parse(snapshot)).toEqual(snapshot)
    const withAvatar = { ...snapshot, avatarFileId: '019606a0-0000-7000-8000-00000000aa01' }
    expect(MessageSnapshotSchema.parse(withAvatar)).toEqual(withAvatar)
    for (const avatarFileId of ['/tmp/avatar.webp', 'file:///tmp/avatar.webp']) {
      expect(MessageSnapshotSchema.safeParse({ ...snapshot, avatarFileId }).success).toBe(false)
    }
    expect(MessageSnapshotSchema.safeParse({ ...snapshot, avatarSrc: 'file:///tmp/avatar.webp' }).success).toBe(false)
  })
})

it('keeps avatar and ref schemas valid when message schemas load first', async () => {
  vi.resetModules()
  const { MessageSnapshotSchema: snapshotSchema } = await import('../message')
  const { FileRefSchema } = await import('../file')
  const fileEntryId = '019606a0-0000-7000-8000-00000000aa01'
  const snapshot = {
    id: 'author',
    name: 'Author',
    avatarFileId: fileEntryId,
    model: { id: 'm', name: 'M', provider: 'p' }
  }
  expect(snapshotSchema.parse(snapshot)).toEqual(snapshot)
  const ref = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    fileEntryId,
    sourceType: 'chat_message',
    sourceId: '550e8400-e29b-41d4-a716-446655440000',
    role: 'author_avatar',
    createdAt: 1,
    updatedAt: 1
  }
  expect(FileRefSchema.parse(ref)).toEqual(ref)
})
