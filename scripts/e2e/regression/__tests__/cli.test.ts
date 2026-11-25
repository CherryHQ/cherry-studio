import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

it.each([
  ['chat-stream-failure', 0],
  ['claude-stream-failure', 0],
  ['chat-stream-failure,claude-stream-failure', 0],
  ['all', 1]
] as const)('preflights %s without a run directory with exit code %s', (task, status) => {
  const result = spawnSync(
    process.execPath,
    [
      createRequire(import.meta.url).resolve('tsx/cli'),
      resolve('scripts/e2e/regression/cli.ts'),
      'preflight',
      '--task',
      task
    ],
    { encoding: 'utf8', timeout: 10_000 }
  )
  expect(result.status, result.stderr).toBe(status)
  if (status !== 0) expect(result.stderr).toContain('--run-dir is required for mock preflight')
})
