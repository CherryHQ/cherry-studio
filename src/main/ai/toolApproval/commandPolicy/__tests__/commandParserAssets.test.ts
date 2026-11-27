import { expect, it, vi } from 'vitest'

import { application } from '@application'

import { evaluateCommandPolicy } from '../policyEvaluator'

// Catch a missing packaged grammar turning the default-allow policy into an unconditional allow.
it('blocks shell execution when the grammar assets cannot be loaded', async () => {
  vi.mocked(application.getPath).mockImplementation(() => '/missing-command-parser-assets')
  const result = await evaluateCommandPolicy({ command: 'git status', dialect: 'bash' })
  expect(result).toMatchObject({ effect: 'deny', hits: [], reason: expect.stringContaining('blocked') })
})
