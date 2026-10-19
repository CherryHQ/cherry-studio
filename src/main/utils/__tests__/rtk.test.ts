import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as ProcessRunnerModule from '@main/utils/processRunner'
import type { BinaryToolSnapshot } from '@shared/types/binary'

const snapshotRef = vi.hoisted(() => ({
  value: { name: 'rtk', availability: { source: 'none' } } as BinaryToolSnapshot
}))
const binaryManagerMock = vi.hoisted(() => ({ getToolSnapshots: vi.fn() }))
const executeCommandMock = vi.hoisted(() => vi.fn())
const loggerMock = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
}))

// Keep the real module (CommandFailedError) and override only executeCommand
vi.mock('@main/utils/processRunner', async (importOriginal) => ({
  ...(await importOriginal<typeof ProcessRunnerModule>()),
  executeCommand: executeCommandMock
}))

vi.mock('node:os', () => ({
  default: {
    homedir: () => '/home/testuser'
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => loggerMock
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

import { CommandFailedError } from '@main/utils/processRunner'

import { rtkRewrite } from '../rtk'

describe('rtk utils', () => {
  let now = 0

  beforeEach(() => {
    vi.clearAllMocks()
    now += 60_001
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    snapshotRef.value = { name: 'rtk', availability: { source: 'none' } }
    binaryManagerMock.getToolSnapshots.mockImplementation(async () => ({ rtk: snapshotRef.value }))
    executeCommandMock.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
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
      await vi.advanceTimersByTimeAsync(10_000)

      await expect(pending).resolves.toBeNull()
      expect(executeCommandMock).not.toHaveBeenCalled()
      vi.useRealTimers()
    })

    it('retries a timed-out probe after the short failure TTL instead of caching it for a minute', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      let resolveSnapshot!: (value: { rtk: BinaryToolSnapshot }) => void
      binaryManagerMock.getToolSnapshots.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveSnapshot = resolve
        })
      )

      const first = rtkRewrite('ls -la')
      await vi.advanceTimersByTimeAsync(10_000)
      await expect(first).resolves.toBeNull()

      // A late snapshot must not promote the timed-out probe to an available cache entry.
      resolveSnapshot({
        rtk: { name: 'rtk', availability: { source: 'system', path: '/obsolete/rtk' } }
      })
      await vi.advanceTimersByTimeAsync(0)
      snapshotRef.value = { name: 'rtk', availability: { source: 'system', path: '/usr/local/bin/rtk' } }
      executeCommandMock.mockResolvedValueOnce('rtk 0.44.2').mockResolvedValueOnce('rg --files')
      now += 14_999

      await expect(rtkRewrite('find . -type f')).resolves.toBeNull()
      expect(executeCommandMock).not.toHaveBeenCalled()
      expect(binaryManagerMock.getToolSnapshots).toHaveBeenCalledTimes(1)
      now += 1

      await expect(rtkRewrite('find . -type f')).resolves.toBe('rg --files')
      expect(binaryManagerMock.getToolSnapshots).toHaveBeenCalledTimes(2)
      expect(executeCommandMock).toHaveBeenLastCalledWith(
        '/usr/local/bin/rtk',
        ['rewrite', 'find . -type f'],
        expect.objectContaining({ capture: true })
      )
      vi.useRealTimers()
    })

    it.each(['snapshot rejection', 'snapshot timeout', 'version rejection', 'version timeout'])(
      'invalidates an available cache after a %s and retries after the failure TTL',
      async (failure) => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        snapshotRef.value = { name: 'rtk', availability: { source: 'system', path: '/usr/local/bin/rtk' } }
        executeCommandMock.mockImplementation(async (_path: string, args: string[]) =>
          args[0] === '--version' ? 'rtk 0.44.2' : 'rg --files'
        )
        await expect(rtkRewrite('ls -la')).resolves.toBe('rg --files')
        now += 60_000

        if (failure === 'snapshot rejection') {
          binaryManagerMock.getToolSnapshots.mockRejectedValueOnce(new Error('mise unavailable'))
        } else if (failure === 'snapshot timeout') {
          binaryManagerMock.getToolSnapshots.mockReturnValueOnce(new Promise(() => {}))
        } else if (failure === 'version rejection') {
          executeCommandMock.mockRejectedValueOnce(new CommandFailedError(2, '', 'version probe failed'))
        } else {
          executeCommandMock.mockImplementationOnce(
            (_path: string, _args: string[], options: { timeout: number }) =>
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error(`Command timed out after ${options.timeout}ms`)), options.timeout)
              )
          )
        }

        const refresh = rtkRewrite('ls -la')
        await vi.advanceTimersByTimeAsync(10_000)
        await expect(refresh).resolves.toBeNull()
        now += 14_999
        await expect(rtkRewrite('ls -la')).resolves.toBeNull()
        expect(binaryManagerMock.getToolSnapshots).toHaveBeenCalledTimes(2)
        expect(executeCommandMock.mock.calls.filter(([, args]) => args[0] === 'rewrite')).toHaveLength(1)

        now += 1
        await expect(rtkRewrite('ls -la')).resolves.toBe('rg --files')
        expect(binaryManagerMock.getToolSnapshots).toHaveBeenCalledTimes(3)
        vi.useRealTimers()
      }
    )

    it.each([
      { name: 'missing', availability: { source: 'none' } },
      { name: 'batch wrapper', availability: { source: 'system', path: '/usr/local/bin/rtk.cmd' } },
      { name: 'old version', availability: { source: 'system', path: '/usr/local/bin/rtk' } }
    ] as const)('caches a definitive $name probe until the full TTL expires', async ({ availability }) => {
      snapshotRef.value = { name: 'rtk', availability }
      executeCommandMock.mockResolvedValueOnce('rtk 0.22.0')

      await expect(rtkRewrite('ls -la')).resolves.toBeNull()
      snapshotRef.value = { name: 'rtk', availability: { source: 'system', path: '/usr/local/bin/rtk' } }
      executeCommandMock.mockReset().mockResolvedValueOnce('rtk 0.44.2').mockResolvedValueOnce('rg --files')
      now += 59_999
      await expect(rtkRewrite('ls -la')).resolves.toBeNull()
      expect(binaryManagerMock.getToolSnapshots).toHaveBeenCalledTimes(1)
      expect(executeCommandMock).not.toHaveBeenCalled()

      now += 1
      await expect(rtkRewrite('ls -la')).resolves.toBe('rg --files')
      expect(binaryManagerMock.getToolSnapshots).toHaveBeenCalledTimes(2)
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

    it('accepts a rewrite that rtk reports via its non-standard exit code 3 (rtk-ai/rtk#3634)', async () => {
      snapshotRef.value = { name: 'rtk', availability: { source: 'system', path: '/usr/local/bin/rtk' } }

      executeCommandMock
        .mockResolvedValueOnce('rtk 0.51.0')
        .mockRejectedValueOnce(new CommandFailedError(3, 'rtk ls -la\n', ''))

      await expect(rtkRewrite('ls -la /tmp')).resolves.toBe('rtk ls -la')
      expect(loggerMock.warn).toHaveBeenCalledWith(
        'rtk rewrite reported success via its non-standard exit code 3 (rtk-ai/rtk#3634)',
        expect.objectContaining({ code: 3 })
      )
    })

    it('treats an exit 3 without usable output as a failure', async () => {
      snapshotRef.value = { name: 'rtk', availability: { source: 'system', path: '/usr/local/bin/rtk' } }

      executeCommandMock
        .mockResolvedValueOnce('rtk 0.51.0')
        .mockRejectedValueOnce(new CommandFailedError(3, '  \n', ''))

      await expect(rtkRewrite('ls -la')).resolves.toBeNull()
    })

    it('stays silent for the documented exit 1 "no rewrite" outcome', async () => {
      snapshotRef.value = { name: 'rtk', availability: { source: 'system', path: '/usr/local/bin/rtk' } }

      executeCommandMock
        .mockResolvedValueOnce('rtk 0.51.0')
        .mockRejectedValueOnce(new CommandFailedError(1, '', 'no rtk equivalent'))

      await expect(rtkRewrite('some-command')).resolves.toBeNull()
      expect(loggerMock.warn).not.toHaveBeenCalled()
    })

    it('logs unexpected rewrite failures so they are distinguishable from "no rewrite"', async () => {
      snapshotRef.value = { name: 'rtk', availability: { source: 'system', path: '/usr/local/bin/rtk' } }

      executeCommandMock
        .mockResolvedValueOnce('rtk 0.51.0')
        .mockRejectedValueOnce(new CommandFailedError(2, '', 'rtk: internal error'))

      await expect(rtkRewrite('some-command')).resolves.toBeNull()
      expect(loggerMock.warn).toHaveBeenCalledWith('rtk rewrite failed', expect.objectContaining({ code: 2 }))
    })
  })
})
