import type { BinaryToolSnapshot } from '@shared/types/binary'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const snapshotRef = vi.hoisted(() => ({
  value: { name: 'rtk', availability: { source: 'none' } } as BinaryToolSnapshot
}))
const binaryManagerMock = vi.hoisted(() => ({ getToolSnapshots: vi.fn() }))
const mockExecFileAsync = vi.hoisted(() => vi.fn())

// Mock dependencies before importing the module
vi.mock('node:child_process', () => ({
  execFile: vi.fn()
}))

vi.mock('node:util', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...(actual as object), promisify: () => mockExecFileAsync }
})

vi.mock('node:os', () => ({
  default: {
    homedir: () => '/home/testuser'
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    })
  }
}))

vi.mock('electron', () => ({
  app: {
    isPackaged: false
  }
}))

vi.mock('@main/core/platform', () => ({
  isWin: false
}))

vi.mock('@application', () => ({
  application: {
    get: vi.fn(() => binaryManagerMock),
    getPath: (key: string) => {
      if (key === 'app.root.resources.binaries') return '/app/resources/binaries'
      if (key === 'cherry.bin') return '/home/testuser/.cherrystudio/bin'
      if (key === 'feature.binary.data') return '/home/testuser/.cherrystudio/binary-manager'
      return '/app/resources'
    }
  }
}))

vi.mock('@main/utils/shellEnv', () => ({
  getRawShellEnv: vi.fn(async () => ({ PATH: '/usr/local/bin:/usr/bin', MISE_DATA_DIR: '/user/mise' }))
}))

vi.mock('semver', () => ({
  gte: (version: string, range: string) => {
    const [aMaj, aMin, aPat] = version.split('.').map(Number)
    const [bMaj, bMin, bPat] = range.split('.').map(Number)
    if (aMaj !== bMaj) return aMaj > bMaj
    if (aMin !== bMin) return aMin > bMin
    return aPat >= bPat
  }
}))

import { rtkRewrite } from '../rtk'

describe('rtk utils', () => {
  let now = 0

  beforeEach(() => {
    vi.clearAllMocks()
    now += 60_001
    vi.spyOn(Date, 'now').mockReturnValue(now)
    snapshotRef.value = { name: 'rtk', availability: { source: 'none' } }
    binaryManagerMock.getToolSnapshots.mockImplementation(async () => ({ rtk: snapshotRef.value }))
    mockExecFileAsync.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('rtkRewrite', () => {
    it('should return null when rtk binary is not found', async () => {
      const result = await rtkRewrite('ls -la')

      expect(result).toBeNull()
      expect(binaryManagerMock.getToolSnapshots).toHaveBeenCalledWith(['rtk'])
      expect(mockExecFileAsync).not.toHaveBeenCalled()
    })

    it('uses a system RTK path and preserves the raw user environment', async () => {
      snapshotRef.value = { name: 'rtk', availability: { source: 'system', path: '/usr/local/bin/rtk' } }
      mockExecFileAsync
        .mockResolvedValueOnce({ stdout: 'rtk 0.30.1', stderr: '' })
        .mockResolvedValueOnce({ stdout: 'rg --files', stderr: '' })

      await expect(rtkRewrite('find . -type f')).resolves.toBe('rg --files')
      expect(mockExecFileAsync).toHaveBeenNthCalledWith(
        1,
        '/usr/local/bin/rtk',
        ['--version'],
        expect.objectContaining({ env: { PATH: '/usr/local/bin:/usr/bin', MISE_DATA_DIR: '/user/mise' } })
      )
      expect(mockExecFileAsync).toHaveBeenNthCalledWith(
        2,
        '/usr/local/bin/rtk',
        ['rewrite', 'find . -type f'],
        expect.objectContaining({ env: { PATH: '/usr/local/bin:/usr/bin', MISE_DATA_DIR: '/user/mise' } })
      )
    })

    it('shares one atomic probe across concurrent rewrites', async () => {
      snapshotRef.value = { name: 'rtk', availability: { source: 'system', path: '/usr/local/bin/rtk' } }
      let resolveVersion!: (value: { stdout: string; stderr: string }) => void
      const versionGate = new Promise<{ stdout: string; stderr: string }>((resolve) => {
        resolveVersion = resolve
      })
      mockExecFileAsync.mockImplementation(async (_path: string, args: string[]) => {
        if (args[0] === '--version') return versionGate
        return { stdout: `rewritten:${args[1]}`, stderr: '' }
      })

      const first = rtkRewrite('first')
      const second = rtkRewrite('second')
      await vi.waitFor(() => expect(mockExecFileAsync).toHaveBeenCalledTimes(1))
      resolveVersion({ stdout: 'rtk 0.30.1', stderr: '' })

      await expect(Promise.all([first, second])).resolves.toEqual(['rewritten:first', 'rewritten:second'])
      expect(binaryManagerMock.getToolSnapshots).toHaveBeenCalledTimes(1)
      expect(mockExecFileAsync).toHaveBeenCalledTimes(3)
      for (const call of mockExecFileAsync.mock.calls) {
        expect(call[0]).toBe('/usr/local/bin/rtk')
        expect(call[2]).toEqual(
          expect.objectContaining({ env: { PATH: '/usr/local/bin:/usr/bin', MISE_DATA_DIR: '/user/mise' } })
        )
      }
    })

    it('should return null when rewritten command equals original', async () => {
      snapshotRef.value = {
        name: 'rtk',
        availability: { source: 'mise', path: '/managed/shims/rtk', version: '0.30.1' },
        application: { status: 'applied', version: '0.30.1' }
      }

      // First call: version check, second call: rewrite
      mockExecFileAsync
        .mockResolvedValueOnce({ stdout: 'rtk 0.30.1', stderr: '' })
        .mockResolvedValueOnce({ stdout: 'ls -la', stderr: '' })

      const result = await rtkRewrite('ls -la')

      expect(result).toBeNull()
    })

    it('should return null when rtk exits with error (no rewrite available)', async () => {
      snapshotRef.value = {
        name: 'rtk',
        availability: { source: 'mise', path: '/managed/shims/rtk', version: '0.30.1' },
        application: { status: 'applied', version: '0.30.1' }
      }

      mockExecFileAsync
        .mockResolvedValueOnce({ stdout: 'rtk 0.30.1', stderr: '' })
        .mockRejectedValueOnce(new Error('exit code 1'))

      const result = await rtkRewrite('some-command')

      expect(result).toBeNull()
    })
  })
})
