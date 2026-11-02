import { describe, it } from 'vitest'

import { type ContractNeed, harnessContract, type OpenContractHarness } from '@cherrystudio/agent-behavior'

import { openPiHarness } from './behaviorHarness'

// Declared difference D1 (README "Behavior ports"): coding-agent resumes no runs, jobs, waits or memo after a restart.
const lacks: ReadonlySet<ContractNeed> = new Set(['restart'])
const open: OpenContractHarness = async (install) => (await openPiHarness(install)).harness

// Catches a coding-agent adapter that breaks a promise of the harness ports; each case names the bug it catches.
describe('agent-behavior harness contract on coding-agent', () => {
  for (const contractCase of harnessContract)
    (contractCase.needs.some((need) => lacks.has(need)) ? it.skip : it)(contractCase.name, () => contractCase.run(open))
})
