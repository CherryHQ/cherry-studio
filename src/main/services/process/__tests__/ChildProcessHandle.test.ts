import { EventEmitter } from 'events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock child_process
vi.mock('child_process', () => ({ spawn: vi.fn() }))

// Mock crossPlatformSpawn
vi.mock('@main/utils/process', () => ({ crossPlatformSpawn: vi.fn() }))

// Mock shell-env (default export)
vi.mock('@main/utils/shell-env', () => ({
  default: vi.fn().mockResolvedValue({ PATH: '/usr/bin' })
}))

// Mock logger
vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    })
  }
}))

function createMockChildProcess(pid = 1234) {
  const cp = new EventEmitter() as any
  cp.pid = pid
  cp.stdout = new EventEmitter()
  cp.stderr = new EventEmitter()
  cp.kill = vi.fn().mockReturnValue(true)
  cp.unref = vi.fn()
  return cp
}

async function loadModules() {
  const { crossPlatformSpawn } = await import('@main/utils/process')
  const { ChildProcessHandle } = await import('../ChildProcessHandle')
  return { crossPlatformSpawn: crossPlatformSpawn as any, ChildProcessHandle }
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
})

describe('ChildProcessHandle', () => {
  describe('initial state', () => {
    it('starts in Idle state with correct id and undefined pid', async () => {
      const { ChildProcessHandle } = await loadModules()
      const handle = new ChildProcessHandle({ type: 'child', id: 'test-proc', command: 'echo' })

      expect(handle.id).toBe('test-proc')
      expect(handle.state).toBe('idle')
      expect(handle.pid).toBeUndefined()
    })
  })

  describe('start()', () => {
    it('transitions to Running and stores pid', async () => {
      const { crossPlatformSpawn, ChildProcessHandle } = await loadModules()
      const mockCp = createMockChildProcess(5678)
      crossPlatformSpawn.mockReturnValue(mockCp)

      const handle = new ChildProcessHandle({ type: 'child', id: 'proc1', command: 'node', args: ['--version'] })
      await handle.start()

      expect(handle.state).toBe('running')
      expect(handle.pid).toBe(5678)
    })

    it('calls crossPlatformSpawn with merged env', async () => {
      const getShellEnv = (await import('@main/utils/shell-env')).default as any
      getShellEnv.mockResolvedValue({ PATH: '/usr/bin', SHELL: '/bin/zsh' })

      const { crossPlatformSpawn, ChildProcessHandle } = await loadModules()
      const mockCp = createMockChildProcess()
      crossPlatformSpawn.mockReturnValue(mockCp)

      const handle = new ChildProcessHandle({
        type: 'child',
        id: 'env-proc',
        command: 'node',
        env: { MY_VAR: 'hello' }
      })
      await handle.start()

      expect(crossPlatformSpawn).toHaveBeenCalledWith(
        'node',
        [],
        expect.objectContaining({
          env: expect.objectContaining({ PATH: '/usr/bin', SHELL: '/bin/zsh', MY_VAR: 'hello' })
        })
      )
    })

    it('rejects start() if already running', async () => {
      const { crossPlatformSpawn, ChildProcessHandle } = await loadModules()
      const mockCp = createMockChildProcess()
      crossPlatformSpawn.mockReturnValue(mockCp)

      const handle = new ChildProcessHandle({ type: 'child', id: 'proc2', command: 'sleep' })
      await handle.start()

      await expect(handle.start()).rejects.toThrow(/already running/)
    })

    it('calls onStarted callback with pid', async () => {
      const { crossPlatformSpawn, ChildProcessHandle } = await loadModules()
      const mockCp = createMockChildProcess(9999)
      crossPlatformSpawn.mockReturnValue(mockCp)

      const handle = new ChildProcessHandle({ type: 'child', id: 'cb-proc', command: 'node' })
      const onStarted = vi.fn()
      handle.onStarted = onStarted

      await handle.start()

      expect(onStarted).toHaveBeenCalledWith(9999)
    })
  })

  describe('process exit', () => {
    it('transitions to Stopped on clean exit (code 0)', async () => {
      const { crossPlatformSpawn, ChildProcessHandle } = await loadModules()
      const mockCp = createMockChildProcess()
      crossPlatformSpawn.mockReturnValue(mockCp)

      const handle = new ChildProcessHandle({ type: 'child', id: 'exit-proc', command: 'true' })
      await handle.start()

      mockCp.emit('close', 0, null)

      expect(handle.state).toBe('stopped')
      expect(handle.pid).toBeUndefined()
    })

    it('transitions to Crashed on non-zero exit code', async () => {
      const { crossPlatformSpawn, ChildProcessHandle } = await loadModules()
      const mockCp = createMockChildProcess()
      crossPlatformSpawn.mockReturnValue(mockCp)

      const handle = new ChildProcessHandle({ type: 'child', id: 'crash-proc', command: 'false' })
      await handle.start()

      mockCp.emit('close', 1, null)

      expect(handle.state).toBe('crashed')
      expect(handle.pid).toBeUndefined()
    })

    it('calls onExited callback on close', async () => {
      const { crossPlatformSpawn, ChildProcessHandle } = await loadModules()
      const mockCp = createMockChildProcess()
      crossPlatformSpawn.mockReturnValue(mockCp)

      const handle = new ChildProcessHandle({ type: 'child', id: 'onexited-proc', command: 'node' })
      const onExited = vi.fn()
      handle.onExited = onExited

      await handle.start()
      mockCp.emit('close', 0, null)

      expect(onExited).toHaveBeenCalledWith(0, null)
    })

    it('sets state to Crashed on error event', async () => {
      const { crossPlatformSpawn, ChildProcessHandle } = await loadModules()
      const mockCp = createMockChildProcess()
      crossPlatformSpawn.mockReturnValue(mockCp)

      const handle = new ChildProcessHandle({ type: 'child', id: 'err-proc', command: 'bad' })
      await handle.start()

      mockCp.emit('error', new Error('spawn failed'))

      expect(handle.state).toBe('crashed')
      expect(handle.pid).toBeUndefined()
    })

    it('calls onExited with (null, null) when error event fires', async () => {
      const { crossPlatformSpawn, ChildProcessHandle } = await loadModules()
      const mockCp = createMockChildProcess()
      crossPlatformSpawn.mockReturnValue(mockCp)

      const handle = new ChildProcessHandle({ type: 'child', id: 'err-exited-proc', command: 'bad' })
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
      const { crossPlatformSpawn, ChildProcessHandle } = await loadModules()
      const mockCp = createMockChildProcess()
      crossPlatformSpawn.mockReturnValue(mockCp)

      const handle = new ChildProcessHandle({ type: 'child', id: 'stop-proc', command: 'sleep' })
      await handle.start()

      const stopPromise = handle.stop()

      expect(mockCp.kill).toHaveBeenCalledWith('SIGTERM')
      expect(handle.state).toBe('stopping')

      mockCp.emit('close', 0, null)
      await stopPromise

      expect(handle.state).toBe('stopped')
    })

    it('does nothing if process is not running', async () => {
      const { ChildProcessHandle } = await loadModules()
      const handle = new ChildProcessHandle({ type: 'child', id: 'idle-stop', command: 'node' })

      // Should resolve immediately without throwing
      await expect(handle.stop()).resolves.toBeUndefined()
      expect(handle.state).toBe('idle')
    })

    it('sends SIGKILL after killTimeoutMs', async () => {
      vi.useFakeTimers()

      const { crossPlatformSpawn, ChildProcessHandle } = await loadModules()
      const mockCp = createMockChildProcess()
      crossPlatformSpawn.mockReturnValue(mockCp)

      const handle = new ChildProcessHandle({
        type: 'child',
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

      vi.useRealTimers()
    })

    it('does not send SIGKILL if process exits before timeout', async () => {
      vi.useFakeTimers()

      const { crossPlatformSpawn, ChildProcessHandle } = await loadModules()
      const mockCp = createMockChildProcess()
      crossPlatformSpawn.mockReturnValue(mockCp)

      const handle = new ChildProcessHandle({
        type: 'child',
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

      vi.useRealTimers()
    })
  })

  describe('log events', () => {
    it('emits log lines on stdout via onLog callback', async () => {
      const { crossPlatformSpawn, ChildProcessHandle } = await loadModules()
      const mockCp = createMockChildProcess()
      crossPlatformSpawn.mockReturnValue(mockCp)

      const handle = new ChildProcessHandle({ type: 'child', id: 'log-proc', command: 'node' })
      const onLog = vi.fn()
      handle.onLog = onLog

      await handle.start()

      mockCp.stdout.emit('data', Buffer.from('hello stdout\n'))

      expect(onLog).toHaveBeenCalledWith(
        expect.objectContaining({
          processId: 'log-proc',
          stream: 'stdout',
          data: 'hello stdout\n'
        })
      )
      expect(onLog.mock.calls[0][0].timestamp).toBeTypeOf('number')
    })

    it('emits log lines on stderr via onLog callback', async () => {
      const { crossPlatformSpawn, ChildProcessHandle } = await loadModules()
      const mockCp = createMockChildProcess()
      crossPlatformSpawn.mockReturnValue(mockCp)

      const handle = new ChildProcessHandle({ type: 'child', id: 'stderr-proc', command: 'node' })
      const onLog = vi.fn()
      handle.onLog = onLog

      await handle.start()

      mockCp.stderr.emit('data', Buffer.from('error output\n'))

      expect(onLog).toHaveBeenCalledWith(
        expect.objectContaining({
          processId: 'stderr-proc',
          stream: 'stderr',
          data: 'error output\n'
        })
      )
    })
  })

  describe('restart()', () => {
    it('stops then starts the process, getting a new pid', async () => {
      const { crossPlatformSpawn, ChildProcessHandle } = await loadModules()

      const mockCp1 = createMockChildProcess(1111)
      const mockCp2 = createMockChildProcess(2222)
      crossPlatformSpawn.mockReturnValueOnce(mockCp1).mockReturnValueOnce(mockCp2)

      const handle = new ChildProcessHandle({ type: 'child', id: 'restart-proc', command: 'node' })
      await handle.start()

      expect(handle.pid).toBe(1111)

      // Trigger restart - stop() will wait for close event
      const restartPromise = handle.restart()

      // Simulate first process closing after SIGTERM
      mockCp1.emit('close', 0, null)

      await restartPromise

      expect(handle.state).toBe('running')
      expect(handle.pid).toBe(2222)
      expect(crossPlatformSpawn).toHaveBeenCalledTimes(2)
    })
  })

  describe('Stopping state exit', () => {
    it('transitions to Stopped (not Crashed) when stopping and process exits with non-zero', async () => {
      const { crossPlatformSpawn, ChildProcessHandle } = await loadModules()
      const mockCp = createMockChildProcess()
      crossPlatformSpawn.mockReturnValue(mockCp)

      const handle = new ChildProcessHandle({ type: 'child', id: 'stopping-proc', command: 'sleep' })
      await handle.start()

      const stopPromise = handle.stop()
      // Process killed, exits with null code and SIGTERM signal
      mockCp.emit('close', null, 'SIGTERM')
      await stopPromise

      // Should be Stopped, not Crashed, because we initiated the stop
      expect(handle.state).toBe('stopped')
    })
  })

  describe('detached option', () => {
    it('passes detached to spawn options', async () => {
      const { crossPlatformSpawn, ChildProcessHandle } = await loadModules()
      const mockCp = createMockChildProcess()
      crossPlatformSpawn.mockReturnValue(mockCp)

      const handle = new ChildProcessHandle({ type: 'child', id: 'detached-proc', command: 'node', detached: true })
      await handle.start()

      expect(crossPlatformSpawn).toHaveBeenCalledWith('node', [], expect.objectContaining({ detached: true }))
    })

    it('calls child.unref() when detached is true', async () => {
      const { crossPlatformSpawn, ChildProcessHandle } = await loadModules()
      const mockCp = createMockChildProcess()
      crossPlatformSpawn.mockReturnValue(mockCp)

      const handle = new ChildProcessHandle({ type: 'child', id: 'unref-proc', command: 'node', detached: true })
      await handle.start()

      expect(mockCp.unref).toHaveBeenCalled()
    })

    it('does not call unref when detached is false or undefined', async () => {
      const { crossPlatformSpawn, ChildProcessHandle } = await loadModules()
      const mockCp = createMockChildProcess()
      crossPlatformSpawn.mockReturnValue(mockCp)

      const handle = new ChildProcessHandle({ type: 'child', id: 'no-unref', command: 'node' })
      await handle.start()

      expect(mockCp.unref).not.toHaveBeenCalled()
    })
  })

  describe('skipOnStop', () => {
    it('returns false by default', async () => {
      const { ChildProcessHandle } = await loadModules()
      const handle = new ChildProcessHandle({ type: 'child', id: 'test', command: 'echo' })
      expect(handle.skipOnStop).toBe(false)
    })

    it('returns true when set in definition', async () => {
      const { ChildProcessHandle } = await loadModules()
      const handle = new ChildProcessHandle({ type: 'child', id: 'test', command: 'echo', skipOnStop: true })
      expect(handle.skipOnStop).toBe(true)
    })
  })

  describe('spawn error (synchronous throw)', () => {
    it('transitions to Crashed when crossPlatformSpawn throws', async () => {
      const { crossPlatformSpawn, ChildProcessHandle } = await loadModules()
      crossPlatformSpawn.mockImplementation(() => {
        throw new Error('ENOENT: command not found')
      })

      const handle = new ChildProcessHandle({ type: 'child', id: 'throw-proc', command: 'nonexistent' })

      await expect(handle.start()).rejects.toThrow('ENOENT: command not found')
      expect(handle.state).toBe('crashed')
      expect(handle.pid).toBeUndefined()
    })

    it('calls onExited with (null, null) when spawn throws', async () => {
      const { crossPlatformSpawn, ChildProcessHandle } = await loadModules()
      crossPlatformSpawn.mockImplementation(() => {
        throw new Error('spawn failed')
      })

      const handle = new ChildProcessHandle({ type: 'child', id: 'throw-exited', command: 'bad' })
      const onExited = vi.fn()
      handle.onExited = onExited

      await expect(handle.start()).rejects.toThrow('spawn failed')
      expect(onExited).toHaveBeenCalledOnce()
      expect(onExited).toHaveBeenCalledWith(null, null)
    })
  })

  describe('pid undefined on spawn', () => {
    it('does not call onStarted when pid is undefined', async () => {
      const { crossPlatformSpawn, ChildProcessHandle } = await loadModules()
      const mockCp = createMockChildProcess()
      mockCp.pid = undefined
      crossPlatformSpawn.mockReturnValue(mockCp)

      const handle = new ChildProcessHandle({ type: 'child', id: 'no-pid', command: 'node' })
      const onStarted = vi.fn()
      handle.onStarted = onStarted

      await handle.start()

      expect(handle.state).toBe('running')
      expect(handle.pid).toBeUndefined()
      expect(onStarted).not.toHaveBeenCalled()
    })
  })

  describe('stdio option', () => {
    it('passes stdio to spawn options', async () => {
      const { crossPlatformSpawn, ChildProcessHandle } = await loadModules()
      const mockCp = createMockChildProcess()
      crossPlatformSpawn.mockReturnValue(mockCp)

      const handle = new ChildProcessHandle({
        type: 'child',
        id: 'stdio-proc',
        command: 'node',
        stdio: ['ignore', 'pipe', 'pipe']
      })
      await handle.start()

      expect(crossPlatformSpawn).toHaveBeenCalledWith(
        'node',
        [],
        expect.objectContaining({ stdio: ['ignore', 'pipe', 'pipe'] })
      )
    })
  })
})
