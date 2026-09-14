import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'

import { resolveDshBunRuntime } from '../bunRuntime'

const runProcess = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', () => ({
  execFile: Object.assign(vi.fn(), { [Symbol.for('nodejs.util.promisify.custom')]: runProcess })
}))
vi.mock('node:fs/promises', () => ({ readFile: vi.fn() }))
vi.mock('electron', () => ({ app: { isPackaged: true, getAppPath: () => path.join('/app', 'app.asar') } }))

beforeEach(() => {
  runProcess.mockReset().mockResolvedValue({ stdout: '1.3.14\n' })
  vi.mocked(readFile).mockReset().mockResolvedValue('1.3.14\n')
})

describe('required DSH Bun runtime', () => {
  it('rejects a missing or non-executable bundled runtime instead of finding a host runtime', async () => {
    runProcess.mockRejectedValueOnce(Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }))
    await expect(resolveDshBunRuntime()).rejects.toThrow('pnpm download:binaries')
  })

  it('rejects a runnable runtime with the wrong version', async () => {
    runProcess.mockResolvedValueOnce({ stdout: '0.0.0\n' })
    await expect(resolveDshBunRuntime()).rejects.toMatchObject({
      cause: { message: 'Bundled Bun version mismatch: expected 1.3.14, got 0.0.0' }
    })
  })

  it('requires the version marker supplied by the build', async () => {
    vi.mocked(readFile).mockRejectedValueOnce(new Error('ENOENT'))
    await expect(resolveDshBunRuntime()).rejects.toThrow('Reinstall Cherry Studio')
    expect(runProcess).not.toHaveBeenCalled()
  })

  it('returns the packaged on-disk binary, never a user-installed Bun shim', async () => {
    const paths = vi
      .spyOn(application, 'getPath')
      .mockReturnValue(path.join('/app', 'app.asar', 'resources', 'binaries'))
    try {
      await expect(resolveDshBunRuntime()).resolves.toBe(
        path.join(
          '/app/app.asar.unpacked/resources/binaries',
          `${process.platform}-${process.arch}`,
          process.platform === 'win32' ? 'bun.exe' : 'bun'
        )
      )
    } finally {
      paths.mockRestore()
    }
  })
})
