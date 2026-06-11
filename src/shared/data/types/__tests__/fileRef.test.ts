import { describe, expect, it } from 'vitest'

import {
  allSourceTypes,
  FileRefSchema,
  knowledgeItemFileRefSchema,
  knowledgeItemSourceType,
  paintingFileRefSchema,
  paintingSourceType,
  tempSessionFileRefSchema,
  tempSessionSourceType
} from '../file/ref'

const REF_ID = '11111111-2222-4333-8444-000000000001' // UUIDv4
const ENTRY_ID = '019606a0-0000-7000-8000-000000000001' // UUIDv7
const KB_ITEM_ID = '019606a1-0000-7000-8000-000000000abc' // UUIDv7
const PAINTING_ID = '33333333-4444-4555-8666-000000000003' // UUIDv4 (painting.id)
const TS = 1700000000000

describe('FileRefSourceType', () => {
  it('exposes exactly the currently-registered source types', () => {
    // Defensive: this assertion locks the currently-registered set.
    // Adding a new variant must also extend (a) the discriminated union and
    // (b) the OrphanRefScanner registry — see ref/README.md.
    expect([...allSourceTypes]).toEqual(['temp_session', 'knowledge_item', 'chat_message', 'painting'])
  })
})

describe('knowledgeItemFileRefSchema', () => {
  function makeKnowledgeItemRef(overrides: Record<string, unknown> = {}) {
    return {
      id: REF_ID,
      fileEntryId: ENTRY_ID,
      sourceType: knowledgeItemSourceType,
      sourceId: KB_ITEM_ID,
      role: 'source',
      createdAt: TS,
      updatedAt: TS,
      ...overrides
    }
  }

  it('accepts a well-formed knowledge_item ref', () => {
    const parsed = knowledgeItemFileRefSchema.parse(makeKnowledgeItemRef())
    expect(parsed.sourceType).toBe('knowledge_item')
    expect(parsed.sourceId).toBe(KB_ITEM_ID)
    expect(parsed.role).toBe('source')
  })

  it('accepts every knowledge_item role', () => {
    for (const role of ['source', 'processed_artifact']) {
      const parsed = knowledgeItemFileRefSchema.parse(makeKnowledgeItemRef({ role }))
      expect(parsed.role).toBe(role)
    }
  })

  it('rejects role values outside the knowledge_item enum', () => {
    for (const role of ['attachment', 'preview', 'thumbnail', '']) {
      expect(() => knowledgeItemFileRefSchema.parse(makeKnowledgeItemRef({ role }))).toThrow()
    }
  })

  it('rejects a non-UUIDv7 sourceId (knowledge_item.id is v2-native)', () => {
    expect(() => knowledgeItemFileRefSchema.parse(makeKnowledgeItemRef({ sourceId: 'not-a-uuid' }))).toThrow()
  })

  it('rejects sourceType other than the literal knowledge_item', () => {
    expect(() => knowledgeItemFileRefSchema.parse(makeKnowledgeItemRef({ sourceType: 'temp_session' }))).toThrow()
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
    expect(() => paintingFileRefSchema.parse(makePaintingRef({ sourceType: 'knowledge_item' }))).toThrow()
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

  it('dispatches to the knowledge_item variant', () => {
    const parsed = FileRefSchema.parse({
      id: REF_ID,
      fileEntryId: ENTRY_ID,
      sourceType: knowledgeItemSourceType,
      sourceId: KB_ITEM_ID,
      role: 'source',
      createdAt: TS,
      updatedAt: TS
    })
    expect(parsed.sourceType).toBe('knowledge_item')
    expect(parsed.role).toBe('source')
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
    // `note` remains unregistered; it must be rejected so DataApi round-trip
    // stays consistent. When a new variant lands, update this list alongside
    // the union.
    for (const sourceType of ['note']) {
      expect(() =>
        FileRefSchema.parse({
          id: REF_ID,
          fileEntryId: ENTRY_ID,
          sourceType,
          sourceId: KB_ITEM_ID,
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
