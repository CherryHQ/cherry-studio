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
  EnsureExternalEntryIpcSchema,
  FILE_BATCH_DANGLING_MAX_IDS,
  GetDanglingStateIpcSchema
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

describe('EnsureExternalEntryIpcSchema', () => {
  // The keystone of "canonicalize once at the boundary, trust the brand
  // downstream": `externalPath` wraps `FilePathSchema`, so the IPC param
  // schema itself must transform a valid-but-non-canonical path to canonical
  // — not merely shape-check it. FilePathSchema.test.ts covers the bare
  // transform; these pin that the strictObject wrapper actually applies it.
  it('canonicalizes a non-canonical externalPath (resolves ./ and ../)', () => {
    expect(EnsureExternalEntryIpcSchema.parse({ externalPath: '/tmp/sub/.././x.pdf' }).externalPath).toBe('/tmp/x.pdf')
  })

  it('strips a trailing separator', () => {
    expect(EnsureExternalEntryIpcSchema.parse({ externalPath: '/tmp/dir/' }).externalPath).toBe('/tmp/dir')
  })

  it('is idempotent — re-parsing the canonical form is a no-op', () => {
    const once = EnsureExternalEntryIpcSchema.parse({ externalPath: '/tmp/sub/.././x.pdf' }).externalPath
    const twice = EnsureExternalEntryIpcSchema.parse({ externalPath: once }).externalPath
    expect(twice).toBe(once)
    expect(twice).toBe('/tmp/x.pdf')
  })

  it('rejects extra keys (strictObject)', () => {
    expect(() => EnsureExternalEntryIpcSchema.parse({ externalPath: '/tmp/x.pdf', extra: 1 })).toThrow()
  })
})
