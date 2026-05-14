import { describe, expectTypeOf, it } from 'vitest'

import type { FileEntryId } from '../../data/types/file'
import type { BatchCreateResult, BatchMutationResult } from '../types/ipc'

const id = 'fe_01' as FileEntryId

/**
 * Compile-time contract for `BatchMutationResult` — used by batchTrash /
 * batchRestore / batchPermanentDelete. Inputs are FileEntryIds, so both
 * succeeded and failed slots are id-keyed. The discriminated union from
 * before the split (which permitted `{ error }` alone or `{ id, sourceRef,
 * error }`) is gone; the new single-shape failed entry rejects those at the
 * type system.
 */
describe('BatchMutationResult contract', () => {
  type Succeeded = BatchMutationResult['succeeded'][number]
  type Failed = BatchMutationResult['failed'][number]

  it('succeeded entries are FileEntryId values', () => {
    const ok: Succeeded = id
    expectTypeOf(ok).toMatchTypeOf<FileEntryId>()
  })

  it('failed entries carry id + error', () => {
    const entry: Failed = { id, error: 'permission denied' }
    expectTypeOf(entry).toMatchTypeOf<Failed>()
  })

  it('rejects failed entries that omit id', () => {
    // @ts-expect-error — id is required on BatchMutationResult.failed.
    const entry: Failed = { error: 'missing id' }
    void entry
  })

  it('rejects failed entries that smuggle in sourceRef', () => {
    // @ts-expect-error — sourceRef is not part of the BatchMutationResult.failed shape.
    const entry: Failed = { id, sourceRef: '/x', error: 'both fields' }
    void entry
  })
})

/**
 * Compile-time contract for `BatchCreateResult` — used by
 * batchCreateInternalEntries / batchEnsureExternalEntries. Inputs carry no
 * pre-existing id, so every entry on both halves is keyed by an opaque
 * `sourceRef`. `succeeded` items additionally carry the freshly-created
 * `id`, so callers can correlate created entries back to the input array
 * without re-deriving from positional order.
 */
describe('BatchCreateResult contract', () => {
  type Succeeded = BatchCreateResult['succeeded'][number]
  type Failed = BatchCreateResult['failed'][number]

  it('succeeded entries carry id + sourceRef', () => {
    const entry: Succeeded = { id, sourceRef: '/foo/bar.txt' }
    expectTypeOf(entry).toMatchTypeOf<Succeeded>()
  })

  it('rejects succeeded entries that omit sourceRef (correlation must be possible)', () => {
    // @ts-expect-error — sourceRef is required on BatchCreateResult.succeeded.
    const entry: Succeeded = { id }
    void entry
  })

  it('failed entries carry sourceRef + error (no id materialized yet)', () => {
    const entry: Failed = { sourceRef: '/foo/bar.txt', error: 'EACCES' }
    expectTypeOf(entry).toMatchTypeOf<Failed>()
  })

  it('rejects failed entries that omit sourceRef', () => {
    // @ts-expect-error — sourceRef is required on BatchCreateResult.failed.
    const entry: Failed = { error: 'missing source' }
    void entry
  })

  it('rejects failed entries that smuggle in id (insert never happened)', () => {
    // @ts-expect-error — id is not part of the BatchCreateResult.failed shape.
    const entry: Failed = { id, sourceRef: '/x', error: 'both fields' }
    void entry
  })
})
