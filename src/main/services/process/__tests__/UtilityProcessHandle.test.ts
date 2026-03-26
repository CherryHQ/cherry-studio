import { EventEmitter } from 'events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock electron
const mockUtilityProcess = { fork: vi.fn() }
vi.mock('electron', () => ({ utilityProcess: mockUtilityProcess }))

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

function createMockUtilityProcess(pid = 9876) {
  const proc = new EventEmitter() as any
  proc.pid = pid
  proc.postMessage = vi.fn()
  proc.kill = vi.fn()
  return proc
}

async function loadModules() {
  const { UtilityProcessHandle } = await import('../UtilityProcessHandle')
  return { UtilityProcessHandle }
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
})

describe('UtilityProcessHandle', () => {
  describe('initial state', () => {
    it('starts in Idle state with correct id and undefined pid', async () => {
      const { UtilityProcessHandle } = await loadModules()
      const handle = new UtilityProcessHandle({ type: 'utility', id: 'util-proc', modulePath: '/path/to/module.js' })

      expect(handle.id).toBe('util-proc')
      expect(handle.state).toBe('idle')
      expect(handle.pid).toBeUndefined()
    })
  })

  describe('start()', () => {
    it('transitions to Running and stores pid', async () => {
      const { UtilityProcessHandle } = await loadModules()
      const mockProc = createMockUtilityProcess(9876)
      mockUtilityProcess.fork.mockReturnValue(mockProc)

      const handle = new UtilityProcessHandle({ type: 'utility', id: 'proc1', modulePath: '/path/module.js' })
      await handle.start()

      expect(handle.state).toBe('running')
      expect(handle.pid).toBe(9876)
    })

    it('calls utilityProcess.fork with modulePath, args, and env', async () => {
      const { UtilityProcessHandle } = await loadModules()
      const mockProc = createMockUtilityProcess()
      mockUtilityProcess.fork.mockReturnValue(mockProc)

      const handle = new UtilityProcessHandle({
        type: 'utility',
        id: 'fork-proc',
        modulePath: '/path/to/worker.js',
        args: ['--flag', 'value'],
        env: { MY_VAR: 'hello' }
      })
      await handle.start()

      expect(mockUtilityProcess.fork).toHaveBeenCalledWith('/path/to/worker.js', ['--flag', 'value'], {
        env: { MY_VAR: 'hello' }
      })
    })

    it('rejects start() if already running', async () => {
      const { UtilityProcessHandle } = await loadModules()
      const mockProc = createMockUtilityProcess()
      mockUtilityProcess.fork.mockReturnValue(mockProc)

      const handle = new UtilityProcessHandle({ type: 'utility', id: 'proc2', modulePath: '/module.js' })
      await handle.start()

      await expect(handle.start()).rejects.toThrow(/already running/)
    })

    it('calls onStarted callback with pid', async () => {
      const { UtilityProcessHandle } = await loadModules()
      const mockProc = createMockUtilityProcess(4321)
      mockUtilityProcess.fork.mockReturnValue(mockProc)

      const handle = new UtilityProcessHandle({ type: 'utility', id: 'cb-proc', modulePath: '/module.js' })
      const onStarted = vi.fn()
      handle.onStarted = onStarted

      await handle.start()

      expect(onStarted).toHaveBeenCalledWith(4321)
    })
  })

  describe('postMessage()', () => {
    it('forwards message to underlying process', async () => {
      const { UtilityProcessHandle } = await loadModules()
      const mockProc = createMockUtilityProcess()
      mockUtilityProcess.fork.mockReturnValue(mockProc)

      const handle = new UtilityProcessHandle({ type: 'utility', id: 'msg-proc', modulePath: '/module.js' })
      await handle.start()

      handle.postMessage({ type: 'ping', data: 42 })

      expect(mockProc.postMessage).toHaveBeenCalledWith({ type: 'ping', data: 42 })
    })

    it('throws if process is not running', async () => {
      const { UtilityProcessHandle } = await loadModules()

      const handle = new UtilityProcessHandle({ type: 'utility', id: 'idle-msg', modulePath: '/module.js' })

      expect(() => handle.postMessage('hello')).toThrow(/not running/)
    })
  })

  describe('onMessage()', () => {
    it('receives messages from the process', async () => {
      const { UtilityProcessHandle } = await loadModules()
      const mockProc = createMockUtilityProcess()
      mockUtilityProcess.fork.mockReturnValue(mockProc)

      const handle = new UtilityProcessHandle({ type: 'utility', id: 'recv-proc', modulePath: '/module.js' })
      await handle.start()

      const received: unknown[] = []
      handle.onMessage((msg) => received.push(msg))

      mockProc.emit('message', { type: 'pong' })
      mockProc.emit('message', { type: 'data', value: 99 })

      expect(received).toEqual([{ type: 'pong' }, { type: 'data', value: 99 }])
    })

    it('cleanup function unsubscribes the handler', async () => {
      const { UtilityProcessHandle } = await loadModules()
      const mockProc = createMockUtilityProcess()
      mockUtilityProcess.fork.mockReturnValue(mockProc)

      const handle = new UtilityProcessHandle({ type: 'utility', id: 'unsub-proc', modulePath: '/module.js' })
      await handle.start()

      const received: unknown[] = []
      const cleanup = handle.onMessage((msg) => received.push(msg))

      mockProc.emit('message', 'first')
      cleanup()
      mockProc.emit('message', 'second')

      expect(received).toEqual(['first'])
    })
  })

  describe('stop()', () => {
    it('calls proc.kill() and transitions to Stopped after exit event', async () => {
      const { UtilityProcessHandle } = await loadModules()
      const mockProc = createMockUtilityProcess()
      mockUtilityProcess.fork.mockReturnValue(mockProc)

      const handle = new UtilityProcessHandle({ type: 'utility', id: 'stop-proc', modulePath: '/module.js' })
      await handle.start()

      const stopPromise = handle.stop()

      expect(mockProc.kill).toHaveBeenCalled()
      expect(handle.state).toBe('stopping')

      mockProc.emit('exit', 0)
      await stopPromise

      expect(handle.state).toBe('stopped')
    })

    it('does nothing if process is not running', async () => {
      const { UtilityProcessHandle } = await loadModules()

      const handle = new UtilityProcessHandle({ type: 'utility', id: 'idle-stop', modulePath: '/module.js' })

      await expect(handle.stop()).resolves.toBeUndefined()
      expect(handle.state).toBe('idle')
    })

    it('resolves after killTimeoutMs if process does not exit', async () => {
      vi.useFakeTimers()

      const { UtilityProcessHandle } = await loadModules()
      const mockProc = createMockUtilityProcess()
      mockUtilityProcess.fork.mockReturnValue(mockProc)

      const handle = new UtilityProcessHandle({
        type: 'utility',
        id: 'timeout-proc',
        modulePath: '/module.js',
        killTimeoutMs: 1000
      })
      await handle.start()

      const stopPromise = handle.stop()

      expect(mockProc.kill).toHaveBeenCalled()

      // Advance past the timeout — no 'exit' event fired, promise should resolve
      vi.advanceTimersByTime(1001)
      await stopPromise

      vi.useRealTimers()
    })
  })

  describe('process exit events', () => {
    it('transitions to Crashed on unexpected non-zero exit', async () => {
      const { UtilityProcessHandle } = await loadModules()
      const mockProc = createMockUtilityProcess()
      mockUtilityProcess.fork.mockReturnValue(mockProc)

      const handle = new UtilityProcessHandle({ type: 'utility', id: 'crash-proc', modulePath: '/module.js' })
      await handle.start()

      mockProc.emit('exit', 1)

      expect(handle.state).toBe('crashed')
      expect(handle.pid).toBeUndefined()
    })

    it('transitions to Stopped on clean exit (code 0)', async () => {
      const { UtilityProcessHandle } = await loadModules()
      const mockProc = createMockUtilityProcess()
      mockUtilityProcess.fork.mockReturnValue(mockProc)

      const handle = new UtilityProcessHandle({ type: 'utility', id: 'clean-exit', modulePath: '/module.js' })
      await handle.start()

      mockProc.emit('exit', 0)

      expect(handle.state).toBe('stopped')
      expect(handle.pid).toBeUndefined()
    })

    it('transitions to Stopped (not Crashed) when stopping and process exits non-zero', async () => {
      const { UtilityProcessHandle } = await loadModules()
      const mockProc = createMockUtilityProcess()
      mockUtilityProcess.fork.mockReturnValue(mockProc)

      const handle = new UtilityProcessHandle({ type: 'utility', id: 'stopping-exit', modulePath: '/module.js' })
      await handle.start()

      const stopPromise = handle.stop()
      mockProc.emit('exit', 1)
      await stopPromise

      expect(handle.state).toBe('stopped')
    })

    it('calls onExited callback on exit', async () => {
      const { UtilityProcessHandle } = await loadModules()
      const mockProc = createMockUtilityProcess()
      mockUtilityProcess.fork.mockReturnValue(mockProc)

      const handle = new UtilityProcessHandle({ type: 'utility', id: 'onexited-proc', modulePath: '/module.js' })
      const onExited = vi.fn()
      handle.onExited = onExited

      await handle.start()
      mockProc.emit('exit', 0)

      expect(onExited).toHaveBeenCalledWith(0, null)
    })
  })

  describe('restart()', () => {
    it('stops then starts the process, getting a new pid', async () => {
      const { UtilityProcessHandle } = await loadModules()

      const mockProc1 = createMockUtilityProcess(1111)
      const mockProc2 = createMockUtilityProcess(2222)
      mockUtilityProcess.fork.mockReturnValueOnce(mockProc1).mockReturnValueOnce(mockProc2)

      const handle = new UtilityProcessHandle({ type: 'utility', id: 'restart-proc', modulePath: '/module.js' })
      await handle.start()

      expect(handle.pid).toBe(1111)

      const restartPromise = handle.restart()

      // Simulate first process exiting after kill
      mockProc1.emit('exit', 0)

      await restartPromise

      expect(handle.state).toBe('running')
      expect(handle.pid).toBe(2222)
      expect(mockUtilityProcess.fork).toHaveBeenCalledTimes(2)
    })
  })
})
