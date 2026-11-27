import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'

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

it.each([
  ['“osascript” wants access to control “Preview”.', 'desktop-automation'],
  ['“hosted-compute-agent” wants access to control “Safari”.', 'desktop-automation'],
  ['“Cherry Studio E2E abc123” wants access to control “Google Chrome”.', 'desktop-automation'],
  ['“osascript” wants access to control “Terminal”.', 'terminal-automation'],
  ['“osascript” wants access to control “System Events”.', 'terminal-automation'],
  ['“Unknown app” wants access to control “Preview”.', null],
  ['“osascript” wants access to control “Keychain Access”.', null],
  ['“osascript” wants access to the camera.', null]
])('only accepts expected disposable-runner automation: %s', (message, expected) => {
  const source = readFileSync(script, 'utf8')
  const result = runInNewContext(source + '\nclassifyPermissionDialog(' + JSON.stringify(message) + ')', {
    ObjC: { import: () => {} }
  })
  expect(result).toBe(expected)
})
