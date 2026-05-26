/**
 * IPC input-validation schemas for the Phase 1 File_* channels.
 *
 * Round 2 Blocker B4: `File_GetDanglingState` and `File_BatchGetDanglingStates`
 * previously accepted untyped `params` and passed them straight to
 * `findById` / `Promise.all(ids.map(findById))`. A 100k-id batch fanned out
 * 100k parallel SELECTs. These tests pin the typed-shape gate that now sits
 * in front of those methods.
 */

import { describe, expect, it } from 'vitest'

import {
  BatchGetDanglingStatesIpcSchema,
  BatchGetMetadataIpcSchema,
  BatchIdsIpcSchema,
  FILE_BATCH_DANGLING_MAX_IDS,
  FILE_BATCH_MAX_IDS,
  GetContentHashIpcSchema,
  GetDanglingStateIpcSchema,
  GetMetadataIpcSchema,
  GetVersionIpcSchema,
  OpenIpcSchema,
  ReadIpcOptionsSchema,
  RestoreIpcSchema,
  ShowInFolderIpcSchema,
  TrashIpcSchema,
  WriteDataIpcSchema
} from '../FileManager'

const VALID_UUID_V7 = '019606a0-0000-7000-8000-000000000001'

describe('GetDanglingStateIpcSchema', () => {
  it('accepts a valid UUID id', () => {
    expect(GetDanglingStateIpcSchema.parse({ id: VALID_UUID_V7 })).toEqual({ id: VALID_UUID_V7 })
  })

  it('rejects a non-UUID id', () => {
    expect(() => GetDanglingStateIpcSchema.parse({ id: 'not-a-uuid' })).toThrow()
  })

  it('rejects extra keys (strictObject)', () => {
    expect(() => GetDanglingStateIpcSchema.parse({ id: VALID_UUID_V7, extra: 1 })).toThrow()
  })

  it('rejects a missing id', () => {
    expect(() => GetDanglingStateIpcSchema.parse({})).toThrow()
  })
})

describe('BatchGetDanglingStatesIpcSchema', () => {
  it('accepts an array of valid UUIDs', () => {
    expect(BatchGetDanglingStatesIpcSchema.parse({ ids: [VALID_UUID_V7, VALID_UUID_V7] })).toEqual({
      ids: [VALID_UUID_V7, VALID_UUID_V7]
    })
  })

  it('accepts an empty array', () => {
    expect(BatchGetDanglingStatesIpcSchema.parse({ ids: [] })).toEqual({ ids: [] })
  })

  it('rejects an array containing a non-UUID', () => {
    expect(() => BatchGetDanglingStatesIpcSchema.parse({ ids: [VALID_UUID_V7, 'oops'] })).toThrow()
  })

  it(`caps batch size at FILE_BATCH_DANGLING_MAX_IDS (${FILE_BATCH_DANGLING_MAX_IDS})`, () => {
    const ok = Array.from({ length: FILE_BATCH_DANGLING_MAX_IDS }, () => VALID_UUID_V7)
    expect(BatchGetDanglingStatesIpcSchema.parse({ ids: ok }).ids).toHaveLength(FILE_BATCH_DANGLING_MAX_IDS)

    const tooMany = [...ok, VALID_UUID_V7]
    expect(() => BatchGetDanglingStatesIpcSchema.parse({ ids: tooMany })).toThrow()
  })

  it('rejects extra keys (strictObject)', () => {
    expect(() => BatchGetDanglingStatesIpcSchema.parse({ ids: [VALID_UUID_V7], extra: 1 })).toThrow()
  })
})

describe('TrashIpcSchema', () => {
  it('accepts a valid UUID id', () => {
    expect(TrashIpcSchema.parse({ id: VALID_UUID_V7 })).toEqual({ id: VALID_UUID_V7 })
  })
  it('rejects a non-UUID id', () => {
    expect(() => TrashIpcSchema.parse({ id: 'not-a-uuid' })).toThrow()
  })
  it('rejects extra keys', () => {
    expect(() => TrashIpcSchema.parse({ id: VALID_UUID_V7, extra: 1 })).toThrow()
  })
  it('rejects missing id', () => {
    expect(() => TrashIpcSchema.parse({})).toThrow()
  })
})

describe('RestoreIpcSchema', () => {
  it('accepts a valid UUID id', () => {
    expect(RestoreIpcSchema.parse({ id: VALID_UUID_V7 })).toEqual({ id: VALID_UUID_V7 })
  })
  it('rejects a non-UUID id', () => {
    expect(() => RestoreIpcSchema.parse({ id: 'not-a-uuid' })).toThrow()
  })
  it('rejects extra keys', () => {
    expect(() => RestoreIpcSchema.parse({ id: VALID_UUID_V7, extra: 1 })).toThrow()
  })
  it('rejects missing id', () => {
    expect(() => RestoreIpcSchema.parse({})).toThrow()
  })
})

describe('BatchIdsIpcSchema', () => {
  it('accepts array of valid UUIDs', () => {
    expect(BatchIdsIpcSchema.parse({ ids: [VALID_UUID_V7] })).toEqual({ ids: [VALID_UUID_V7] })
  })
  it('accepts empty array', () => {
    expect(BatchIdsIpcSchema.parse({ ids: [] })).toEqual({ ids: [] })
  })
  it('rejects array with non-UUID', () => {
    expect(() => BatchIdsIpcSchema.parse({ ids: ['not-a-uuid'] })).toThrow()
  })
  it(`caps batch size at FILE_BATCH_MAX_IDS (${FILE_BATCH_MAX_IDS})`, () => {
    const ok = Array.from({ length: FILE_BATCH_MAX_IDS }, () => VALID_UUID_V7)
    expect(BatchIdsIpcSchema.parse({ ids: ok }).ids).toHaveLength(FILE_BATCH_MAX_IDS)
    const tooMany = [...ok, VALID_UUID_V7]
    expect(() => BatchIdsIpcSchema.parse({ ids: tooMany })).toThrow()
  })
  it('rejects extra keys', () => {
    expect(() => BatchIdsIpcSchema.parse({ ids: [VALID_UUID_V7], extra: 1 })).toThrow()
  })
})

describe('GetContentHashIpcSchema', () => {
  it('accepts entry handle', () => {
    const input = { kind: 'entry', entryId: VALID_UUID_V7 }
    expect(GetContentHashIpcSchema.parse(input)).toEqual(input)
  })
  it('accepts path handle', () => {
    const input = { kind: 'path', path: '/test/file.txt' }
    expect(GetContentHashIpcSchema.parse(input)).toEqual(input)
  })
  it('rejects invalid kind', () => {
    expect(() => GetContentHashIpcSchema.parse({ kind: 'invalid' })).toThrow()
  })
  it('rejects entry handle with non-UUID', () => {
    expect(() => GetContentHashIpcSchema.parse({ kind: 'entry', entryId: 'bad' })).toThrow()
  })
  it('rejects path handle with relative path', () => {
    expect(() => GetContentHashIpcSchema.parse({ kind: 'path', path: 'relative' })).toThrow()
  })
})

describe('OpenIpcSchema', () => {
  it('accepts entry handle', () => {
    expect(OpenIpcSchema.parse({ kind: 'entry', entryId: VALID_UUID_V7 })).toEqual({
      kind: 'entry',
      entryId: VALID_UUID_V7
    })
  })
  it('accepts path handle', () => {
    expect(OpenIpcSchema.parse({ kind: 'path', path: '/test' })).toEqual({ kind: 'path', path: '/test' })
  })
  it('rejects invalid handle', () => {
    expect(() => OpenIpcSchema.parse({ kind: 'invalid' })).toThrow()
  })
})

describe('ShowInFolderIpcSchema', () => {
  it('accepts entry handle', () => {
    expect(ShowInFolderIpcSchema.parse({ kind: 'entry', entryId: VALID_UUID_V7 })).toEqual({
      kind: 'entry',
      entryId: VALID_UUID_V7
    })
  })
  it('accepts path handle', () => {
    expect(ShowInFolderIpcSchema.parse({ kind: 'path', path: '/test' })).toEqual({ kind: 'path', path: '/test' })
  })
  it('rejects invalid handle', () => {
    expect(() => ShowInFolderIpcSchema.parse({ kind: 'invalid' })).toThrow()
  })
})

describe('GetMetadataIpcSchema', () => {
  it('accepts entry handle', () => {
    expect(GetMetadataIpcSchema.parse({ kind: 'entry', entryId: VALID_UUID_V7 })).toEqual({
      kind: 'entry',
      entryId: VALID_UUID_V7
    })
  })
  it('accepts path handle', () => {
    expect(GetMetadataIpcSchema.parse({ kind: 'path', path: '/test/file.txt' })).toEqual({
      kind: 'path',
      path: '/test/file.txt'
    })
  })
  it('rejects invalid handle', () => {
    expect(() => GetMetadataIpcSchema.parse({ kind: 'invalid' })).toThrow()
  })
})

describe('BatchGetMetadataIpcSchema', () => {
  it('accepts array of valid UUIDs', () => {
    expect(BatchGetMetadataIpcSchema.parse({ ids: [VALID_UUID_V7] })).toEqual({ ids: [VALID_UUID_V7] })
  })
  it('accepts empty array', () => {
    expect(BatchGetMetadataIpcSchema.parse({ ids: [] })).toEqual({ ids: [] })
  })
  it('rejects non-UUID in array', () => {
    expect(() => BatchGetMetadataIpcSchema.parse({ ids: ['bad'] })).toThrow()
  })
  it(`caps at FILE_BATCH_MAX_IDS`, () => {
    const tooMany = Array.from({ length: FILE_BATCH_MAX_IDS + 1 }, () => VALID_UUID_V7)
    expect(() => BatchGetMetadataIpcSchema.parse({ ids: tooMany })).toThrow()
  })
  it('rejects extra keys', () => {
    expect(() => BatchGetMetadataIpcSchema.parse({ ids: [], extra: 1 })).toThrow()
  })
})

describe('GetVersionIpcSchema', () => {
  it('accepts entry handle', () => {
    expect(GetVersionIpcSchema.parse({ kind: 'entry', entryId: VALID_UUID_V7 })).toEqual({
      kind: 'entry',
      entryId: VALID_UUID_V7
    })
  })
  it('accepts path handle', () => {
    expect(GetVersionIpcSchema.parse({ kind: 'path', path: '/test' })).toEqual({ kind: 'path', path: '/test' })
  })
  it('rejects invalid handle', () => {
    expect(() => GetVersionIpcSchema.parse({ kind: 'bad' })).toThrow()
  })
})

describe('ReadIpcOptionsSchema', () => {
  it('accepts undefined (default text)', () => {
    expect(ReadIpcOptionsSchema.parse(undefined)).toBeUndefined()
  })
  it('accepts text encoding', () => {
    expect(ReadIpcOptionsSchema.parse({ encoding: 'text' })).toEqual({ encoding: 'text' })
  })
  it('accepts base64 encoding', () => {
    expect(ReadIpcOptionsSchema.parse({ encoding: 'base64' })).toEqual({ encoding: 'base64' })
  })
  it('accepts binary encoding', () => {
    expect(ReadIpcOptionsSchema.parse({ encoding: 'binary' })).toEqual({ encoding: 'binary' })
  })
  it('accepts detectEncoding flag', () => {
    expect(ReadIpcOptionsSchema.parse({ detectEncoding: true })).toEqual({ detectEncoding: true })
  })
  it('rejects invalid encoding', () => {
    expect(() => ReadIpcOptionsSchema.parse({ encoding: 'utf16' })).toThrow()
  })
})

describe('WriteDataIpcSchema', () => {
  it('accepts string data', () => {
    expect(WriteDataIpcSchema.parse('hello')).toBe('hello')
  })
  it('accepts Uint8Array data', () => {
    const data = new Uint8Array([1, 2, 3])
    expect(WriteDataIpcSchema.parse(data)).toEqual(data)
  })
  it('rejects number', () => {
    expect(() => WriteDataIpcSchema.parse(42)).toThrow()
  })
})
