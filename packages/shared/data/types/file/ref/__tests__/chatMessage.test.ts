import { describe, expect, it } from 'vitest'

import { MessageIdSchema } from '../../../message'
import { chatMessageFileRefSchema } from '../chatMessage'
import type { FileRefSourceType } from '../index'
import { allSourceTypes, FileRefSchema } from '../index'

describe('MessageIdSchema', () => {
  it('accepts UUIDv4 (legacy message IDs)', () => {
    expect(() => MessageIdSchema.parse('550e8400-e29b-41d4-a716-446655440000')).not.toThrow()
  })

  it('accepts UUIDv7 (v2-native message IDs)', () => {
    expect(() => MessageIdSchema.parse('019746de-59a3-7f00-8000-000000000000')).not.toThrow()
  })

  it('rejects non-UUID strings', () => {
    expect(() => MessageIdSchema.parse('not-a-uuid')).toThrow()
  })
})

describe('chat_message FileRefSourceType registration', () => {
  it('is included in allSourceTypes tuple', () => {
    expect(allSourceTypes).toContain('chat_message')
  })

  it('is assignable to FileRefSourceType', () => {
    const _: FileRefSourceType = 'chat_message'
    expect(_).toBe('chat_message')
  })

  it('chatMessageFileRefSchema parses a valid chat_message ref', () => {
    const valid = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      fileEntryId: '550e8400-e29b-41d4-a716-446655440001',
      sourceType: 'chat_message',
      sourceId: '550e8400-e29b-41d4-a716-446655440002',
      role: 'attachment',
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    expect(() => chatMessageFileRefSchema.parse(valid)).not.toThrow()
  })

  it('rejects invalid role', () => {
    const invalid = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      fileEntryId: '550e8400-e29b-41d4-a716-446655440001',
      sourceType: 'chat_message',
      sourceId: '550e8400-e29b-41d4-a716-446655440002',
      role: 'source',
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    expect(() => chatMessageFileRefSchema.parse(invalid)).toThrow()
  })

  it('FileRefSchema discriminated union accepts chat_message variant', () => {
    const valid = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      fileEntryId: '550e8400-e29b-41d4-a716-446655440001',
      sourceType: 'chat_message',
      sourceId: '550e8400-e29b-41d4-a716-446655440002',
      role: 'attachment',
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    expect(() => FileRefSchema.parse(valid)).not.toThrow()
  })
})
