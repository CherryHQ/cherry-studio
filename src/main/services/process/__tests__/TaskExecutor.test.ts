import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ProcessState } from '../types'

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

type MockHandle = {
  id: string
  state: ProcessState
  pid: number | undefined
  postMessage: ReturnType<typeof vi.fn>
  _messageHandlers: Set<(msg: unknown) => void>
  onMessage: ReturnType<typeof vi.fn>
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
  restart: ReturnType<typeof vi.fn>
  onStarted: undefined
  onExited: undefined
  onLog: undefined
}

type MockPM = {
  register: ReturnType<typeof vi.fn>
  unregister: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
  off: ReturnType<typeof vi.fn>
  handles: Map<string, MockHandle>
}

function createAutoRespondMockPM(): MockPM {
  const handles = new Map<string, MockHandle>()
  return {
    on: vi.fn(),
    off: vi.fn(),
    register: vi.fn((def: { id: string; [key: string]: unknown }) => {
      const proc: MockHandle = {
        id: def.id,
        state: ProcessState.Idle,
        pid: undefined,
        postMessage: vi.fn((msg: { taskId?: string; taskType?: string }) => {
          if (msg.taskId) {
            setTimeout(() => {
              for (const handler of proc._messageHandlers) {
                handler({ taskId: msg.taskId, result: `result-of-${msg.taskType}` })
              }
            }, 0)
          }
        }),
        _messageHandlers: new Set(),
        onMessage: vi.fn((handler: (msg: unknown) => void) => {
          proc._messageHandlers.add(handler)
          return () => proc._messageHandlers.delete(handler)
        }),
        start: vi.fn(async () => {
          proc.state = ProcessState.Running
          proc.pid = Math.floor(Math.random() * 10000)
        }),
        stop: vi.fn(async () => {
          proc.state = ProcessState.Stopped
        }),
        restart: vi.fn(),
        onStarted: undefined,
        onExited: undefined,
        onLog: undefined
      }
      handles.set(def.id, proc)
      return proc
    }),
    unregister: vi.fn(),
    handles
  }
}

function createManualMockPM(): MockPM {
  const handles = new Map<string, MockHandle>()
  return {
    on: vi.fn(),
    off: vi.fn(),
    register: vi.fn((def: { id: string; [key: string]: unknown }) => {
      const proc: MockHandle = {
        id: def.id,
        state: ProcessState.Idle,
        pid: undefined,
        postMessage: vi.fn(),
        _messageHandlers: new Set(),
        onMessage: vi.fn((handler: (msg: unknown) => void) => {
          proc._messageHandlers.add(handler)
          return () => proc._messageHandlers.delete(handler)
        }),
        start: vi.fn(async () => {
          proc.state = ProcessState.Running
          proc.pid = Math.floor(Math.random() * 10000)
        }),
        stop: vi.fn(async () => {
          proc.state = ProcessState.Stopped
        }),
        restart: vi.fn(),
        onStarted: undefined,
        onExited: undefined,
        onLog: undefined
      }
      handles.set(def.id, proc)
      return proc
    }),
    unregister: vi.fn(),
    handles
  }
}

async function loadModules() {
  const { TaskExecutor } = await import('../TaskExecutor')
  return { TaskExecutor }
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
})

describe('TaskExecutor', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  describe('exec()', () => {
    it('dispatches a task and returns the result', async () => {
      const { TaskExecutor } = await loadModules()
      const pm = createAutoRespondMockPM()

      const executor = new TaskExecutor(pm as any, {
        id: 'test-executor',
        modulePath: './worker.js',
        max: 2
      })

      const result = await executor.exec<string>('embed', ['chunk1', 'chunk2'])

      expect(result).toBe('result-of-embed')

      await executor.shutdown()
    })

    it('throws if called after shutdown', async () => {
      const { TaskExecutor } = await loadModules()
      const pm = createAutoRespondMockPM()

      const executor = new TaskExecutor(pm as any, {
        id: 'shutdown-exec',
        modulePath: './worker.js',
        max: 2
      })

      await executor.shutdown()

      await expect(executor.exec('embed', [])).rejects.toThrow("TaskExecutor 'shutdown-exec' is shutting down")
    })
  })

  describe('worker reuse', () => {
    it('reuses an idle worker for sequential tasks', async () => {
      const { TaskExecutor } = await loadModules()
      const pm = createAutoRespondMockPM()

      const executor = new TaskExecutor(pm as any, {
        id: 'reuse-executor',
        modulePath: './worker.js',
        max: 4
      })

      await executor.exec<string>('taskA', 'payload1')
      await executor.exec<string>('taskB', 'payload2')

      // Only one worker should have been spawned for sequential tasks
      expect(pm.register).toHaveBeenCalledTimes(1)

      await executor.shutdown()
    })
  })

  describe('worker scaling', () => {
    it('spawns up to max workers for concurrent tasks', async () => {
      const { TaskExecutor } = await loadModules()
      const pm = createAutoRespondMockPM()

      const executor = new TaskExecutor(pm as any, {
        id: 'scale-executor',
        modulePath: './worker.js',
        max: 3
      })

      // Fire 3 concurrent tasks
      const results = await Promise.all([
        executor.exec<string>('task1', 'a'),
        executor.exec<string>('task2', 'b'),
        executor.exec<string>('task3', 'c')
      ])

      expect(results).toEqual(['result-of-task1', 'result-of-task2', 'result-of-task3'])
      // Up to 3 workers may be spawned for 3 concurrent tasks
      expect(pm.register.mock.calls.length).toBeLessThanOrEqual(3)
      expect(pm.register.mock.calls.length).toBeGreaterThanOrEqual(1)

      await executor.shutdown()
    })

    it('does not exceed max workers', async () => {
      const { TaskExecutor } = await loadModules()
      const pm = createManualMockPM()

      const executor = new TaskExecutor(pm as any, {
        id: 'max-executor',
        modulePath: './worker.js',
        max: 2
      })

      // Fire 3 tasks — executor can only have max 2 workers
      const p1 = executor.exec<string>('task1', 'a')
      const p2 = executor.exec<string>('task2', 'b')
      const p3 = executor.exec<string>('task3', 'c') // should stay queued

      // Let the event loop settle so workers are spawned and tasks are assigned
      await new Promise((r) => setTimeout(r, 10))

      // No more than 2 workers should have been registered
      expect(pm.register.mock.calls.length).toBeLessThanOrEqual(2)

      // Now manually respond to the 2 in-flight tasks
      for (const [, handle] of pm.handles) {
        const lastCall = handle.postMessage.mock.calls.at(-1)
        if (lastCall) {
          const msg = lastCall[0] as { taskId: string; taskType: string }
          for (const handler of handle._messageHandlers) {
            handler({ taskId: msg.taskId, result: `result-of-${msg.taskType}` })
          }
        }
      }

      // Let dispatch run for the queued task
      await new Promise((r) => setTimeout(r, 10))

      // Now respond to the third task
      for (const [, handle] of pm.handles) {
        const lastCall = handle.postMessage.mock.calls.at(-1)
        if (lastCall) {
          const msg = lastCall[0] as { taskId: string; taskType: string }
          for (const handler of handle._messageHandlers) {
            handler({ taskId: msg.taskId, result: `result-of-${msg.taskType}` })
          }
        }
      }

      const [r1, r2, r3] = await Promise.all([p1, p2, p3])
      const results = [r1, r2, r3].sort()
      expect(results).toEqual(['result-of-task1', 'result-of-task2', 'result-of-task3'])

      await executor.shutdown()
    })
  })

  describe('task queuing', () => {
    it('queues tasks beyond max and dispatches when a worker becomes free', async () => {
      const { TaskExecutor } = await loadModules()
      const pm = createManualMockPM()

      const executor = new TaskExecutor(pm as any, {
        id: 'queue-executor',
        modulePath: './worker.js',
        max: 1
      })

      const p1 = executor.exec<string>('task1', 'first')
      const p2 = executor.exec<string>('task2', 'second') // queued behind task1

      // Let the event loop settle
      await new Promise((r) => setTimeout(r, 10))

      // Only 1 worker should have been spawned
      expect(pm.register).toHaveBeenCalledTimes(1)

      const [, worker] = Array.from(pm.handles.entries())[0]

      // Respond to the first task
      const firstMsg = worker.postMessage.mock.calls[0][0] as { taskId: string; taskType: string }
      for (const handler of worker._messageHandlers) {
        handler({ taskId: firstMsg.taskId, result: 'result-of-task1' })
      }

      // Let dispatch run for the queued task
      await new Promise((r) => setTimeout(r, 10))

      // Respond to the second task
      const secondMsg = worker.postMessage.mock.calls[1][0] as { taskId: string; taskType: string }
      for (const handler of worker._messageHandlers) {
        handler({ taskId: secondMsg.taskId, result: 'result-of-task2' })
      }

      const [r1, r2] = await Promise.all([p1, p2])
      expect(r1).toBe('result-of-task1')
      expect(r2).toBe('result-of-task2')

      // Still only 1 worker
      expect(pm.register).toHaveBeenCalledTimes(1)

      await executor.shutdown()
    })
  })

  describe('shutdown()', () => {
    it('rejects all queued and in-flight tasks', async () => {
      const { TaskExecutor } = await loadModules()
      const pm = createManualMockPM()

      const executor = new TaskExecutor(pm as any, {
        id: 'shutdown-executor',
        modulePath: './worker.js',
        max: 1
      })

      const p1 = executor.exec<string>('task1', 'a')
      const p2 = executor.exec<string>('task2', 'b') // will be queued

      // Let event loop settle to spawn worker and assign task1
      await new Promise((r) => setTimeout(r, 10))

      // Shutdown while tasks are pending
      await executor.shutdown()

      await expect(p1).rejects.toThrow("TaskExecutor 'shutdown-executor' shut down")
      await expect(p2).rejects.toThrow("TaskExecutor 'shutdown-executor' shut down")
    })

    it('stops and unregisters all workers on shutdown', async () => {
      const { TaskExecutor } = await loadModules()
      const pm = createAutoRespondMockPM()

      const executor = new TaskExecutor(pm as any, {
        id: 'cleanup-executor',
        modulePath: './worker.js',
        max: 2
      })

      // Run a task to spawn a worker
      await executor.exec<string>('task1', 'a')

      await executor.shutdown()

      // All workers should have been stopped
      for (const [, handle] of pm.handles) {
        expect(handle.stop).toHaveBeenCalled()
      }

      // All workers should have been unregistered
      expect(pm.unregister).toHaveBeenCalled()
    })

    it('is idempotent (calling shutdown twice is safe)', async () => {
      const { TaskExecutor } = await loadModules()
      const pm = createAutoRespondMockPM()

      const executor = new TaskExecutor(pm as any, {
        id: 'idempotent-executor',
        modulePath: './worker.js',
        max: 1
      })

      await executor.shutdown()
      await expect(executor.shutdown()).resolves.toBeUndefined()
    })
  })

  describe('idle timeout', () => {
    it('stops and unregisters worker after idle timeout', async () => {
      vi.useFakeTimers()

      const { TaskExecutor } = await loadModules()
      const pm = createAutoRespondMockPM()

      const executor = new TaskExecutor(pm as any, {
        id: 'idle-executor',
        modulePath: './worker.js',
        max: 2,
        idleTimeoutMs: 1000
      })

      // Spawn a worker by running a task (uses real setTimeout internally via auto-respond)
      // With fake timers, we need to tick for the auto-respond setTimeout(0) to fire
      const taskPromise = executor.exec<string>('task', 'data')
      await vi.runAllTimersAsync()
      await taskPromise

      // Now the worker is idle — advance past idle timeout
      const handle = Array.from(pm.handles.values())[0]
      expect(handle).toBeDefined()

      vi.advanceTimersByTime(1001)
      await vi.runAllTimersAsync()

      expect(handle.stop).toHaveBeenCalled()
      expect(pm.unregister).toHaveBeenCalled()

      vi.useRealTimers()
      await executor.shutdown()
    })
  })

  describe('error handling', () => {
    it('rejects the task promise when worker responds with an error', async () => {
      const { TaskExecutor } = await loadModules()
      const pm = createManualMockPM()

      // Override to respond with an error
      const errorPm = {
        ...pm,
        register: vi.fn((def: { id: string; [key: string]: unknown }) => {
          const proc = pm.register(def)
          const originalPostMessage = proc.postMessage
          proc.postMessage = vi.fn((msg: { taskId?: string; taskType?: string }) => {
            originalPostMessage(msg)
            if (msg.taskId) {
              setTimeout(() => {
                for (const handler of proc._messageHandlers) {
                  handler({ taskId: msg.taskId, error: 'worker processing failed' })
                }
              }, 0)
            }
          })
          return proc
        })
      }

      const executor = new TaskExecutor(errorPm as any, {
        id: 'error-executor',
        modulePath: './worker.js',
        max: 1
      })

      await expect(executor.exec('task', 'data')).rejects.toThrow('worker processing failed')

      await executor.shutdown()
    })
  })
})
