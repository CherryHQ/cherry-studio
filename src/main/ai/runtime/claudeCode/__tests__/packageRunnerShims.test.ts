import { execFile } from 'node:child_process'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import { afterEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const shimsDir = path.resolve(process.cwd(), 'resources/agent-cli-shims')
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('agent package-runner shims', () => {
  it('ships POSIX and Windows entrypoints', async () => {
    await expect(
      Promise.all(['npx', 'pipx', 'npx.cmd', 'pipx.cmd', 'pipx.ps1'].map((name) => readFile(path.join(shimsDir, name))))
    ).resolves.toHaveLength(5)
  })

  it.skipIf(process.platform === 'win32')('routes npx and pipx run to bundled runtimes', async () => {
    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'cherry-runner-shims-'))
    temporaryDirectories.push(temporaryDirectory)
    const recorder = path.join(temporaryDirectory, 'record-args')
    await writeFile(recorder, '#!/bin/sh\nprintf "%s\\n" "$@"\n')
    await chmod(recorder, 0o755)

    const npx = await execFileAsync(path.join(shimsDir, 'npx'), ['-y', 'prettier', '--check', '.'], {
      env: { ...process.env, CHERRY_STUDIO_BUN_PATH: recorder }
    })
    expect(npx.stdout.trim().split('\n')).toEqual(['x', '-y', 'prettier', '--check', '.'])

    const pipx = await execFileAsync(path.join(shimsDir, 'pipx'), ['run', '--spec', 'httpie', 'http', '--help'], {
      env: { ...process.env, CHERRY_STUDIO_UVX_PATH: recorder }
    })
    expect(pipx.stdout.trim().split('\n')).toEqual(['--from', 'httpie', 'http', '--help'])
  })

  it.skipIf(process.platform === 'win32')(
    'passes unsupported runner options to a system npx when present',
    async () => {
      const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'cherry-system-npx-'))
      temporaryDirectories.push(temporaryDirectory)
      const systemNpx = path.join(temporaryDirectory, 'npx')
      await writeFile(systemNpx, '#!/bin/sh\nprintf "system:%s\\n" "$*"\n')
      await chmod(systemNpx, 0o755)

      const result = await execFileAsync(path.join(shimsDir, 'npx'), ['--version'], {
        env: {
          ...process.env,
          PATH: `${shimsDir}:${temporaryDirectory}:${process.env.PATH ?? ''}`,
          CHERRY_STUDIO_BUN_PATH: '/does/not/run'
        }
      })

      expect(result.stdout.trim()).toBe('system:--version')
    }
  )
})
