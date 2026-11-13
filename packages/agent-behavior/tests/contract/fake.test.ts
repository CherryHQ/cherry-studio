import { describe, it } from 'vitest'

import { harnessContract } from '../../src/contract/cases'
import { createFakeHarness } from '../../src/fake/fakeHarness'

// Catches the fake drifting from the contract both adapters must pass; the fake runs every case and skips none.
describe('harness contract on the fake', () => {
  for (const contractCase of harnessContract)
    it(contractCase.name, () => contractCase.run(async (install) => createFakeHarness({ install })))
})
