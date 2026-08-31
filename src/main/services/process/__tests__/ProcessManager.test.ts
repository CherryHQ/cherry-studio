import { EventEmitter } from 'events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

async function loadModules() {
  const { crossPlatformSpawn } = await import('@main/utils/processRunner')
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

    it('awaits processes that were already stopping when shutdown began', async () => {
      const { crossPlatformSpawn, ProcessManager } = await loadModules()
      const mockCp = createMockChildProcess(1111)
      crossPlatformSpawn.mockReturnValue(mockCp)

      const manager = new ProcessManager()
      const handle = manager.register({ id: 'stopping-proc', command: 'sleep' })
      await handle.start()

      const handleStop = handle.stop()
      const managerStop = manager._doStop()
      mockCp.emit('close', 0, null)

      await expect(Promise.all([handleStop, managerStop])).resolves.toEqual([undefined, undefined])
      expect(mockCp.kill).toHaveBeenCalledTimes(1)
    })

    it('joins processes that are still starting when shutdown begins', async () => {
      const { crossPlatformSpawn, ProcessManager } = await loadModules()
      const mockCp = createMockChildProcess(1111, false)
      crossPlatformSpawn.mockReturnValue(mockCp)

      const manager = new ProcessManager()
      const handle = manager.register({ id: 'starting-proc', command: 'sleep' })
      const handleStart = handle.start()
      await vi.waitFor(() => expect(crossPlatformSpawn).toHaveBeenCalledOnce())

      const managerStop = manager._doStop()
      mockCp.emit('spawn')
      await handleStart
      await vi.waitFor(() => expect(mockCp.kill).toHaveBeenCalledWith('SIGTERM'))
      mockCp.emit('close', 0, null)

      await expect(managerStop).resolves.toBeUndefined()
      expect(handle.state).toBe('stopped')
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

    it('rejects new registrations and starts after shutdown begins', async () => {
      const { crossPlatformSpawn, ProcessManager } = await loadModules()
      const manager = new ProcessManager()
      const idleHandle = manager.register({ id: 'idle-before-shutdown', command: 'sleep' })

      await manager._doStop()

      expect(() => manager.register({ id: 'registered-after-shutdown', command: 'sleep' })).toThrow(
        'ProcessManager is not accepting new processes'
      )
      await expect(idleHandle.start()).rejects.toThrow('Process idle-before-shutdown cannot start during shutdown')
      expect(crossPlatformSpawn).not.toHaveBeenCalled()
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

      await manager.unregister('unreg-proc')
      expect(manager.get('unreg-proc')).toBeUndefined()
    })

    it('removes an idle process from registry', async () => {
      const { ProcessManager } = await loadModules()
      const manager = new ProcessManager()

      manager.register({ id: 'idle-unreg', command: 'echo' })
      await manager.unregister('idle-unreg')

      expect(manager.get('idle-unreg')).toBeUndefined()
    })

    it('rejects unregistering a running process', async () => {
      const { crossPlatformSpawn, ProcessManager } = await loadModules()
      const mockCp = createMockChildProcess()
      crossPlatformSpawn.mockReturnValue(mockCp)

      const manager = new ProcessManager()
      manager.register({ id: 'running-unreg', command: 'sleep' })

      await manager.get('running-unreg')!.start()

      await expect(manager.unregister('running-unreg')).rejects.toThrow(
        "Cannot unregister process 'running-unreg': process is currently active (running)"
      )
    })

    it('rejects unregistering a process that is still stopping', async () => {
      const { crossPlatformSpawn, ProcessManager } = await loadModules()
      const mockCp = createMockChildProcess()
      crossPlatformSpawn.mockReturnValue(mockCp)

      const manager = new ProcessManager()
      const handle = manager.register({ id: 'stopping-unreg', command: 'sleep' })
      await handle.start()
      void handle.stop()

      await expect(manager.unregister('stopping-unreg')).rejects.toThrow(
        "Cannot unregister process 'stopping-unreg': process is currently active (stopping)"
      )

      mockCp.emit('close', 0, null)
    })

    it('joins an in-flight start before deciding whether the handle can be removed', async () => {
      const { crossPlatformSpawn, ProcessManager } = await loadModules()
      const mockCp = createMockChildProcess(1234, false)
      crossPlatformSpawn.mockReturnValue(mockCp)

      const manager = new ProcessManager()
      const handle = manager.register({ id: 'starting-unreg', command: 'sleep' })
      const startPromise = handle.start()
      await vi.waitFor(() => expect(crossPlatformSpawn).toHaveBeenCalledOnce())

      const unregisterPromise = manager.unregister('starting-unreg')
      expect(manager.get('starting-unreg')).toBe(handle)

      mockCp.emit('spawn')
      await startPromise
      await expect(unregisterPromise).rejects.toThrow(
        "Cannot unregister process 'starting-unreg': process is currently active (running)"
      )

      const stopPromise = handle.stop()
      mockCp.emit('close', 0, null)
      await stopPromise
    })
  })
})
