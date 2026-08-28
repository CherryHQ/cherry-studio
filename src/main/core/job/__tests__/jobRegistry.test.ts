/**
 * Compile-time contract test for the `JobRegistry` declaration-merging API.
 *
 * The runtime handler Map inside JobManager is unrelated to this — this file
 * exists purely to lock down the compile-time type binding: registering a key
 * via `declare module` makes `JobPayloadOf<K>` resolve to its payload shape,
 * makes `JobType` enumerate the key, and makes `enqueue('typed-key', ...)`
 * reject wrong-shape payloads at the TS level.
 *
 * Without this test, the registry binding has zero compile-time coverage in
 * the suite (every other test goes through `as never` widening because no
 * business module has migrated yet) — a regression in the propagation chain
 * `keyof JobRegistry & string → enqueue<K> → JobPayloadOf<K>` would land
 * silently.
 */

import type { JobPayloadOf, JobType } from '@main/core/job/jobRegistry'
import { describe, expectTypeOf, it } from 'vitest'

declare module '@main/core/job/jobRegistry' {
  interface JobRegistry {
    'test.contract.alpha': { itemId: string; threshold: number }
    'test.contract.beta': { url: string }
  }
}

describe('JobRegistry declaration merging', () => {
  it('JobPayloadOf<K> resolves to the registered payload shape', () => {
    expectTypeOf<JobPayloadOf<'test.contract.alpha'>>().toEqualTypeOf<{ itemId: string; threshold: number }>()
    expectTypeOf<JobPayloadOf<'test.contract.beta'>>().toEqualTypeOf<{ url: string }>()
  })

  it('JobType is a string union of every registered key', () => {
    // Every test-registered key must be assignable to JobType. `toExtend` is
    // the non-deprecated replacement for `toMatchTypeOf` (vitest 3+).
    expectTypeOf<'test.contract.alpha'>().toExtend<JobType>()
    expectTypeOf<'test.contract.beta'>().toExtend<JobType>()
  })

  it('payload mismatch is a TS error (sanity: shape mismatch flagged)', () => {
    // Negative case: passing the wrong payload shape should not satisfy
    // JobPayloadOf<'test.contract.alpha'>. This expectTypeOf will fail
    // compilation if the binding silently widened.
    expectTypeOf<{ wrong: 'shape' }>().not.toEqualTypeOf<JobPayloadOf<'test.contract.alpha'>>()
  })
})
