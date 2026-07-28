import type { BinaryToolSnapshot } from '@shared/types/binary'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const snapshotRef = vi.hoisted(() => ({
  value: { name: 'rtk', availability: { source: 'none' } } as BinaryToolSnapshot
}))
const binaryManagerMock = vi.hoisted(() => ({ getToolSnapshots: vi.fn() }))
const executeCommandMock = vi.hoisted(() => vi.fn())

// Mock dependencies before importing the module
vi.mock('@main/utils/processRunner', () => ({
  executeCommand: executeCommandMock
}))

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
      if (key === 'feature.binary.data') return '/home/testuser/.config/CherryStudio/Toolchain/mise'
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
    executeCommandMock.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('rtkRewrite', () => {
    it('should return null when rtk binary is not found', async () => {
      const result = await rtkRewrite('ls -la')

      expect(result).toBeNull()
      expect(binaryManagerMock.getToolSnapshots).toHaveBeenCalledWith(['rtk'])
      expect(executeCommandMock).not.toHaveBeenCalled()
    })

    it('returns null without throwing when the snapshot probe rejects', async () => {
      binaryManagerMock.getToolSnapshots.mockRejectedValueOnce(new Error('mise exploded'))

      await expect(rtkRewrite('ls -la')).resolves.toBeNull()
      expect(executeCommandMock).not.toHaveBeenCalled()
    })

    it('returns null when the snapshot probe exceeds its timeout budget', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      // A snapshot query that never settles must not block the awaiting hook.
      binaryManagerMock.getToolSnapshots.mockReturnValue(new Promise(() => {}))

      const pending = rtkRewrite('ls -la')
      await vi.advanceTimersByTimeAsync(3000)

      await expect(pending).resolves.toBeNull()
      expect(executeCommandMock).not.toHaveBeenCalled()
      vi.useRealTimers()
    })

    it('uses a system RTK path and preserves the raw user environment', async () => {
      snapshotRef.value = { name: 'rtk', availability: { source: 'system', path: '/usr/local/bin/rtk' } }
      executeCommandMock.mockResolvedValueOnce('rtk 0.30.1').mockResolvedValueOnce('rg --files')

      await expect(rtkRewrite('find . -type f')).resolves.toBe('rg --files')
      expect(executeCommandMock).toHaveBeenNthCalledWith(
        1,
        '/usr/local/bin/rtk',
        ['--version'],
        expect.objectContaining({
          capture: true,
          env: { PATH: '/usr/local/bin:/usr/bin', MISE_DATA_DIR: '/user/mise' }
        })
      )
      expect(executeCommandMock).toHaveBeenNthCalledWith(
        2,
        '/usr/local/bin/rtk',
        ['rewrite', 'find . -type f'],
        expect.objectContaining({
          capture: true,
          env: { PATH: '/usr/local/bin:/usr/bin', MISE_DATA_DIR: '/user/mise' }
        })
      )
    })

    it('disables rewrite when rtk resolves to a Windows batch wrapper', async () => {
      // Passing a model-generated shell command as an argument to a .cmd/.bat
      // crosses cmd.exe's parser, which is not reliably escapable — the probe
      // must refuse the wrapper instead of executing through it.
      snapshotRef.value = {
        name: 'rtk',
        availability: { source: 'system', path: 'C:\\Users\\V\\AppData\\Roaming\\npm\\rtk.CMD' }
      }

      await expect(rtkRewrite('echo "quoted" & whoami %PATH%')).resolves.toBeNull()
      expect(executeCommandMock).not.toHaveBeenCalled()
    })

    it('shares one atomic probe across concurrent rewrites', async () => {
      snapshotRef.value = { name: 'rtk', availability: { source: 'system', path: '/usr/local/bin/rtk' } }
      let resolveVersion!: (value: { stdout: string; stderr: string }) => void
      const versionGate = new Promise<{ stdout: string; stderr: string }>((resolve) => {
        resolveVersion = resolve
      })
      executeCommandMock.mockImplementation(async (_path: string, args: string[]) => {
        if (args[0] === '--version') return versionGate.then((result) => result.stdout)
        return `rewritten:${args[1]}`
      })

      const first = rtkRewrite('first')
      const second = rtkRewrite('second')
      await vi.waitFor(() => expect(executeCommandMock).toHaveBeenCalledTimes(1))
      resolveVersion({ stdout: 'rtk 0.30.1', stderr: '' })

      await expect(Promise.all([first, second])).resolves.toEqual(['rewritten:first', 'rewritten:second'])
      expect(binaryManagerMock.getToolSnapshots).toHaveBeenCalledTimes(1)
      expect(executeCommandMock).toHaveBeenCalledTimes(3)
      for (const call of executeCommandMock.mock.calls) {
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
      executeCommandMock.mockResolvedValueOnce('rtk 0.30.1').mockResolvedValueOnce('ls -la')

      const result = await rtkRewrite('ls -la')

      expect(result).toBeNull()
    })

    it('should return null when rtk exits with error (no rewrite available)', async () => {
      snapshotRef.value = {
        name: 'rtk',
        availability: { source: 'mise', path: '/managed/shims/rtk', version: '0.30.1' },
        application: { status: 'applied', version: '0.30.1' }
      }

      executeCommandMock.mockResolvedValueOnce('rtk 0.30.1').mockRejectedValueOnce(new Error('exit code 1'))

      const result = await rtkRewrite('some-command')

      expect(result).toBeNull()
    })
  })
})
