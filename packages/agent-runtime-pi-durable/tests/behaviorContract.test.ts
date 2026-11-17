import { describe, it } from 'vitest'

import { harnessContract } from '@cherrystudio/agent-behavior'

import { openDurableHarness } from './behaviorHarness'

describe('agent-behavior contract on Pi Durable', () => {
  for (const test of harnessContract) {
    const unavailable = test.needs.some((need) => need === 'context-filter' || need === 'foreground-continuation')
    ;(unavailable ? it.skip : it)(
      test.name,
      async () => test.run(async (install) => (await openDurableHarness(install)).harness),
      10000
    )
  }
})
