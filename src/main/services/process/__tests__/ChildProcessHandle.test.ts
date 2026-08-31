import { EventEmitter } from 'events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('child_process', () => ({ spawn: vi.fn() }))
vi.mock('@main/utils/processRunner', () => ({
  crossPlatformSpawn: vi.fn(),
  terminateProcessTree: vi.fn(),
  waitForProcessClose: vi.fn(
    (child: EventEmitter, timeoutMs: number) =>
      new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => resolve(false), timeoutMs)
        child.once('close', () => {
          clearTimeout(timeout)
          resolve(true)
        })
      })
  )
}))
vi.mock('@main/utils/shellEnv', () => ({
  getShellEnv: vi.fn().mockResolvedValue({ PATH: '/usr/bin' })
}))

import { crossPlatformSpawn, terminateProcessTree } from '@main/utils/processRunner'
import { getShellEnv } from '@main/utils/shellEnv'

import { ChildProcessHandle } from '../ChildProcessHandle'

const mockSpawn = crossPlatformSpawn as unknown as ReturnType<typeof vi.fn>
const mockTerminateProcessTree = terminateProcessTree as unknown as ReturnType<typeof vi.fn>
const mockGetShellEnv = getShellEnv as unknown as ReturnType<typeof vi.fn>

function createMockChildProcess(pid = 1234, autoSpawn = true) {
  const cp = new EventEmitter() as any
  cp.pid = pid
  cp.stdout = new EventEmitter()
  cp.stderr = new EventEmitter()
  cp.kill = vi.fn().mockReturnValue(true)
  cp.unref = vi.fn()
  const once = cp.once.bind(cp)
  cp.once = (event: string, listener: (...args: unknown[]) => void) => {
    const result = once(event, listener)
    if (event === 'spawn' && autoSpawn) queueMicrotask(() => cp.emit('spawn'))
    return result
  }
  return cp
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ChildProcessHandle', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  describe('start()', () => {
    it('transitions to Running and stores pid', async () => {
      const mockCp = createMockChildProcess(5678)
      mockSpawn.mockReturnValue(mockCp)

      const handle = new ChildProcessHandle({ id: 'proc1', command: 'node', args: ['--version'] })
      await handle.start()

      expect(handle.state).toBe('running')
      expect(handle.pid).toBe(5678)
    })

    it('rejects start() if already running', async () => {
      const mockCp = createMockChildProcess()
      mockSpawn.mockReturnValue(mockCp)

      const handle = new ChildProcessHandle({ id: 'proc2', command: 'sleep' })
      await handle.start()

      await expect(handle.start()).rejects.toThrow(/already running/)
    })

    it('joins concurrent starts while shell environment resolution is in flight', async () => {
      let resolveEnv!: (env: Record<string, string>) => void
      mockGetShellEnv.mockReturnValueOnce(
        new Promise<Record<string, string>>((resolve) => {
          resolveEnv = resolve
        })
      )
      const mockCp = createMockChildProcess()
      mockSpawn.mockReturnValue(mockCp)
      const handle = new ChildProcessHandle({ id: 'concurrent-start', command: 'node' })

      const firstStart = handle.start()
      const secondStart = handle.start()

      expect(handle.state).toBe('starting')
      expect(mockSpawn).not.toHaveBeenCalled()

      resolveEnv({ PATH: '/usr/bin' })
      await expect(Promise.all([firstStart, secondStart])).resolves.toEqual([undefined, undefined])
      expect(mockSpawn).toHaveBeenCalledOnce()
    })

    it('rejects startup when the child emits error before spawn', async () => {
      const mockCp = createMockChildProcess(1234, false)
      mockSpawn.mockReturnValue(mockCp)
      const handle = new ChildProcessHandle({ id: 'async-spawn-error', command: 'missing' })
      const onExited = vi.fn()
      handle.onExited = onExited

      const startPromise = handle.start()
      await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalledOnce())
      mockCp.emit('error', new Error('ENOENT'))

      await expect(startPromise).rejects.toThrow('ENOENT')
      expect(handle.state).toBe('crashed')
      expect(onExited).toHaveBeenCalledOnce()
    })

    it('isolates errors thrown by onStarted', async () => {
      const mockCp = createMockChildProcess(1234, false)
      mockSpawn.mockReturnValue(mockCp)
      const handle = new ChildProcessHandle({ id: 'throwing-started-callback', command: 'node' })
      handle.onStarted = () => {
        throw new Error('onStarted failed')
      }

      const startPromise = handle.start()
      await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalledOnce())

      expect(() => mockCp.emit('spawn')).not.toThrow()
      await expect(startPromise).resolves.toBeUndefined()
      expect(handle.state).toBe('running')
    })

    it('cancels startup before spawning when stop arrives during shell environment resolution', async () => {
      let resolveEnv!: (env: Record<string, string>) => void
      mockGetShellEnv.mockReturnValueOnce(
        new Promise<Record<string, string>>((resolve) => {
          resolveEnv = resolve
        })
      )
      mockSpawn.mockImplementation(() => {
        throw new Error('spawn should not happen')
      })
      const handle = new ChildProcessHandle({ id: 'cancel-before-spawn', command: 'node' })

      const startPromise = handle.start()
      const startResult = expect(startPromise).rejects.toThrow('Process cancel-before-spawn start was cancelled')
      const stopPromise = handle.stop()
      resolveEnv({ PATH: '/usr/bin' })

      await startResult
      await expect(stopPromise).resolves.toBeUndefined()
      expect(mockSpawn).not.toHaveBeenCalled()
      expect(handle.state).toBe('stopped')
    })
  })

  describe('process exit', () => {
    it('transitions to Stopped on clean exit (code 0)', async () => {
      const mockCp = createMockChildProcess()
      mockSpawn.mockReturnValue(mockCp)

      const handle = new ChildProcessHandle({ id: 'exit-proc', command: 'true' })
      await handle.start()

      mockCp.emit('close', 0, null)

      expect(handle.state).toBe('stopped')
      expect(handle.pid).toBeUndefined()
    })

    it('transitions to Crashed on non-zero exit code', async () => {
      const mockCp = createMockChildProcess()
      mockSpawn.mockReturnValue(mockCp)

      const handle = new ChildProcessHandle({ id: 'crash-proc', command: 'false' })
      await handle.start()

      mockCp.emit('close', 1, null)

      expect(handle.state).toBe('crashed')
      expect(handle.pid).toBeUndefined()
    })

    it('sets state to Crashed on error event', async () => {
      const mockCp = createMockChildProcess()
      mockSpawn.mockReturnValue(mockCp)

      const handle = new ChildProcessHandle({ id: 'err-proc', command: 'bad' })
      await handle.start()

      mockCp.emit('error', new Error('spawn failed'))

      expect(handle.state).toBe('crashed')
      expect(handle.pid).toBeUndefined()
    })

    it('calls onExited with (null, null) when error event fires', async () => {
      const mockCp = createMockChildProcess()
      mockSpawn.mockReturnValue(mockCp)

      const handle = new ChildProcessHandle({ id: 'err-exited-proc', command: 'bad' })
      const onExited = vi.fn()
      handle.onExited = onExited

      await handle.start()
      mockCp.emit('error', new Error('ENOENT spawn failed'))

      expect(onExited).toHaveBeenCalledOnce()
      expect(onExited).toHaveBeenCalledWith(null, null)
    })

    it('isolates errors thrown by onExited', async () => {
      const mockCp = createMockChildProcess()
      mockSpawn.mockReturnValue(mockCp)
      const handle = new ChildProcessHandle({ id: 'throwing-exited-callback', command: 'node' })
      handle.onExited = () => {
        throw new Error('onExited failed')
      }

      await handle.start()

      expect(() => mockCp.emit('close', 0, null)).not.toThrow()
      expect(handle.state).toBe('stopped')
    })
  })

  describe('stop()', () => {
    it('sends SIGTERM and transitions to Stopped on process close', async () => {
      const mockCp = createMockChildProcess()
      mockSpawn.mockReturnValue(mockCp)

      const handle = new ChildProcessHandle({ id: 'stop-proc', command: 'sleep' })
      await handle.start()

      const stopPromise = handle.stop()

      expect(mockCp.kill).toHaveBeenCalledWith('SIGTERM')
      expect(handle.state).toBe('stopping')

      mockCp.emit('close', 0, null)
      await stopPromise

      expect(handle.state).toBe('stopped')
    })

    it('does nothing if process is not running', async () => {
      const handle = new ChildProcessHandle({ id: 'idle-stop', command: 'node' })

      await expect(handle.stop()).resolves.toBeUndefined()
      expect(handle.state).toBe('idle')
    })

    it('joins an in-flight start before stopping the spawned process', async () => {
      const mockCp = createMockChildProcess(1234, false)
      mockSpawn.mockReturnValue(mockCp)
      const handle = new ChildProcessHandle({ id: 'starting-stop', command: 'node' })

      const startPromise = handle.start()
      await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalledOnce())
      const stopPromise = handle.stop()

      expect(handle.state).toBe('starting')
      expect(mockCp.kill).not.toHaveBeenCalled()

      mockCp.emit('spawn')
      await startPromise
      await vi.waitFor(() => expect(mockCp.kill).toHaveBeenCalledWith('SIGTERM'))
      mockCp.emit('close', 0, null)

      await expect(stopPromise).resolves.toBeUndefined()
      expect(handle.state).toBe('stopped')
    })

    it('terminates the process tree for detached children', async () => {
      const mockCp = createMockChildProcess()
      mockSpawn.mockReturnValue(mockCp)

      const handle = new ChildProcessHandle({ id: 'tree-proc', command: 'sleep', detached: true })
      await handle.start()

      const stopPromise = handle.stop()
      expect(mockTerminateProcessTree).toHaveBeenCalledWith(mockCp, false, 'tree-proc')

      mockCp.emit('close', 0, null)
      await stopPromise
    })

    it('sends SIGKILL after killTimeoutMs', async () => {
      vi.useFakeTimers()

      const mockCp = createMockChildProcess()
      mockSpawn.mockReturnValue(mockCp)

      const handle = new ChildProcessHandle({
        id: 'kill-proc',
        command: 'sleep',
        killTimeoutMs: 1000
      })
      await handle.start()

      const stopPromise = handle.stop()

      expect(mockCp.kill).toHaveBeenCalledWith('SIGTERM')
      expect(mockCp.kill).toHaveBeenCalledTimes(1)

      // The graceful phase receives part of the total timeout budget.
      await vi.advanceTimersByTimeAsync(750)

      expect(mockCp.kill).toHaveBeenCalledWith('SIGKILL')
      expect(mockCp.kill).toHaveBeenCalledTimes(2)

      // Simulate process close after SIGKILL
      mockCp.emit('close', null, 'SIGKILL')
      await stopPromise
    })

    it('uses killTimeoutMs as the total graceful and forced termination budget', async () => {
      vi.useFakeTimers()

      const mockCp = createMockChildProcess()
      mockSpawn.mockReturnValue(mockCp)
      const handle = new ChildProcessHandle({ id: 'deadline-proc', command: 'sleep', killTimeoutMs: 1000 })
      await handle.start()

      const stopped = expect(handle.stop()).rejects.toThrow('did not exit after forced termination')
      await vi.advanceTimersByTimeAsync(1000)

      await stopped
      expect(mockCp.kill).toHaveBeenNthCalledWith(1, 'SIGTERM')
      expect(mockCp.kill).toHaveBeenNthCalledWith(2, 'SIGKILL')
    })

    it('does not send SIGKILL if process exits before timeout', async () => {
      vi.useFakeTimers()

      const mockCp = createMockChildProcess()
      mockSpawn.mockReturnValue(mockCp)

      const handle = new ChildProcessHandle({
        id: 'graceful-proc',
        command: 'sleep',
        killTimeoutMs: 5000
      })
      await handle.start()

      const stopPromise = handle.stop()

      // Process exits gracefully before timeout
      mockCp.emit('close', 0, null)
      await stopPromise

      vi.advanceTimersByTime(10000)

      // SIGKILL should NOT have been sent
      expect(mockCp.kill).toHaveBeenCalledTimes(1)
      expect(mockCp.kill).toHaveBeenCalledWith('SIGTERM')
    })

    it('transitions to Stopped (not Crashed) when stopping and process exits with non-zero', async () => {
      const mockCp = createMockChildProcess()
      mockSpawn.mockReturnValue(mockCp)

      const handle = new ChildProcessHandle({ id: 'stopping-proc', command: 'sleep' })
      await handle.start()

      const stopPromise = handle.stop()
      mockCp.emit('close', null, 'SIGTERM')
      await stopPromise

      expect(handle.state).toBe('stopped')
    })

    it('does not resolve until close updates the handle to a terminal state', async () => {
      const mockCp = createMockChildProcess()
      mockSpawn.mockReturnValue(mockCp)
      const handle = new ChildProcessHandle({ id: 'exit-before-close', command: 'sleep' })
      await handle.start()

      const stopPromise = handle.stop()
      mockCp.emit('exit', 0, null)

      const resolvedBeforeClose = await Promise.race([
        stopPromise.then(() => true),
        new Promise<false>((resolve) => setTimeout(() => resolve(false), 0))
      ])
      expect(resolvedBeforeClose).toBe(false)
      expect(handle.state).toBe('stopping')

      mockCp.emit('close', 0, null)
      await expect(stopPromise).resolves.toBeUndefined()
      expect(handle.state).toBe('stopped')
    })
  })

  describe('log events', () => {
    it('emits log lines via onLog callback', async () => {
      const mockCp = createMockChildProcess()
      mockSpawn.mockReturnValue(mockCp)

      const handle = new ChildProcessHandle({ id: 'log-proc', command: 'node' })
      const onLog = vi.fn()
      handle.onLog = onLog

      await handle.start()

      mockCp.stdout.emit('data', Buffer.from('hello stdout\n'))
      mockCp.stderr.emit('data', Buffer.from('error output\n'))

      expect(onLog).toHaveBeenCalledTimes(2)
      expect(onLog).toHaveBeenCalledWith(
        expect.objectContaining({ processId: 'log-proc', stream: 'stdout', data: 'hello stdout\n' })
      )
      expect(onLog).toHaveBeenCalledWith(
        expect.objectContaining({ processId: 'log-proc', stream: 'stderr', data: 'error output\n' })
      )
    })

    it('isolates errors thrown by onLog', async () => {
      const mockCp = createMockChildProcess()
      mockSpawn.mockReturnValue(mockCp)
      const handle = new ChildProcessHandle({ id: 'throwing-log-callback', command: 'node' })
      handle.onLog = () => {
        throw new Error('onLog failed')
      }

      await handle.start()

      expect(() => mockCp.stdout.emit('data', Buffer.from('hello\n'))).not.toThrow()
      expect(handle.state).toBe('running')
    })
  })

  describe('detached option', () => {
    it('calls child.unref() when detached is true', async () => {
      const mockCp = createMockChildProcess()
      mockSpawn.mockReturnValue(mockCp)

      const handle = new ChildProcessHandle({ id: 'unref-proc', command: 'node', detached: true })
      await handle.start()

      expect(mockCp.unref).toHaveBeenCalled()
    })

    it('does not call unref when detached is false or undefined', async () => {
      const mockCp = createMockChildProcess()
      mockSpawn.mockReturnValue(mockCp)

      const handle = new ChildProcessHandle({ id: 'no-unref', command: 'node' })
      await handle.start()

      expect(mockCp.unref).not.toHaveBeenCalled()
    })
  })

  describe('spawn error (synchronous throw)', () => {
    it('transitions to Crashed when crossPlatformSpawn throws', async () => {
      mockSpawn.mockImplementation(() => {
        throw new Error('ENOENT: command not found')
      })

      const handle = new ChildProcessHandle({ id: 'throw-proc', command: 'nonexistent' })

      await expect(handle.start()).rejects.toThrow('ENOENT: command not found')
      expect(handle.state).toBe('crashed')
      expect(handle.pid).toBeUndefined()
    })

    it('calls onExited with (null, null) when spawn throws', async () => {
      mockSpawn.mockImplementation(() => {
        throw new Error('spawn failed')
      })

      const handle = new ChildProcessHandle({ id: 'throw-exited', command: 'bad' })
      const onExited = vi.fn()
      handle.onExited = onExited

      await expect(handle.start()).rejects.toThrow('spawn failed')
      expect(onExited).toHaveBeenCalledOnce()
      expect(onExited).toHaveBeenCalledWith(null, null)
    })
  })

  describe('pid undefined on spawn', () => {
    it('does not call onStarted when pid is undefined', async () => {
      const mockCp = createMockChildProcess()
      mockCp.pid = undefined
      mockSpawn.mockReturnValue(mockCp)

      const handle = new ChildProcessHandle({ id: 'no-pid', command: 'node' })
      const onStarted = vi.fn()
      handle.onStarted = onStarted

      await handle.start()

      expect(handle.state).toBe('running')
      expect(handle.pid).toBeUndefined()
      expect(onStarted).not.toHaveBeenCalled()
    })
  })

  describe('restart()', () => {
    it('stops then starts the process, getting a new pid', async () => {
      const mockCp1 = createMockChildProcess(1111)
      const mockCp2 = createMockChildProcess(2222)
      mockSpawn.mockReturnValueOnce(mockCp1).mockReturnValueOnce(mockCp2)

      const handle = new ChildProcessHandle({ id: 'restart-proc', command: 'node' })
      await handle.start()

      expect(handle.pid).toBe(1111)

      const restartPromise = handle.restart()

      mockCp1.emit('close', 0, null)

      await restartPromise

      expect(handle.state).toBe('running')
      expect(handle.pid).toBe(2222)
    })
  })
})
