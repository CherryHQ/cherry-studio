import { describe, expect, it } from 'vitest'

import {
  allSourceTypes,
  chatMessageFileRefSchema,
  chatMessageSourceType,
  FileRefSchema,
  jobFileRefSchema,
  jobSourceType,
  miniAppLogoRef,
  paintingFileRefSchema,
  paintingSourceType,
  providerLogoRef,
  tempSessionFileRefSchema,
  tempSessionSourceType
} from '../file'

const REF_ID = '11111111-2222-4333-8444-000000000001' // UUIDv4
const ENTRY_ID = '019606a0-0000-7000-8000-000000000001' // UUIDv7
const MESSAGE_ID = '33333333-4444-4555-8666-000000000002' // UUID (legacy chat ids may be v4)
const PAINTING_ID = '33333333-4444-4555-8666-000000000003' // UUIDv4 (painting.id)
const JOB_ID = '019606a0-0000-7000-8000-000000000009' // UUIDv7 (job.id is uuidPrimaryKeyOrdered)
const TS = 1700000000000

describe('FileRefSourceType', () => {
  it('exposes exactly the currently-registered source types', () => {
    // Defensive: this assertion locks the currently-registered set. Adding a
    // new variant must also extend the discriminated union and back it with an
    // FK-constrained association table — see ref/index.ts.
    // The user avatar deliberately has no variant: it is persisted only in the
    // `app.user.avatar` preference (no ref table).
    expect([...allSourceTypes]).toEqual([
      'temp_session',
      'chat_message',
      'painting',
      'job',
      'provider_logo',
      'mini_app_logo'
    ])
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

describe('single-file ref variants (provider_logo / mini_app_logo)', () => {
  it('accepts a well-formed roleless logo ref (free-string sourceId)', () => {
    for (const ref of [providerLogoRef, miniAppLogoRef]) {
      const parsed = ref.schema.parse({
        id: REF_ID,
        fileEntryId: ENTRY_ID,
        sourceType: ref.sourceType,
        sourceId: 'preset-or-uuid-id',
        createdAt: TS,
        updatedAt: TS
      })
      expect(parsed.sourceType).toBe(ref.sourceType)
      // Roleless: the variant has no `role` field (constant, unread downstream).
      expect('role' in parsed).toBe(false)
    }
  })

  it('drops a stray role rather than carrying it (the slot has no role field)', () => {
    const parsed = providerLogoRef.schema.parse({
      id: REF_ID,
      fileEntryId: ENTRY_ID,
      sourceType: providerLogoRef.sourceType,
      sourceId: 'p1',
      role: 'logo',
      createdAt: TS,
      updatedAt: TS
    })
    expect('role' in parsed).toBe(false)
  })
})

describe('jobFileRefSchema', () => {
  function makeJobRef(overrides: Record<string, unknown> = {}) {
    return {
      id: REF_ID,
      fileEntryId: ENTRY_ID,
      sourceType: jobSourceType,
      sourceId: JOB_ID,
      role: 'input',
      createdAt: TS,
      updatedAt: TS,
      ...overrides
    }
  }

  it('accepts both job roles (input/mask)', () => {
    for (const role of ['input', 'mask']) {
      const parsed = jobFileRefSchema.parse(makeJobRef({ role }))
      expect(parsed.role).toBe(role)
    }
  })

  it('rejects role values outside the job vocabulary', () => {
    for (const role of ['output', 'attachment', 'thumbnail', '']) {
      expect(() => jobFileRefSchema.parse(makeJobRef({ role }))).toThrow()
    }
  })

  it('rejects a non-UUID sourceId', () => {
    expect(() => jobFileRefSchema.parse(makeJobRef({ sourceId: 'not-a-uuid' }))).toThrow()
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
    // Narrow the heterogeneous union (single-file variants are roleless).
    if (parsed.sourceType === 'chat_message') expect(parsed.role).toBe('attachment')
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

  it('dispatches to the job variant', () => {
    const parsed = FileRefSchema.parse({
      id: REF_ID,
      fileEntryId: ENTRY_ID,
      sourceType: jobSourceType,
      sourceId: JOB_ID,
      role: 'mask',
      createdAt: TS,
      updatedAt: TS
    })
    expect(parsed.sourceType).toBe('job')
    // Narrow the heterogeneous union (single-file variants are roleless).
    if (parsed.sourceType === 'job') expect(parsed.role).toBe('mask')
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
