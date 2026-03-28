import { EventEmitter } from 'events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('child_process', () => ({ spawn: vi.fn() }))
vi.mock('@main/utils/process', () => ({ crossPlatformSpawn: vi.fn() }))
vi.mock('@main/utils/shell-env', () => ({
  default: vi.fn().mockResolvedValue({ PATH: '/usr/bin' })
}))

const mockUtilityProcessFork = vi.fn()
vi.mock('electron', () => ({ utilityProcess: { fork: mockUtilityProcessFork } }))

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
  const { ProcessManager } = await import('../ProcessManager')
  return {
    crossPlatformSpawn: crossPlatformSpawn as ReturnType<typeof vi.fn>,
    ProcessManager
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
    it('rejects duplicate ids', async () => {
      const { ProcessManager } = await loadModules()
      const manager = new ProcessManager()

      manager.register({ id: 'dup-proc', command: 'echo' })

      expect(() => manager.register({ id: 'dup-proc', command: 'echo' })).toThrow(
        "Process 'dup-proc' is already registered"
      )
    })
  })

  describe('get()', () => {
    it('retrieves a registered handle by id', async () => {
      const { ProcessManager } = await loadModules()
      const manager = new ProcessManager()

      const handle = manager.register({ id: 'get-proc', command: 'echo' })

      expect(manager.get('get-proc')).toBe(handle)
    })
  })

  describe('events', () => {
    it('emits process:started when a child process starts', async () => {
      const { crossPlatformSpawn, ProcessManager } = await loadModules()
      const mockCp = createMockChildProcess(5678)
      crossPlatformSpawn.mockReturnValue(mockCp)

      const manager = new ProcessManager()
      manager.register({ id: 'start-proc', command: 'node' })

      const startedListener = vi.fn()
      manager.on('process:started', startedListener)

      await manager.get('start-proc')!.start()

      expect(startedListener).toHaveBeenCalledWith('start-proc', 5678)
    })

    it('emits process:exited when process exits', async () => {
      const { crossPlatformSpawn, ProcessManager } = await loadModules()
      const mockCp = createMockChildProcess()
      crossPlatformSpawn.mockReturnValue(mockCp)

      const manager = new ProcessManager()
      manager.register({ id: 'exit-proc', command: 'node' })

      const exitedListener = vi.fn()
      manager.on('process:exited', exitedListener)

      await manager.get('exit-proc')!.start()
      mockCp.emit('close', 0, null)

      expect(exitedListener).toHaveBeenCalledWith('exit-proc', 0, null)
    })

    it('emits process:log on stdout and stderr data', async () => {
      const { crossPlatformSpawn, ProcessManager } = await loadModules()
      const mockCp = createMockChildProcess()
      crossPlatformSpawn.mockReturnValue(mockCp)

      const manager = new ProcessManager()
      manager.register({ id: 'log-proc', command: 'node' })

      const logListener = vi.fn()
      manager.on('process:log', logListener)

      await manager.get('log-proc')!.start()
      mockCp.stdout.emit('data', Buffer.from('hello\n'))
      mockCp.stderr.emit('data', Buffer.from('error output\n'))

      expect(logListener).toHaveBeenCalledTimes(2)
      expect(logListener).toHaveBeenCalledWith(
        expect.objectContaining({ processId: 'log-proc', stream: 'stdout', data: 'hello\n' })
      )
      expect(logListener).toHaveBeenCalledWith(
        expect.objectContaining({ processId: 'log-proc', stream: 'stderr', data: 'error output\n' })
      )
    })

    it('off() stops receiving events', async () => {
      const { crossPlatformSpawn, ProcessManager } = await loadModules()
      const mockCp = createMockChildProcess(9999)
      crossPlatformSpawn.mockReturnValue(mockCp)

      const manager = new ProcessManager()
      manager.register({ id: 'off-proc', command: 'node' })

      const startedListener = vi.fn()
      manager.on('process:started', startedListener)
      manager.off('process:started', startedListener)

      await manager.get('off-proc')!.start()

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
      const handle1 = manager.register({ id: 'proc-a', command: 'sleep' })
      const handle2 = manager.register({ id: 'proc-b', command: 'sleep' })

      await handle1.start()
      await handle2.start()

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
      const handle = manager.register({ id: 'already-stopped', command: 'echo' })

      await handle.start()
      mockCp.emit('close', 0, null)

      const stopPromise = manager._doStop()
      await stopPromise

      // kill was never called from _doStop (only once from start/close cycle)
      expect(mockCp.kill).not.toHaveBeenCalled()
    })

    it('does not stop skipOnStop handles during onStop', async () => {
      const { crossPlatformSpawn, ProcessManager } = await loadModules()
      const mockCp = createMockChildProcess(1111)
      crossPlatformSpawn.mockReturnValue(mockCp)

      const manager = new ProcessManager()
      const handle = manager.register({ id: 'skip-proc', command: 'sleep', skipOnStop: true })

      await handle.start()

      await manager._doStop()

      expect(mockCp.kill).not.toHaveBeenCalled()
      expect(handle.state).toBe('running')
    })

    it('continues stopping other processes if one fails', async () => {
      const { crossPlatformSpawn, ProcessManager } = await loadModules()
      const mockCp1 = createMockChildProcess(1111)
      const mockCp2 = createMockChildProcess(2222)

      mockCp1.kill = vi.fn().mockImplementation(() => {
        throw new Error('kill failed')
      })

      crossPlatformSpawn.mockReturnValueOnce(mockCp1).mockReturnValueOnce(mockCp2)

      const manager = new ProcessManager()
      const handle1 = manager.register({ id: 'fail-proc', command: 'sleep' })
      const handle2 = manager.register({ id: 'ok-proc', command: 'sleep' })

      await handle1.start()
      await handle2.start()

      const stopPromise = manager._doStop()

      mockCp2.emit('close', 0, null)

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
      manager.register({ id: 'unreg-proc', command: 'echo' })

      await manager.get('unreg-proc')!.start()
      mockCp.emit('close', 0, null)

      manager.unregister('unreg-proc')
      expect(manager.get('unreg-proc')).toBeUndefined()
    })

    it('removes an idle process from registry', async () => {
      const { ProcessManager } = await loadModules()
      const manager = new ProcessManager()

      manager.register({ id: 'idle-unreg', command: 'echo' })
      manager.unregister('idle-unreg')

      expect(manager.get('idle-unreg')).toBeUndefined()
    })

    it('rejects unregistering a running process', async () => {
      const { crossPlatformSpawn, ProcessManager } = await loadModules()
      const mockCp = createMockChildProcess()
      crossPlatformSpawn.mockReturnValue(mockCp)

      const manager = new ProcessManager()
      manager.register({ id: 'running-unreg', command: 'sleep' })

      await manager.get('running-unreg')!.start()

      expect(() => manager.unregister('running-unreg')).toThrow(
        "Cannot unregister process 'running-unreg': process is currently running"
      )
    })
  })
})
