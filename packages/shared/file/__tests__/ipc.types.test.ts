import { describe, expectTypeOf, it } from 'vitest'

import type { FileEntryId } from '../../data/types/file'
import type { BatchOperationResult } from '../types/ipc'

/**
 * Compile-time contract for `BatchOperationResult.failed`: exactly one of
 * `id` / `sourceRef` must be present per entry. Pre-fix the shape was a
 * single `{ id?; sourceRef?; error }` which permitted `{ error: 'x' }` and
 * `{ id, sourceRef, error }` — both meaningless states. The discriminated
 * union rejects them at the type system, so a handler that returns a
 * malformed entry stops compiling instead of leaking the malformed result
 * into renderer consumers.
 */
describe('BatchOperationResult.failed (discriminated union)', () => {
  type FailedEntry = BatchOperationResult['failed'][number]
  const id = 'fe_01' as FileEntryId

  it('admits id-bearing entries', () => {
    const entry: FailedEntry = { id, error: 'permission denied' }
    expectTypeOf(entry).toMatchTypeOf<FailedEntry>()
  })

  it('admits sourceRef-bearing entries', () => {
    const entry: FailedEntry = { sourceRef: '/foo/bar.txt', error: 'EACCES' }
    expectTypeOf(entry).toMatchTypeOf<FailedEntry>()
  })

  it('rejects entries with neither id nor sourceRef', () => {
    // @ts-expect-error — at least one of id / sourceRef must be present.
    const entry: FailedEntry = { error: 'missing both' }
    void entry
  })

  it('rejects entries that present both id and sourceRef', () => {
    // @ts-expect-error — id and sourceRef are mutually exclusive.
    const entry: FailedEntry = { id, sourceRef: '/x', error: 'both' }
    void entry
  })
})
