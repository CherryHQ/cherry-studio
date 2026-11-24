import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, expect, it, vi } from 'vitest'

import { tryTestRipgrepPath } from './ripgrepTestUtils'

let root: string | undefined

afterEach(async () => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  if (root) await rm(root, { recursive: true, force: true })
})

it('refuses to skip ripgrep-dependent tests in CI when the prepared binary is missing', async () => {
  root = await mkdtemp(path.join(tmpdir(), 'cherry-missing-test-ripgrep-'))
  vi.stubEnv('CI', 'true')
  vi.spyOn(process, 'cwd').mockReturnValue(root)

  expect(() => tryTestRipgrepPath()).toThrow()
})
