import { childCases } from './childCases'
import { durabilityCases } from './durabilityCases'
import type { ContractCase } from './harness'
import { inboundCases } from './inboundCases'
import { ledgerCases } from './ledgerCases'
import { turnCases } from './turnCases'

/** Every case each harness must pass (design §12); a harness may skip only cases whose `needs` it lacks. */
export const harnessContract: readonly ContractCase[] = [
  ...ledgerCases,
  ...turnCases,
  ...childCases,
  ...durabilityCases,
  ...inboundCases
]
