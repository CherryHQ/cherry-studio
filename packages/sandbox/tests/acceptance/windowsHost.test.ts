import { expect, it } from 'vitest'

import { compilePolicy } from '../../src/backends/mxc/policy.js'
import { SandboxManager } from '../../src/host/SandboxManager.js'
import { spec } from '../fixtures.js'

it.skipIf(process.platform !== 'win32')('requires BaseContainer without Tier 3 host preparation', async () => {
  const { probe } = await import('@microsoft/mxc-sdk/v1')
  const request = spec(process.execPath, ['-e', 'process.exit(0)'])
  const assessment = probe(compilePolicy(request).request)
  expect(assessment, JSON.stringify(assessment)).toMatchObject({ tier: 'base-container' })
  expect(assessment.error).toBeUndefined()
  const manager = new SandboxManager()
  try {
    expect(await manager.probe(request)).toMatchObject({ status: 'ready', requirements: [] })
  } finally {
    await manager.dispose()
  }
})
