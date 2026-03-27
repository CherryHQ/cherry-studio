import { beforeEach, describe, expect, it, vi } from 'vitest'

import { TaskExecutor } from '../TaskExecutor'
import { ProcessState } from '../types'

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

// ---------------------------------------------------------------------------
// Mock types & factories
// ---------------------------------------------------------------------------

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

type ExitedListener = (id: string, code: number | null, signal: NodeJS.Signals | null) => void

type MockPM = {
  register: ReturnType<typeof vi.fn>
  unregister: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
  off: ReturnType<typeof vi.fn>
  handles: Map<string, MockHandle>
}

function createMockHandle(id: string, autoRespond: boolean): MockHandle {
  const proc: MockHandle = {
    id,
    state: ProcessState.Idle,
    pid: undefined,
    postMessage: autoRespond
      ? vi.fn((msg: { taskId?: string; taskType?: string }) => {
          if (msg.taskId) {
            setTimeout(() => {
              for (const handler of proc._messageHandlers) {
                handler({ taskId: msg.taskId, result: `result-of-${msg.taskType}` })
              }
            }, 0)
          }
        })
      : vi.fn(),
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
  return proc
}

/**
 * @param autoRespond - When true, postMessage immediately schedules a success response.
 *                      When false, the caller must manually send responses.
 */
function createMockPM(autoRespond = false): MockPM {
  const handles = new Map<string, MockHandle>()
  return {
    on: vi.fn(),
    off: vi.fn(),
    register: vi.fn((def: { id: string }) => {
      const proc = createMockHandle(def.id, autoRespond)
      handles.set(def.id, proc)
      return proc
    }),
    unregister: vi.fn(),
    handles
  }
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Invoke all `process:exited` listeners registered on the mock PM for the given workerId. */
function simulateWorkerExit(pm: MockPM, workerId: string, code: number | null, signal: NodeJS.Signals | null): void {
  for (const call of pm.on.mock.calls) {
    if (call[0] === 'process:exited') {
      ;(call[1] as ExitedListener)(workerId, code, signal)
    }
  }
}

function sendResponse(handle: MockHandle, taskId: string, result: unknown): void {
  for (const handler of handle._messageHandlers) {
    handler({ taskId, result })
  }
}

function sendError(handle: MockHandle, taskId: string, error: string): void {
  for (const handler of handle._messageHandlers) {
    handler({ taskId, error })
  }
}

function postedTaskId(handle: MockHandle, callIndex: number): string {
  return (handle.postMessage.mock.calls[callIndex][0] as { taskId: string }).taskId
}

function firstHandle(pm: MockPM): MockHandle {
  return Array.from(pm.handles.values())[0]
}

function firstWorkerId(pm: MockPM): string {
  return Array.from(pm.handles.keys())[0]
}

const tick = () => new Promise((r) => setTimeout(r, 10))

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
})

describe('TaskExecutor', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  // -------------------------------------------------------------------------
  // exec()
  // -------------------------------------------------------------------------
  describe('exec()', () => {
    it('dispatches a task and returns the result', async () => {
      const pm = createMockPM(true)
      const executor = new TaskExecutor(pm as any, { id: 'exec-ok', modulePath: './w.js', max: 2 })

      const result = await executor.exec<string>('embed', ['chunk1'])
      expect(result).toBe('result-of-embed')

      await executor.shutdown()
    })

    it('throws if called after shutdown', async () => {
      const pm = createMockPM(true)
      const executor = new TaskExecutor(pm as any, { id: 'exec-shut', modulePath: './w.js', max: 1 })

      await executor.shutdown()

      await expect(executor.exec('embed', [])).rejects.toThrow("TaskExecutor 'exec-shut' is shutting down")
    })
  })

  describe('worker reuse', () => {
    it('dispatches the second task to the same worker after the first completes', async () => {
      const pm = createMockPM()
      const executor = new TaskExecutor(pm as any, { id: 'reuse', modulePath: './w.js', max: 4 })

      // Task 1: spawns worker-0
      const p1 = executor.exec<string>('taskA', 'a')
      await tick()
      expect(executor.workerCount).toBe(1)

      // Complete task 1 — worker becomes idle
      const worker = firstHandle(pm)
      sendResponse(worker, postedTaskId(worker, 0), 'rA')
      await p1

      // Task 2: should go to the same worker, no new spawn
      const p2 = executor.exec<string>('taskB', 'b')
      await tick()

      expect(executor.workerCount).toBe(1)

      // Complete task 2 before shutdown
      sendResponse(worker, postedTaskId(worker, 1), 'rB')
      await p2

      await executor.shutdown()
    })
  })

  describe('worker scaling', () => {
    it('spawns a second worker when the first is busy', async () => {
      const pm = createMockPM()
      const executor = new TaskExecutor(pm as any, { id: 'scale', modulePath: './w.js', max: 2 })

      const p1 = executor.exec<string>('t1', 'a')
      await tick()
      expect(executor.workerCount).toBe(1)

      // Second task cannot reuse busy worker-0, must spawn worker-1
      const p2 = executor.exec<string>('t2', 'b')
      await tick()
      expect(executor.workerCount).toBe(2)

      // Resolve both tasks before shutdown
      const workers = Array.from(pm.handles.values())
      sendResponse(workers[0], postedTaskId(workers[0], 0), 'r1')
      sendResponse(workers[1], postedTaskId(workers[1], 0), 'r2')
      await p1
      await p2

      await executor.shutdown()
    })

    it('does not spawn beyond max, excess tasks stay in queue', async () => {
      const pm = createMockPM()
      const executor = new TaskExecutor(pm as any, { id: 'max', modulePath: './w.js', max: 2 })

      // Submit 3 tasks with max=2: 2 workers spawned, 1 task queued
      const p1 = executor.exec<string>('t1', 'a')
      const p2 = executor.exec<string>('t2', 'b')
      const p3 = executor.exec<string>('t3', 'c')
      await tick()

      expect(executor.workerCount).toBe(2)
      expect(executor.queueLength).toBe(1)

      // Complete all tasks
      const workers = Array.from(pm.handles.values())
      sendResponse(workers[0], postedTaskId(workers[0], 0), 'r1')
      sendResponse(workers[1], postedTaskId(workers[1], 0), 'r2')
      sendResponse(workers[0], postedTaskId(workers[0], 1), 'r3')
      await Promise.all([p1, p2, p3])

      await executor.shutdown()
    })
  })

  describe('task queuing', () => {
    it('holds queued task until a worker finishes, then dispatches to that freed worker', async () => {
      const pm = createMockPM()
      const executor = new TaskExecutor(pm as any, { id: 'queue', modulePath: './w.js', max: 1 })

      const p1 = executor.exec<string>('t1', 'first')
      const p2 = executor.exec<string>('t2', 'second')
      await tick()

      const worker = firstHandle(pm)

      // Task 2 is waiting in the queue, not dispatched
      expect(executor.queueLength).toBe(1)
      expect(executor.pendingCount).toBe(1)

      // Complete task 1 — task 2 should be dispatched to the same worker
      sendResponse(worker, postedTaskId(worker, 0), 'r1')
      await p1
      expect(pm.handles.size).toBe(1)

      // Complete task 2
      sendResponse(worker, postedTaskId(worker, 1), 'r2')
      await p2

      await executor.shutdown()
    })

    it('dispatches queued task even when the in-flight task fails', async () => {
      const pm = createMockPM()
      const executor = new TaskExecutor(pm as any, { id: 'queue-err', modulePath: './w.js', max: 1 })

      const p1 = executor.exec<string>('t1', 'first')
      const p2 = executor.exec<string>('t2', 'second')
      await tick()

      const worker = firstHandle(pm)
      // Task 1 fails — worker freed, task 2 should still be dispatched
      sendError(worker, postedTaskId(worker, 0), 'task1 failed')
      await expect(p1).rejects.toThrow('task1 failed')

      expect(executor.queueLength).toBe(0)
      expect(executor.pendingCount).toBe(1)
      expect(pm.handles.size).toBe(1)

      // Task 2 succeeds on the same worker
      sendResponse(worker, postedTaskId(worker, 1), 'r2')
      expect(await p2).toBe('r2')

      await executor.shutdown()
    })
  })

  // -------------------------------------------------------------------------
  // handleWorkerMessage edge cases
  // -------------------------------------------------------------------------
  describe('handleWorkerMessage()', () => {
    it('ignores response for unknown taskId', async () => {
      const pm = createMockPM()
      const executor = new TaskExecutor(pm as any, { id: 'unk-tid', modulePath: './w.js', max: 1 })

      const p = executor.exec<string>('task', 'data')
      await tick()

      const worker = firstHandle(pm)

      // Unknown taskId — should be silently ignored
      sendResponse(worker, 'nonexistent-id', 'nope')

      // Real response resolves the task
      sendResponse(worker, postedTaskId(worker, 0), 'real')

      expect(await p).toBe('real')
      await executor.shutdown()
    })

    it('rejects the task when worker responds with an error', async () => {
      const pm = createMockPM()
      const executor = new TaskExecutor(pm as any, { id: 'err-resp', modulePath: './w.js', max: 1 })

      const p = executor.exec('task', 'data')
      await tick()

      const worker = firstHandle(pm)
      sendError(worker, postedTaskId(worker, 0), 'processing failed')

      await expect(p).rejects.toThrow('processing failed')
      await executor.shutdown()
    })
  })

  // -------------------------------------------------------------------------
  // Worker crash (handleWorkerExit)
  // -------------------------------------------------------------------------
  describe('worker crash (handleWorkerExit)', () => {
    it('rejects in-flight task when worker exits unexpectedly', async () => {
      const pm = createMockPM()
      const executor = new TaskExecutor(pm as any, { id: 'crash-task', modulePath: './w.js', max: 1 })

      const p = executor.exec<string>('task', 'data')
      await tick()

      simulateWorkerExit(pm, firstWorkerId(pm), 1, null)

      await expect(p).rejects.toThrow(/exited unexpectedly/)
    })

    it('handles idle worker crash (no in-flight task)', async () => {
      const pm = createMockPM(true)
      const executor = new TaskExecutor(pm as any, { id: 'idle-crash', modulePath: './w.js', max: 1 })

      // Complete a task so the worker becomes idle
      await executor.exec<string>('task', 'data')
      expect(executor.workerCount).toBe(1)

      const workerId = firstWorkerId(pm)
      simulateWorkerExit(pm, workerId, 1, null)

      // Worker removed from internal map
      expect(executor.workerCount).toBe(0)
      expect(pm.unregister).toHaveBeenCalledWith(workerId)

      await executor.shutdown()
    })

    it('handles unregister failure for crashed worker', async () => {
      const pm = createMockPM()
      pm.unregister.mockImplementation(() => {
        throw new Error('unregister boom')
      })
      const executor = new TaskExecutor(pm as any, { id: 'crash-unreg-fail', modulePath: './w.js', max: 1 })

      const p = executor.exec<string>('task', 'data')
      await tick()

      simulateWorkerExit(pm, firstWorkerId(pm), 1, null)

      // Task should still be rejected even though unregister threw
      await expect(p).rejects.toThrow(/exited unexpectedly/)
    })

    it('dispatches queued tasks to a new worker after crash', async () => {
      const pm = createMockPM()
      const executor = new TaskExecutor(pm as any, { id: 'crash-redispatch', modulePath: './w.js', max: 1 })

      const p1 = executor.exec<string>('t1', 'a')
      const p2 = executor.exec<string>('t2', 'b')
      await tick()

      expect(executor.workerCount).toBe(1)
      expect(executor.queueLength).toBe(1)

      // Crash the first worker — t1 rejected, dispatch() called synchronously
      // which calls spawnWorker() that synchronously adds new worker to the map
      simulateWorkerExit(pm, firstWorkerId(pm), 1, null)
      await expect(p1).rejects.toThrow(/exited unexpectedly/)

      // After spawnWorker's async start() settles, task is assigned to new worker
      await tick()
      expect(executor.workerCount).toBe(1)
      expect(executor.queueLength).toBe(0)
      expect(executor.pendingCount).toBe(1)

      // Complete t2 on the new worker
      const newWorker = Array.from(pm.handles.values())[1]
      sendResponse(newWorker, postedTaskId(newWorker, 0), 'result-t2')
      expect(await p2).toBe('result-t2')

      await executor.shutdown()
    })
  })

  // -------------------------------------------------------------------------
  // dispatch() error handling
  // -------------------------------------------------------------------------
  describe('dispatch()', () => {
    it('catches and logs spawnWorker failure without crashing', async () => {
      const pm = createMockPM()

      // Make start() reject to simulate spawnWorker failure
      pm.register.mockImplementation((def: { id: string }) => {
        const proc = createMockHandle(def.id, false)
        proc.start.mockRejectedValueOnce(new Error('start failed'))
        pm.handles.set(def.id, proc)
        return proc
      })

      const executor = new TaskExecutor(pm as any, { id: 'spawn-fail', modulePath: './w.js', max: 1 })

      // exec queues the task and dispatch tries to spawn — spawn fails
      const p = executor.exec<string>('task', 'data')
      await tick()

      // Task stays in queue — spawn failed, no worker to dispatch to
      expect(executor.queueLength).toBe(1)
      expect(executor.pendingCount).toBe(0)

      await executor.shutdown()
      await expect(p).rejects.toThrow("TaskExecutor 'spawn-fail' shut down")
    })
  })

  // -------------------------------------------------------------------------
  // shutdown()
  // -------------------------------------------------------------------------
  describe('shutdown()', () => {
    it('rejects all queued and in-flight tasks', async () => {
      const pm = createMockPM()
      const executor = new TaskExecutor(pm as any, { id: 'shut-reject', modulePath: './w.js', max: 1 })

      const p1 = executor.exec<string>('t1', 'a')
      const p2 = executor.exec<string>('t2', 'b') // queued

      await tick()

      await executor.shutdown()

      await expect(p1).rejects.toThrow("TaskExecutor 'shut-reject' shut down")
      await expect(p2).rejects.toThrow("TaskExecutor 'shut-reject' shut down")
    })

    it('handles stop() failure during shutdown', async () => {
      const pm = createMockPM(true)
      const executor = new TaskExecutor(pm as any, { id: 'shut-stop-fail', modulePath: './w.js', max: 1 })

      await executor.exec<string>('task', 'a')

      firstHandle(pm).stop.mockRejectedValueOnce(new Error('stop failed'))

      // shutdown should not throw
      await expect(executor.shutdown()).resolves.toBeUndefined()
      // unregister should still be called
      expect(pm.unregister).toHaveBeenCalled()
    })

    it('handles unregister() failure during shutdown', async () => {
      const pm = createMockPM(true)
      pm.unregister.mockImplementation(() => {
        throw new Error('unregister boom')
      })
      const executor = new TaskExecutor(pm as any, { id: 'shut-unreg-fail', modulePath: './w.js', max: 1 })

      await executor.exec<string>('task', 'a')

      // shutdown should not throw even if unregister fails
      await expect(executor.shutdown()).resolves.toBeUndefined()
    })
  })

  // -------------------------------------------------------------------------
  // Idle timeout (scheduleIdleTimeout)
  // -------------------------------------------------------------------------
  describe('idle timeout', () => {
    it('stops and unregisters worker after idle timeout', async () => {
      vi.useFakeTimers()

      const pm = createMockPM()
      const executor = new TaskExecutor(pm as any, {
        id: 'idle',
        modulePath: './w.js',
        max: 2,
        idleTimeoutMs: 1000
      })

      // Spawn worker and complete a task manually
      const p = executor.exec<string>('task', 'data')
      await vi.advanceTimersByTimeAsync(0)
      const handle = firstHandle(pm)
      sendResponse(handle, postedTaskId(handle, 0), 'r')
      await p

      expect(executor.workerCount).toBe(1)

      // Advance past idle timeout
      vi.advanceTimersByTime(1001)
      await vi.advanceTimersByTimeAsync(0)

      expect(executor.workerCount).toBe(0)
      expect(handle.stop).toHaveBeenCalled()
      expect(pm.unregister).toHaveBeenCalled()

      await executor.shutdown()
    })

    it('unregisters worker even when stop() fails (finally)', async () => {
      vi.useFakeTimers()

      const pm = createMockPM(true)
      const executor = new TaskExecutor(pm as any, {
        id: 'idle-fail',
        modulePath: './w.js',
        max: 2,
        idleTimeoutMs: 1000
      })

      const taskPromise = executor.exec<string>('task', 'data')
      await vi.runAllTimersAsync()
      await taskPromise

      firstHandle(pm).stop.mockRejectedValueOnce(new Error('stop failed'))

      vi.advanceTimersByTime(1001)
      await vi.runAllTimersAsync()

      expect(pm.unregister).toHaveBeenCalled()

      await executor.shutdown()
    })

    it('cancels idle timer when a new task is assigned to the worker', async () => {
      vi.useFakeTimers()

      const pm = createMockPM() // manual — no auto-respond
      const executor = new TaskExecutor(pm as any, {
        id: 'idle-cancel',
        modulePath: './w.js',
        max: 1,
        idleTimeoutMs: 1000
      })

      // Task 1: spawn worker, complete it → idle timer starts
      const p1 = executor.exec<string>('t1', 'a')
      await vi.advanceTimersByTimeAsync(0) // let async spawn settle

      const worker = firstHandle(pm)
      sendResponse(worker, postedTaskId(worker, 0), 'r1')
      await p1
      // Idle timer (1000ms) is now ticking.

      // Advance 500ms — timer hasn't fired yet
      vi.advanceTimersByTime(500)

      // Submit task 2 — dispatch finds idle worker, assignTask cancels the timer
      const p2 = executor.exec<string>('t2', 'b')

      // Advance past original 1000ms mark (500 + 600 = 1100ms since timer set)
      vi.advanceTimersByTime(600)

      // Worker should NOT be stopped — the old timer was cancelled by assignTask
      expect(worker.stop).not.toHaveBeenCalled()

      // Complete task 2
      sendResponse(worker, postedTaskId(worker, 1), 'r2')
      await p2

      await executor.shutdown()
    })

    it('does not stop worker that became busy when timeout fires', async () => {
      vi.useFakeTimers()

      const pm = createMockPM()
      const executor = new TaskExecutor(pm as any, {
        id: 'idle-busy',
        modulePath: './w.js',
        max: 1,
        idleTimeoutMs: 1000
      })

      // Spawn worker and complete a task → worker becomes idle, timer starts
      const p1 = executor.exec<string>('t1', 'a')
      await vi.runAllTimersAsync()

      const worker = firstHandle(pm)
      sendResponse(worker, postedTaskId(worker, 0), 'r1')
      // Don't run all timers yet — we want to control the idle timeout

      // Submit a second task right away. dispatch() finds the idle worker
      // and calls assignTask which cancels the timer. So the normal path
      // is that the timer is cancelled.
      //
      // To exercise the `current.busy` guard, we verify the overall
      // behavior: the worker is NOT stopped if it's busy.
      const p2 = executor.exec<string>('t2', 'b')

      // Advance past original idle timeout
      vi.advanceTimersByTime(1001)
      await vi.runAllTimersAsync()

      // Worker should NOT be stopped
      expect(worker.stop).not.toHaveBeenCalled()

      // Complete task 2 to clean up
      sendResponse(worker, postedTaskId(worker, 1), 'r2')
      await vi.runAllTimersAsync()
      await p1
      await p2

      await executor.shutdown()
    })

    it('does not schedule idle timeout during shutdown', async () => {
      vi.useFakeTimers()

      const pm = createMockPM()
      const executor = new TaskExecutor(pm as any, {
        id: 'idle-shutdown',
        modulePath: './w.js',
        max: 1,
        idleTimeoutMs: 1000
      })

      const p = executor.exec<string>('task', 'data')
      await vi.runAllTimersAsync()

      const worker = firstHandle(pm)

      // Start shutdown while the task is in-flight — p is rejected immediately
      const shutdownPromise = executor.shutdown()
      await expect(p).rejects.toThrow(/shut down/)

      // Now respond to the task — handleWorkerMessage calls scheduleIdleTimeout,
      // but it should skip because shuttingDown is true
      sendResponse(worker, postedTaskId(worker, 0), 'r')
      await vi.runAllTimersAsync()

      await shutdownPromise

      // Advance timers — no idle timeout should fire
      vi.advanceTimersByTime(2000)
      await vi.runAllTimersAsync()

      // stop() was called by shutdown, not by idle timeout
      expect(worker.stop).toHaveBeenCalledTimes(1)
    })
  })
})
