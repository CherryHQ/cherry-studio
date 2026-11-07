import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('../macPermissionObserver.jxa', import.meta.url))

it.skipIf(process.platform !== 'darwin')('compiles the CI permission observer without opening applications', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cherry-permission-syntax-'))
  try {
    const compiled = join(directory, 'observer.scpt')
    execFileSync('osacompile', ['-l', 'JavaScript', '-o', compiled, script])
    expect(readFileSync(compiled).byteLength).toBeGreaterThan(0)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

it.skipIf(process.platform !== 'darwin').each([
  ['false', 'github-hosted'],
  ['true', 'self-hosted']
])('rejects %s/%s before inspecting desktop applications', (actions, environment) => {
  const result = spawnSync('osascript', ['-l', 'JavaScript', script], {
    env: { ...process.env, GITHUB_ACTIONS: actions, RUNNER_ENVIRONMENT: environment },
    encoding: 'utf8',
    timeout: 5000
  })
  expect(result.status).toBe(1)
  expect(result.stderr).toContain('Disposable hosted runner required')
})

it.skipIf(process.platform !== 'darwin')('rejects a run outside the disposable runner directory', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cherry-permission-boundary-'))
  try {
    const result = spawnSync('osascript', ['-l', 'JavaScript', script, directory], {
      env: {
        ...process.env,
        GITHUB_ACTIONS: 'true',
        RUNNER_ENVIRONMENT: 'github-hosted',
        RUNNER_TEMP: join(directory, 'runner')
      },
      encoding: 'utf8',
      timeout: 5000
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Run directory must be below RUNNER_TEMP')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
