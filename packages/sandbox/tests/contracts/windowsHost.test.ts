import type * as os from 'node:os'

import { afterEach, expect, it, vi } from 'vitest'

import { MxcBackend } from '../../src/backends/mxc/MxcBackend.js'
import { createInstance } from '../../src/host/instance.js'
import { spec } from '../fixtures.js'

vi.mock('node:os', async (importOriginal) => ({
  ...(await importOriginal<typeof os>()),
  release: () => '10.0.20348'
}))
vi.mock('@microsoft/mxc-sdk/v1', () => {
  throw new Error('An unsupported Windows host must not load the native SDK')
})

const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
afterEach(() => Object.defineProperty(process, 'platform', platform))

it('refuses Windows Server 2022 before native setup or target launch', async () => {
  const request = spec(process.execPath)
  Object.defineProperty(process, 'platform', { value: 'win32' })
  const backend = new MxcBackend()
  const assessment = await backend.probe(request)
  expect(assessment.status).toBe('unavailable')
  expect(assessment.checks[0].reason).toContain('Windows 11 23H2 or newer')
  const instance = createInstance('old-windows', request, backend.launch('old-windows', request), backend.id)
  try {
    await expect(instance.ready).rejects.toMatchObject({ code: 'BACKEND_UNAVAILABLE' })
    expect(await instance.completion).toMatchObject({
      reason: 'startup-error',
      target: { status: 'not-started' },
      tree: 'gone',
      cleanup: 'complete'
    })
  } finally {
    await instance.stop()
  }
})
