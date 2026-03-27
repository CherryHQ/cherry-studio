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

// Mock electron (utilityProcess specifically needed for UtilityProcessHandle)
const mockUtilityProcessFork = vi.fn()
vi.mock('electron', () => ({ utilityProcess: { fork: mockUtilityProcessFork } }))

function createMockChildProcess(pid = 1234) {
  const cp = new EventEmitter() as any
  cp.pid = pid
  cp.stdout = new EventEmitter()
  cp.stderr = new EventEmitter()
  cp.kill = vi.fn().mockReturnValue(true)
  return cp
}

async function loadModules() {
  const { crossPlatformSpawn } = await import('@main/utils/process')
  const { ProcessManager } = await import('../ProcessManager')
  const { ProcessState } = await import('../types')
  return {
    crossPlatformSpawn: crossPlatformSpawn as ReturnType<typeof vi.fn>,
    ProcessManager,
    ProcessState
  }
}

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  const { BaseService } = await import('@main/core/lifecycle')
  BaseService.resetInstances()
})

describe('ProcessManager', () => {
  describe('register()', () => {
    it('creates a handle with correct id and Idle state', async () => {
      const { ProcessManager, ProcessState } = await loadModules()
      const manager = new ProcessManager()

      const handle = manager.register({ type: 'child', id: 'proc-1', command: 'echo' })

      expect(handle.id).toBe('proc-1')
      expect(handle.state).toBe(ProcessState.Idle)
    })

    it('rejects duplicate ids', async () => {
      const { ProcessManager } = await loadModules()
      const manager = new ProcessManager()

      manager.register({ type: 'child', id: 'dup-proc', command: 'echo' })

      expect(() => manager.register({ type: 'child', id: 'dup-proc', command: 'echo' })).toThrow(
        "Process 'dup-proc' is already registered"
      )
    })

    it('creates a UtilityProcessHandle for utility type', async () => {
      const { EventEmitter } = await import('events')
      const mockProc = new EventEmitter() as any
      mockProc.pid = 7777
      mockProc.postMessage = vi.fn()
      mockProc.kill = vi.fn()
      mockUtilityProcessFork.mockReturnValue(mockProc)

      const { ProcessManager, ProcessState } = await loadModules()
      const manager = new ProcessManager()

      const handle = manager.register({ type: 'utility', id: 'util-proc', modulePath: '/some/module.js' })

      expect(handle.id).toBe('util-proc')
      expect(handle.state).toBe(ProcessState.Idle)
    })
  })

  describe('get()', () => {
    it('retrieves a registered handle by id', async () => {
      const { ProcessManager } = await loadModules()
      const manager = new ProcessManager()

      const handle = manager.register({ type: 'child', id: 'get-proc', command: 'echo' })

      expect(manager.get('get-proc')).toBe(handle)
    })

    it('returns undefined for unknown id', async () => {
      const { ProcessManager } = await loadModules()
      const manager = new ProcessManager()

      expect(manager.get('nonexistent')).toBeUndefined()
    })
  })

  describe('events', () => {
    it('emits process:started when a child process starts', async () => {
      const { crossPlatformSpawn, ProcessManager } = await loadModules()
      const mockCp = createMockChildProcess(5678)
      crossPlatformSpawn.mockReturnValue(mockCp)

      const manager = new ProcessManager()
      const handle = manager.register({ type: 'child', id: 'start-proc', command: 'node' })

      const startedListener = vi.fn()
      manager.on('process:started', startedListener)

      await handle.start()

      expect(startedListener).toHaveBeenCalledWith('start-proc', 5678)
    })

    it('emits process:exited when process exits', async () => {
      const { crossPlatformSpawn, ProcessManager } = await loadModules()
      const mockCp = createMockChildProcess()
      crossPlatformSpawn.mockReturnValue(mockCp)

      const manager = new ProcessManager()
      const handle = manager.register({ type: 'child', id: 'exit-proc', command: 'node' })

      const exitedListener = vi.fn()
      manager.on('process:exited', exitedListener)

      await handle.start()
      mockCp.emit('close', 0, null)

      expect(exitedListener).toHaveBeenCalledWith('exit-proc', 0, null)
    })

    it('emits process:log on stdout data', async () => {
      const { crossPlatformSpawn, ProcessManager } = await loadModules()
      const mockCp = createMockChildProcess()
      crossPlatformSpawn.mockReturnValue(mockCp)

      const manager = new ProcessManager()
      const handle = manager.register({ type: 'child', id: 'log-proc', command: 'node' })

      const logListener = vi.fn()
      manager.on('process:log', logListener)

      await handle.start()
      mockCp.stdout.emit('data', Buffer.from('hello\n'))

      expect(logListener).toHaveBeenCalledWith(
        expect.objectContaining({
          processId: 'log-proc',
          stream: 'stdout',
          data: 'hello\n'
        })
      )
    })

    it('emits process:log on stderr data', async () => {
      const { crossPlatformSpawn, ProcessManager } = await loadModules()
      const mockCp = createMockChildProcess()
      crossPlatformSpawn.mockReturnValue(mockCp)

      const manager = new ProcessManager()
      const handle = manager.register({ type: 'child', id: 'stderr-log-proc', command: 'node' })

      const logListener = vi.fn()
      manager.on('process:log', logListener)

      await handle.start()
      mockCp.stderr.emit('data', Buffer.from('error output\n'))

      expect(logListener).toHaveBeenCalledWith(
        expect.objectContaining({
          processId: 'stderr-log-proc',
          stream: 'stderr',
          data: 'error output\n'
        })
      )
    })

    it('off() stops receiving events', async () => {
      const { crossPlatformSpawn, ProcessManager } = await loadModules()
      const mockCp = createMockChildProcess(9999)
      crossPlatformSpawn.mockReturnValue(mockCp)

      const manager = new ProcessManager()
      const handle = manager.register({ type: 'child', id: 'off-proc', command: 'node' })

      const startedListener = vi.fn()
      manager.on('process:started', startedListener)
      manager.off('process:started', startedListener)

      await handle.start()

      expect(startedListener).not.toHaveBeenCalled()
    })
  })

  describe('onStop()', () => {
    it('stops all running processes on shutdown', async () => {
      const { crossPlatformSpawn, ProcessManager } = await loadModules()
      const mockCp1 = createMockChildProcess(1111)
      const mockCp2 = createMockChildProcess(2222)
      crossPlatformSpawn.mockReturnValueOnce(mockCp1).mockReturnValueOnce(mockCp2)

      const manager = new ProcessManager()
      const handle1 = manager.register({ type: 'child', id: 'proc-a', command: 'sleep' })
      const handle2 = manager.register({ type: 'child', id: 'proc-b', command: 'sleep' })

      await handle1.start()
      await handle2.start()

      // Trigger stop: both processes will emit close event when SIGTERM is sent
      const stopPromise = manager._doStop()

      mockCp1.emit('close', 0, null)
      mockCp2.emit('close', 0, null)

      await stopPromise

      expect(mockCp1.kill).toHaveBeenCalledWith('SIGTERM')
      expect(mockCp2.kill).toHaveBeenCalledWith('SIGTERM')
    })

    it('does not stop already stopped processes', async () => {
      const { crossPlatformSpawn, ProcessManager } = await loadModules()
      const mockCp = createMockChildProcess(1111)
      crossPlatformSpawn.mockReturnValue(mockCp)

      const manager = new ProcessManager()
      const handle = manager.register({ type: 'child', id: 'already-stopped', command: 'echo' })

      await handle.start()
      mockCp.emit('close', 0, null)
      // Process is now stopped

      const stopPromise = manager._doStop()
      await stopPromise

      // kill was never called from _doStop (only once from start/close cycle)
      expect(mockCp.kill).not.toHaveBeenCalled()
    })

    it('continues stopping other processes if one fails', async () => {
      const { crossPlatformSpawn, ProcessManager } = await loadModules()
      const mockCp1 = createMockChildProcess(1111)
      const mockCp2 = createMockChildProcess(2222)

      // Make first process's stop throw
      mockCp1.kill = vi.fn().mockImplementation(() => {
        throw new Error('kill failed')
      })

      crossPlatformSpawn.mockReturnValueOnce(mockCp1).mockReturnValueOnce(mockCp2)

      const manager = new ProcessManager()
      const handle1 = manager.register({ type: 'child', id: 'fail-proc', command: 'sleep' })
      const handle2 = manager.register({ type: 'child', id: 'ok-proc', command: 'sleep' })

      await handle1.start()
      await handle2.start()

      const stopPromise = manager._doStop()

      // mockCp2 needs to close normally
      mockCp2.emit('close', 0, null)

      // Should not throw despite mockCp1 failing
      await expect(stopPromise).resolves.toBeUndefined()
      expect(mockCp2.kill).toHaveBeenCalledWith('SIGTERM')
    })
  })

  describe('unregister()', () => {
    it('removes a stopped process from registry', async () => {
      const { crossPlatformSpawn, ProcessManager } = await loadModules()
      const mockCp = createMockChildProcess()
      crossPlatformSpawn.mockReturnValue(mockCp)

      const manager = new ProcessManager()
      const handle = manager.register({ type: 'child', id: 'unreg-proc', command: 'echo' })

      await handle.start()
      mockCp.emit('close', 0, null)

      manager.unregister('unreg-proc')
      expect(manager.get('unreg-proc')).toBeUndefined()
    })

    it('removes an idle process from registry', async () => {
      const { ProcessManager } = await loadModules()
      const manager = new ProcessManager()

      manager.register({ type: 'child', id: 'idle-unreg', command: 'echo' })
      manager.unregister('idle-unreg')

      expect(manager.get('idle-unreg')).toBeUndefined()
    })

    it('rejects unregistering a running process', async () => {
      const { crossPlatformSpawn, ProcessManager } = await loadModules()
      const mockCp = createMockChildProcess()
      crossPlatformSpawn.mockReturnValue(mockCp)

      const manager = new ProcessManager()
      const handle = manager.register({ type: 'child', id: 'running-unreg', command: 'sleep' })

      await handle.start()

      expect(() => manager.unregister('running-unreg')).toThrow(
        "Cannot unregister process 'running-unreg': process is currently running"
      )
    })

    it('does nothing for unknown id', async () => {
      const { ProcessManager } = await loadModules()
      const manager = new ProcessManager()

      // Should not throw
      expect(() => manager.unregister('ghost')).not.toThrow()
    })
  })

  describe('onInit()', () => {
    it('initializes without error', async () => {
      const { ProcessManager } = await loadModules()
      const manager = new ProcessManager()

      await expect(manager._doInit()).resolves.toBeUndefined()
    })
  })
})
