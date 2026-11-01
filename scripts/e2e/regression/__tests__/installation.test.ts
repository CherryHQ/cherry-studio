import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { installReleaseArtifact } from '../installation'
import { ensureRunDirectories, getRunPaths } from '../paths'

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }))

it('installs Windows releases without exposing GitHub credentials to the installer', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cherry-installer-'))
  const paths = getRunPaths(directory)
  ensureRunDirectories(paths)
  const executable = join(paths.installed, 'Cherry Studio.exe')
  writeFileSync(executable, '')
  for (const key of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN', 'gh_token']) {
    vi.stubEnv(key, 'test-token')
  }
  vi.stubEnv('SystemRoot', 'C:\\Windows')
  vi.mocked(execFileSync).mockImplementation((_file, _args, options) => {
    const environment = (options as { env: NodeJS.ProcessEnv }).env
    expect(environment).toBeDefined()
    expect(Object.keys(environment).filter((key) => /^(GH|GITHUB)_(TOKEN|ENTERPRISE_TOKEN)$/i.test(key))).toEqual([])
    expect(environment.SystemRoot).toBe('C:\\Windows')
    return Buffer.alloc(0)
  })
  try {
    const record = installReleaseArtifact(paths, 'windows', join(paths.artifacts, 'setup.exe'), 'test-sha')
    expect(record.executablePath).toBe(executable)
    expect(process.env.GH_TOKEN).toBe('test-token')
  } finally {
    vi.unstubAllEnvs()
    vi.resetAllMocks()
    rmSync(directory, { recursive: true, force: true })
  }
})

// Catch treating an early executable file as a completed NSIS installation.
it('waits for installer exit before publishing the installation record', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cherry-installer-wait-'))
  const paths = getRunPaths(directory)
  ensureRunDirectories(paths)
  const executable = join(paths.installed, 'Cherry Studio.exe')
  const completed = join(directory, 'completed')
  const actual = await vi.importActual<{ execFileSync: typeof execFileSync }>('node:child_process')
  vi.mocked(execFileSync).mockImplementation(() =>
    actual.execFileSync(process.execPath, [
      '-e',
      `
    const fs = require('node:fs');
    fs.writeFileSync(${JSON.stringify(executable)}, 'partial');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    if (fs.existsSync(${JSON.stringify(paths.installation)})) process.exit(9);
    fs.writeFileSync(${JSON.stringify(executable)}, 'complete');
    fs.writeFileSync(${JSON.stringify(completed)}, 'installer exited');
  `
    ])
  )
  try {
    const record = installReleaseArtifact(paths, 'windows', join(paths.artifacts, 'setup.exe'), 'sha')
    expect(readFileSync(record.executablePath, 'utf8')).toBe('complete')
    expect(existsSync(completed)).toBe(true)
    expect(JSON.parse(readFileSync(paths.installation, 'utf8')).executablePath).toBe(executable)
  } finally {
    vi.resetAllMocks()
    rmSync(directory, { recursive: true, force: true })
  }
})

it.each(['nonzero installer exit', 'installer timeout'])('rejects a partial executable after %s', (reason) => {
  const directory = mkdtempSync(join(tmpdir(), 'cherry-installer-failed-'))
  const paths = getRunPaths(directory)
  ensureRunDirectories(paths)
  writeFileSync(join(paths.installed, 'Cherry Studio.exe'), 'partial')
  vi.mocked(execFileSync).mockImplementation(() => {
    throw new Error(reason)
  })
  try {
    expect(() => installReleaseArtifact(paths, 'windows', join(paths.artifacts, 'setup.exe'), 'sha')).toThrow(reason)
    expect(existsSync(paths.installation)).toBe(false)
  } finally {
    vi.resetAllMocks()
    rmSync(directory, { recursive: true, force: true })
  }
})
