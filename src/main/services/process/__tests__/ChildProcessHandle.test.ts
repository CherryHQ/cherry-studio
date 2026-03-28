import { EventEmitter } from 'events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('child_process', () => ({ spawn: vi.fn() }))
vi.mock('@main/utils/process', () => ({ crossPlatformSpawn: vi.fn() }))
vi.mock('@main/utils/shell-env', () => ({
  default: vi.fn().mockResolvedValue({ PATH: '/usr/bin' })
}))

import { crossPlatformSpawn } from '@main/utils/process'

import { ChildProcessHandle } from '../ChildProcessHandle'

const mockSpawn = crossPlatformSpawn as unknown as ReturnType<typeof vi.fn>

function createMockChildProcess(pid = 1234) {
  const cp = new EventEmitter() as any
  cp.pid = pid
  cp.stdout = new EventEmitter()
  cp.stderr = new EventEmitter()
  cp.kill = vi.fn().mockReturnValue(true)
  cp.unref = vi.fn()
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

      // Advance time past the killTimeoutMs
      vi.advanceTimersByTime(1001)

      expect(mockCp.kill).toHaveBeenCalledWith('SIGKILL')
      expect(mockCp.kill).toHaveBeenCalledTimes(2)

      // Simulate process close after SIGKILL
      mockCp.emit('close', null, 'SIGKILL')
      await stopPromise
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
