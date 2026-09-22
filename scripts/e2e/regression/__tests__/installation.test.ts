import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
    expect(execFileSync).toHaveBeenCalledOnce()
    expect(process.env.GH_TOKEN).toBe('test-token')
  } finally {
    vi.unstubAllEnvs()
    vi.resetAllMocks()
    rmSync(directory, { recursive: true, force: true })
  }
})
