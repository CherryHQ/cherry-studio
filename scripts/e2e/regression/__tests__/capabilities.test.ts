import { execFileSync } from 'node:child_process'

import { vi } from 'vitest'

import { probeCapabilities } from '../capabilities'
import { getRunPaths } from '../paths'

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }))

it.each([
  { label: 'recovers after one timeout', timeouts: 1, available: true },
  { label: 'remains unavailable after repeated timeouts', timeouts: 2, available: false }
])('Windows desktop automation $label', ({ timeouts, available }) => {
  let remainingTimeouts = timeouts
  vi.mocked(execFileSync).mockImplementation((_, args) => {
    if (Array.isArray(args) && args.some((arg) => arg.includes('WScript.Shell')) && remainingTimeouts > 0) {
      remainingTimeouts--
      throw Object.assign(new Error('spawnSync powershell.exe ETIMEDOUT'), { code: 'ETIMEDOUT' })
    }
    return ''
  })

  const result = probeCapabilities('windows', getRunPaths('unused-regression-run'))

  expect(result.desktopAutomation.available).toBe(available)
  expect(result.systemFilePicker.available).toBe(available)
  expect(result.globalShortcut.available).toBe(available)
})
