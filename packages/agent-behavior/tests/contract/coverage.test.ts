import { describe, expect, expectTypeOf, it } from 'vitest'

import { harnessContract } from '../../src/contract/cases'
import { HARNESS_PORT_METHODS } from '../../src/contract/portMethods'
import type { PortMethod } from '../../src/ports/harness'

describe('harness contract coverage', () => {
  // Catches a port method added or renamed without a contract case, so an adapter could ship it untested (guardrail 5).
  // The type assertion fails the package typecheck; the runtime assertion fails the test.
  it('covers exactly the harness port methods', () => {
    expectTypeOf<Exclude<PortMethod, (typeof HARNESS_PORT_METHODS)[number]>>().toEqualTypeOf<never>()
    expect([...new Set(harnessContract.flatMap((c) => c.covers))].sort()).toEqual([...HARNESS_PORT_METHODS].sort())
  })

  // Catches two cases sharing a name, which makes an adapter's declared-difference table ambiguous.
  it('names every case uniquely', () => {
    const names = harnessContract.map((c) => c.name)
    expect(new Set(names).size).toBe(names.length)
  })
})
