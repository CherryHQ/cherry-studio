import { describe, expect, it } from 'vitest'

import {
  allSourceTypes,
  FileRefSchema,
  knowledgeItemFileRefSchema,
  knowledgeItemSourceType,
  tempSessionFileRefSchema,
  tempSessionSourceType
} from '../file/ref'

const REF_ID = '11111111-2222-4333-8444-000000000001' // UUIDv4
const ENTRY_ID = '019606a0-0000-7000-8000-000000000001' // UUIDv7
const KB_ITEM_ID = '019606a1-0000-7000-8000-000000000abc' // UUIDv7
const TS = 1700000000000

describe('FileRefSourceType', () => {
  it('exposes exactly the currently-registered source types', () => {
    // Defensive: this assertion locks the Phase 1b registered set.
    // Adding a new variant must also extend (a) the discriminated union and
    // (b) the OrphanRefScanner registry — see ref/README.md.
    expect([...allSourceTypes]).toEqual(['temp_session', 'knowledge_item'])
  })
})

describe('knowledgeItemFileRefSchema', () => {
  function makeKnowledgeItemRef(overrides: Record<string, unknown> = {}) {
    return {
      id: REF_ID,
      fileEntryId: ENTRY_ID,
      sourceType: knowledgeItemSourceType,
      sourceId: KB_ITEM_ID,
      role: 'attachment',
      createdAt: TS,
      updatedAt: TS,
      ...overrides
    }
  }

  it('accepts a well-formed knowledge_item ref', () => {
    const parsed = knowledgeItemFileRefSchema.parse(makeKnowledgeItemRef())
    expect(parsed.sourceType).toBe('knowledge_item')
    expect(parsed.sourceId).toBe(KB_ITEM_ID)
    expect(parsed.role).toBe('attachment')
  })

  it('accepts any non-empty role string (Phase 1b placeholder semantics)', () => {
    // Phase 2 will tighten this to a closed enum — see knowledgeItem.ts JSDoc.
    // Verifying the lax behavior here means a future enum collapse is a
    // detectable strict-direction migration, not an accident.
    for (const role of ['attachment', 'source', 'preview', 'thumbnail', 'x']) {
      const parsed = knowledgeItemFileRefSchema.parse(makeKnowledgeItemRef({ role }))
      expect(parsed.role).toBe(role)
    }
  })

  it('rejects an empty role string', () => {
    expect(() => knowledgeItemFileRefSchema.parse(makeKnowledgeItemRef({ role: '' }))).toThrow()
  })

  it('rejects a non-UUIDv7 sourceId (knowledge_item.id is v2-native)', () => {
    expect(() => knowledgeItemFileRefSchema.parse(makeKnowledgeItemRef({ sourceId: 'not-a-uuid' }))).toThrow()
  })

  it('rejects sourceType other than the literal knowledge_item', () => {
    expect(() => knowledgeItemFileRefSchema.parse(makeKnowledgeItemRef({ sourceType: 'temp_session' }))).toThrow()
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
      role: 'attachment',
      createdAt: TS,
      updatedAt: TS
    })
    expect(parsed.sourceType).toBe('knowledge_item')
  })

  it('rejects an unregistered sourceType (no longer in allSourceTypes)', () => {
    // Pre-cleanup the discriminated union still recognised these four; today
    // they must be rejected so DataApi rounds-trip stays consistent. When a
    // new variant lands, this test should be updated alongside the union.
    for (const sourceType of ['chat_message', 'painting', 'note']) {
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
