import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'

import { resolveDshBunRuntime } from '../bunRuntime'

const runProcess = vi.hoisted(() => vi.fn())
const runtimeEnvironment = vi.hoisted(() => ({ isPackaged: true }))
vi.mock('node:child_process', () => ({
  execFile: Object.assign(vi.fn(), { [Symbol.for('nodejs.util.promisify.custom')]: runProcess })
}))
vi.mock('node:fs/promises', () => ({ readFile: vi.fn() }))
vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return runtimeEnvironment.isPackaged
    },
    getAppPath: () => path.join('/app', 'app.asar'),
    getLocale: () => 'en-US'
  }
}))

beforeEach(() => {
  runtimeEnvironment.isPackaged = true
  MockMainPreferenceServiceUtils.resetMocks()
  runProcess.mockReset().mockResolvedValue({ stdout: '1.3.14\n' })
  vi.mocked(readFile).mockReset().mockResolvedValue('1.3.14\n')
})

describe('required DSH Bun runtime', () => {
  it.each([
    [
      'en-US',
      true,
      'DSH could not start because its bundled runtime is unavailable. Reinstall Cherry Studio and try again.'
    ],
    [
      'en-US',
      false,
      'DSH could not start because its bundled runtime is unavailable. Run pnpm download:binaries in the development checkout and try again.'
    ],
    ['zh-CN', true, 'DSH 无法启动，因为内置运行时不可用。请重新安装 Cherry Studio 后重试。'],
    ['zh-CN', false, 'DSH 无法启动，因为内置运行时不可用。请在开发仓库中运行 pnpm download:binaries 后重试。']
  ] as const)(
    'localizes runtime recovery for %s (packaged: %s) and preserves the cause',
    async (language, isPackaged, message) => {
      MockMainPreferenceServiceUtils.setPreferenceValue('app.language', language)
      runtimeEnvironment.isPackaged = isPackaged
      const cause = Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' })
      runProcess.mockRejectedValueOnce(cause)
      await expect(resolveDshBunRuntime()).rejects.toMatchObject({ message, cause })
    }
  )

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
