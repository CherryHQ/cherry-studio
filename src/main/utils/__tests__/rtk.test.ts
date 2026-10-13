import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { BinaryToolSnapshot } from '@shared/types/binary'

import type { rtkRewrite as RtkRewrite } from '../rtk'

const snapshotRef = vi.hoisted(() => ({
  value: { name: 'rtk', availability: { source: 'none' } } as BinaryToolSnapshot
}))
const binaryManagerMock = vi.hoisted(() => ({ getToolSnapshots: vi.fn() }))
const executeCommandMock = vi.hoisted(() => vi.fn())
const loggerMock = vi.hoisted(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }))

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

describe('rtk utils', () => {
  let now = 0
  let rtkRewrite: typeof RtkRewrite

  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    now += 60_001
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    snapshotRef.value = { name: 'rtk', availability: { source: 'none' } }
    binaryManagerMock.getToolSnapshots.mockImplementation(async () => ({ rtk: snapshotRef.value }))
    executeCommandMock.mockReset()
    rtkRewrite = (await import('../rtk')).rtkRewrite
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
      await vi.advanceTimersByTimeAsync(3000)

      await expect(pending).resolves.toBeNull()
      expect(executeCommandMock).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(27_000)
    })

    it('uses a slow but successful background probe on the next rewrite', async () => {
      // Catches a slow mise shim being cached as missing rtk for a full minute.
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      const snapshot: BinaryToolSnapshot = {
        name: 'rtk',
        availability: { source: 'system', path: '/usr/local/bin/rtk' }
      }
      binaryManagerMock.getToolSnapshots.mockImplementationOnce(
        () => new Promise((resolve) => setTimeout(() => resolve({ rtk: snapshot }), 8_000))
      )
      executeCommandMock.mockResolvedValueOnce('rtk 0.30.1').mockResolvedValueOnce('rg --files')

      const first = rtkRewrite('ls -la')
      await vi.advanceTimersByTimeAsync(3_000)
      await expect(first).resolves.toBeNull()
      expect(executeCommandMock).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(5_000)
      await expect(rtkRewrite('ls -la')).resolves.toBe('rg --files')
      expect(binaryManagerMock.getToolSnapshots).toHaveBeenCalledTimes(1)
      expect(executeCommandMock).toHaveBeenNthCalledWith(
        1,
        '/usr/local/bin/rtk',
        ['--version'],
        expect.objectContaining({ timeout: 12_000 })
      )
    })

    it('retries an indeterminate probe after five seconds', async () => {
      // Catches a timed-out probe suppressing a later successful install check for sixty seconds.
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      binaryManagerMock.getToolSnapshots.mockReturnValueOnce(new Promise(() => {}))
      const first = rtkRewrite('ls -la')
      await vi.advanceTimersByTimeAsync(3_000)
      await expect(first).resolves.toBeNull()
      await vi.advanceTimersByTimeAsync(27_000)
      expect(loggerMock.warn).toHaveBeenCalledWith(
        'rtk availability probe exceeded 30000ms; command rewrite skipped, retrying in 5000ms',
        { inlineWaitMs: 3000 }
      )

      snapshotRef.value = { name: 'rtk', availability: { source: 'system', path: '/usr/local/bin/rtk' } }
      executeCommandMock.mockResolvedValueOnce('rtk 0.30.1').mockResolvedValueOnce('rg --files')
      now += 5_000
      await expect(rtkRewrite('ls -la')).resolves.toBeNull()
      await vi.advanceTimersByTimeAsync(0)
      expect(binaryManagerMock.getToolSnapshots).toHaveBeenCalledTimes(2)
      await expect(rtkRewrite('ls -la')).resolves.toBe('rg --files')
    })

    it('warns once for consecutive probe errors', async () => {
      // Catches repeated transient failures flooding the warning log on every retry.
      binaryManagerMock.getToolSnapshots.mockRejectedValueOnce(new Error('mise unavailable'))
      await expect(rtkRewrite('ls -la')).resolves.toBeNull()
      expect(loggerMock.warn).toHaveBeenCalledWith('rtk availability probe failed; retrying in 5000ms', {
        error: 'mise unavailable'
      })

      now += 5_000
      binaryManagerMock.getToolSnapshots.mockRejectedValueOnce(new Error('mise unavailable'))
      await expect(rtkRewrite('ls -la')).resolves.toBeNull()
      await vi.waitFor(() =>
        expect(loggerMock.debug).toHaveBeenCalledWith('rtk availability probe failed; retrying in 5000ms', {
          error: 'mise unavailable'
        })
      )
      expect(loggerMock.warn).toHaveBeenCalledTimes(1)
      expect(binaryManagerMock.getToolSnapshots).toHaveBeenCalledTimes(2)
    })

    it('keeps a known-good execution through a failed refresh', async () => {
      // Catches a transient refresh failure disabling a working rewrite for the cache lifetime.
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      snapshotRef.value = { name: 'rtk', availability: { source: 'system', path: '/usr/local/bin/rtk' } }
      executeCommandMock.mockImplementation(async (_path: string, args: string[]) =>
        args[0] === '--version' ? 'rtk 0.30.1' : 'rg --files'
      )
      await expect(rtkRewrite('ls -la')).resolves.toBe('rg --files')
      now += 60_000
      binaryManagerMock.getToolSnapshots.mockReturnValueOnce(new Promise(() => {}))

      const duringRefresh = rtkRewrite('ls -la')
      await vi.advanceTimersByTimeAsync(3_000)
      await expect(duringRefresh).resolves.toBe('rg --files')
      await vi.advanceTimersByTimeAsync(27_000)
      await expect(rtkRewrite('ls -la')).resolves.toBe('rg --files')
      expect(binaryManagerMock.getToolSnapshots).toHaveBeenCalledTimes(2)
    })

    it('does not stall the hook twice for one slow probe', async () => {
      // Catches every Bash call paying the inline wait for the same hung snapshot query.
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      binaryManagerMock.getToolSnapshots.mockReturnValueOnce(new Promise(() => {}))
      const first = rtkRewrite('ls -la')
      await vi.advanceTimersByTimeAsync(3_000)
      await expect(first).resolves.toBeNull()
      await expect(rtkRewrite('ls -la')).resolves.toBeNull()
      expect(binaryManagerMock.getToolSnapshots).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(27_000)
    })

    it.each([
      {
        name: 'absent',
        snapshot: { name: 'rtk', availability: { source: 'none' } } as BinaryToolSnapshot,
        warning: 'rtk binary not found; command rewrite disabled until RTK is installed from Settings → Plugins',
        context: undefined
      },
      {
        name: 'batch wrapper',
        snapshot: {
          name: 'rtk',
          availability: { source: 'system', path: 'C:\\Users\\V\\rtk.CMD' }
        } as BinaryToolSnapshot,
        warning: 'rtk resolves to a batch wrapper; command rewrite disabled',
        context: { path: 'C:\\Users\\V\\rtk.CMD' }
      },
      {
        name: 'old version',
        snapshot: { name: 'rtk', availability: { source: 'system', path: '/usr/local/bin/rtk' } } as BinaryToolSnapshot,
        warning: 'rtk version too old (need >= 0.23.0)',
        context: { version: '0.22.0' }
      }
    ])('keeps a definite $name result for the full TTL', async ({ snapshot, warning, context }) => {
      // Catches definite absence, wrapper, or old-version checks being retried before their TTL.
      snapshotRef.value = snapshot
      executeCommandMock.mockResolvedValue('rtk 0.22.0')
      await expect(rtkRewrite('ls -la')).resolves.toBeNull()
      now += 59_999
      await expect(rtkRewrite('ls -la')).resolves.toBeNull()
      expect(binaryManagerMock.getToolSnapshots).toHaveBeenCalledTimes(1)
      expect(loggerMock.warn).toHaveBeenCalledWith(warning, ...(context ? [context] : []))
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

    it('rewrites when the system RTK version cannot be parsed', async () => {
      // Catches a new false negative on unparseable version output.
      snapshotRef.value = { name: 'rtk', availability: { source: 'system', path: '/usr/local/bin/rtk' } }
      executeCommandMock.mockResolvedValueOnce('rtk (unknown build)').mockResolvedValueOnce('rg --files')

      await expect(rtkRewrite('ls -la')).resolves.toBe('rg --files')
      expect(executeCommandMock).toHaveBeenCalledWith(
        '/usr/local/bin/rtk',
        ['rewrite', 'ls -la'],
        expect.objectContaining({ capture: true })
      )
      expect(loggerMock.info).not.toHaveBeenCalled()
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
