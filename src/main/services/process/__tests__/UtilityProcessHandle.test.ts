import { EventEmitter } from 'events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockUtilityProcess } = vi.hoisted(() => ({
  mockUtilityProcess: { fork: vi.fn() }
}))
vi.mock('electron', () => ({ utilityProcess: mockUtilityProcess }))

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

import { UtilityProcessHandle } from '../UtilityProcessHandle'

function createMockUtilityProcess(pid = 9876) {
  const proc = new EventEmitter() as any
  proc.pid = pid
  proc.postMessage = vi.fn()
  proc.kill = vi.fn()
  return proc
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('UtilityProcessHandle', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  describe('start()', () => {
    it('transitions to Running and stores pid', async () => {
      const mockProc = createMockUtilityProcess(9876)
      mockUtilityProcess.fork.mockReturnValue(mockProc)

      const handle = new UtilityProcessHandle({ id: 'proc1', modulePath: '/path/module.js' })
      await handle.start()

      expect(handle.state).toBe('running')
      expect(handle.pid).toBe(9876)
    })

    it('rejects start() if already running', async () => {
      const mockProc = createMockUtilityProcess()
      mockUtilityProcess.fork.mockReturnValue(mockProc)

      const handle = new UtilityProcessHandle({ id: 'proc2', modulePath: '/module.js' })
      await handle.start()

      await expect(handle.start()).rejects.toThrow(/already running/)
    })
  })

  describe('postMessage()', () => {
    it('throws if process is not running', () => {
      const handle = new UtilityProcessHandle({ id: 'idle-msg', modulePath: '/module.js' })

      expect(() => handle.postMessage('hello')).toThrow(/not running/)
    })
  })

  describe('onMessage()', () => {
    it('receives messages from the process', async () => {
      const mockProc = createMockUtilityProcess()
      mockUtilityProcess.fork.mockReturnValue(mockProc)

      const handle = new UtilityProcessHandle({ id: 'recv-proc', modulePath: '/module.js' })
      await handle.start()

      const received: unknown[] = []
      handle.onMessage((msg) => received.push(msg))

      mockProc.emit('message', { type: 'pong' })
      mockProc.emit('message', { type: 'data', value: 99 })

      expect(received).toEqual([{ type: 'pong' }, { type: 'data', value: 99 }])
    })

    it('cleanup function unsubscribes the handler', async () => {
      const mockProc = createMockUtilityProcess()
      mockUtilityProcess.fork.mockReturnValue(mockProc)

      const handle = new UtilityProcessHandle({ id: 'unsub-proc', modulePath: '/module.js' })
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
      const mockProc = createMockUtilityProcess()
      mockUtilityProcess.fork.mockReturnValue(mockProc)

      const handle = new UtilityProcessHandle({ id: 'stop-proc', modulePath: '/module.js' })
      await handle.start()

      const stopPromise = handle.stop()

      expect(mockProc.kill).toHaveBeenCalled()
      expect(handle.state).toBe('stopping')

      mockProc.emit('exit', 0)
      await stopPromise

      expect(handle.state).toBe('stopped')
    })

    it('does nothing if process is not running', async () => {
      const handle = new UtilityProcessHandle({ id: 'idle-stop', modulePath: '/module.js' })

      await expect(handle.stop()).resolves.toBeUndefined()
      expect(handle.state).toBe('idle')
    })

    it('resolves after killTimeoutMs if process does not exit', async () => {
      vi.useFakeTimers()

      const mockProc = createMockUtilityProcess()
      mockUtilityProcess.fork.mockReturnValue(mockProc)

      const handle = new UtilityProcessHandle({
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
    })
  })

  describe('process exit events', () => {
    it('transitions to Crashed on unexpected non-zero exit', async () => {
      const mockProc = createMockUtilityProcess()
      mockUtilityProcess.fork.mockReturnValue(mockProc)

      const handle = new UtilityProcessHandle({ id: 'crash-proc', modulePath: '/module.js' })
      await handle.start()

      mockProc.emit('exit', 1)

      expect(handle.state).toBe('crashed')
      expect(handle.pid).toBeUndefined()
    })

    it('transitions to Stopped on clean exit (code 0)', async () => {
      const mockProc = createMockUtilityProcess()
      mockUtilityProcess.fork.mockReturnValue(mockProc)

      const handle = new UtilityProcessHandle({ id: 'clean-exit', modulePath: '/module.js' })
      await handle.start()

      mockProc.emit('exit', 0)

      expect(handle.state).toBe('stopped')
      expect(handle.pid).toBeUndefined()
    })

    it('transitions to Stopped (not Crashed) when stopping and process exits non-zero', async () => {
      const mockProc = createMockUtilityProcess()
      mockUtilityProcess.fork.mockReturnValue(mockProc)

      const handle = new UtilityProcessHandle({ id: 'stopping-exit', modulePath: '/module.js' })
      await handle.start()

      const stopPromise = handle.stop()
      mockProc.emit('exit', 1)
      await stopPromise

      expect(handle.state).toBe('stopped')
    })
  })

  describe('fork error (synchronous throw)', () => {
    it('transitions to Crashed when utilityProcess.fork throws', async () => {
      mockUtilityProcess.fork.mockImplementation(() => {
        throw new Error('MODULE_NOT_FOUND')
      })

      const handle = new UtilityProcessHandle({ id: 'throw-proc', modulePath: '/bad/path.js' })

      await expect(handle.start()).rejects.toThrow('MODULE_NOT_FOUND')
      expect(handle.state).toBe('crashed')
      expect(handle.pid).toBeUndefined()
    })

    it('calls onExited with (null, null) when fork throws', async () => {
      mockUtilityProcess.fork.mockImplementation(() => {
        throw new Error('fork failed')
      })

      const handle = new UtilityProcessHandle({ id: 'throw-exited', modulePath: '/bad.js' })
      const onExited = vi.fn()
      handle.onExited = onExited

      await expect(handle.start()).rejects.toThrow('fork failed')
      expect(onExited).toHaveBeenCalledOnce()
      expect(onExited).toHaveBeenCalledWith(null, null)
    })
  })

  describe('restart()', () => {
    it('stops then starts the process, getting a new pid', async () => {
      const mockProc1 = createMockUtilityProcess(1111)
      const mockProc2 = createMockUtilityProcess(2222)
      mockUtilityProcess.fork.mockReturnValueOnce(mockProc1).mockReturnValueOnce(mockProc2)

      const handle = new UtilityProcessHandle({ id: 'restart-proc', modulePath: '/module.js' })
      await handle.start()

      expect(handle.pid).toBe(1111)

      const restartPromise = handle.restart()

      // Simulate first process exiting after kill
      mockProc1.emit('exit', 0)

      await restartPromise

      expect(handle.state).toBe('running')
      expect(handle.pid).toBe(2222)
    })
  })
})
