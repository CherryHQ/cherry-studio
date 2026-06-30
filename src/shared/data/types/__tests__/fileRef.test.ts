import { describe, expect, it } from 'vitest'

import {
  allSourceTypes,
  chatMessageFileRefSchema,
  chatMessageSourceType,
  FileRefSchema,
  paintingFileRefSchema,
  paintingSourceType,
  tempSessionFileRefSchema,
  tempSessionSourceType
} from '../file/ref'

const REF_ID = '11111111-2222-4333-8444-000000000001' // UUIDv4
const ENTRY_ID = '019606a0-0000-7000-8000-000000000001' // UUIDv7
const MESSAGE_ID = '33333333-4444-4555-8666-000000000002' // UUID (legacy chat ids may be v4)
const PAINTING_ID = '33333333-4444-4555-8666-000000000003' // UUIDv4 (painting.id)
const TS = 1700000000000

describe('FileRefSourceType', () => {
  it('exposes exactly the currently-registered source types', () => {
    expect([...allSourceTypes]).toEqual(['temp_session', 'chat_message', 'painting'])
  })
})

describe('chatMessageFileRefSchema', () => {
  function makeChatMessageRef(overrides: Record<string, unknown> = {}) {
    return {
      id: REF_ID,
      fileEntryId: ENTRY_ID,
      sourceType: chatMessageSourceType,
      sourceId: MESSAGE_ID,
      role: 'attachment',
      createdAt: TS,
      updatedAt: TS,
      ...overrides
    }
  }

  it('accepts a well-formed chat_message ref', () => {
    const parsed = chatMessageFileRefSchema.parse(makeChatMessageRef())
    expect(parsed.sourceType).toBe('chat_message')
    expect(parsed.sourceId).toBe(MESSAGE_ID)
    expect(parsed.role).toBe('attachment')
  })

  it('rejects role values outside the chat_message vocabulary', () => {
    for (const role of ['source', 'preview', 'thumbnail', '']) {
      expect(() => chatMessageFileRefSchema.parse(makeChatMessageRef({ role }))).toThrow()
    }
  })
})

describe('paintingFileRefSchema', () => {
  function makePaintingRef(overrides: Record<string, unknown> = {}) {
    return {
      id: REF_ID,
      fileEntryId: ENTRY_ID,
      sourceType: paintingSourceType,
      sourceId: PAINTING_ID,
      role: 'output',
      createdAt: TS,
      updatedAt: TS,
      ...overrides
    }
  }

  it('accepts a well-formed painting ref', () => {
    const parsed = paintingFileRefSchema.parse(makePaintingRef())
    expect(parsed.sourceType).toBe('painting')
    expect(parsed.sourceId).toBe(PAINTING_ID)
    expect(parsed.role).toBe('output')
  })

  it('accepts both painting roles (output/input — the two PaintingFiles buckets)', () => {
    for (const role of ['output', 'input']) {
      const parsed = paintingFileRefSchema.parse(makePaintingRef({ role }))
      expect(parsed.role).toBe(role)
    }
  })

  it('rejects role values outside the painting vocabulary', () => {
    for (const role of ['attachment', 'mask', 'thumbnail', '']) {
      expect(() => paintingFileRefSchema.parse(makePaintingRef({ role }))).toThrow()
    }
  })

  it('rejects a non-UUIDv4 sourceId (painting.id is uuidPrimaryKey v4)', () => {
    expect(() => paintingFileRefSchema.parse(makePaintingRef({ sourceId: 'not-a-uuid' }))).toThrow()
  })

  it('rejects sourceType other than the literal painting', () => {
    expect(() => paintingFileRefSchema.parse(makePaintingRef({ sourceType: 'chat_message' }))).toThrow()
  })
})

describe('FileRefSchema discriminated union', () => {
  it('dispatches to the temp_session variant', () => {
    const parsed = FileRefSchema.parse({
      id: REF_ID,
      fileEntryId: ENTRY_ID,
      sourceType: tempSessionSourceType,
      sourceId: 'session-1',
      role: 'pending',
      createdAt: TS,
      updatedAt: TS
    })
    expect(parsed.sourceType).toBe('temp_session')
  })

  it('dispatches to the chat_message variant', () => {
    const parsed = FileRefSchema.parse({
      id: REF_ID,
      fileEntryId: ENTRY_ID,
      sourceType: chatMessageSourceType,
      sourceId: MESSAGE_ID,
      role: 'attachment',
      createdAt: TS,
      updatedAt: TS
    })
    expect(parsed.sourceType).toBe('chat_message')
    expect(parsed.role).toBe('attachment')
  })

  it('dispatches to the painting variant', () => {
    const parsed = FileRefSchema.parse({
      id: REF_ID,
      fileEntryId: ENTRY_ID,
      sourceType: paintingSourceType,
      sourceId: PAINTING_ID,
      role: 'input',
      createdAt: TS,
      updatedAt: TS
    })
    expect(parsed.sourceType).toBe('painting')
  })

  it('rejects an unregistered sourceType (not in allSourceTypes)', () => {
    for (const sourceType of ['note', 'knowledge_item']) {
      expect(() =>
        FileRefSchema.parse({
          id: REF_ID,
          fileEntryId: ENTRY_ID,
          sourceType,
          sourceId: MESSAGE_ID,
          role: 'attachment',
          createdAt: TS,
          updatedAt: TS
        })
      ).toThrow()
    }
  })

  it('roundtrips a valid row via the union', () => {
    const input = tempSessionFileRefSchema.parse({
      id: REF_ID,
      fileEntryId: ENTRY_ID,
      sourceType: tempSessionSourceType,
      sourceId: 'session-rt',
      role: 'pending',
      createdAt: TS,
      updatedAt: TS
    })
    expect(FileRefSchema.parse(input)).toEqual(input)
  })
})
