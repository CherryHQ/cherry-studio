import { EventEmitter } from 'node:events'

import type { SpawnedProcess, SpawnOptions } from '@anthropic-ai/claude-agent-sdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  BaseService,
  DependsOn,
  Injectable,
  LifecycleManager,
  Phase,
  ServiceContainer,
  ServicePhase
} from '@main/core/lifecycle'

import { ClaudeCodeProcessManager, type SpawnProcess } from '../ClaudeCodeProcessManager'

/** The production class takes no constructor args (container contract); tests swap the seam here. */
class TestProcessManager extends ClaudeCodeProcessManager {
  constructor(spawnProcess: SpawnProcess) {
    super()
    this.spawnProcess = spawnProcess
  }
}

function createFakeChild(options: { pid?: number } = {}) {
  const emitter = new EventEmitter()
  const pid = 'pid' in options ? options.pid : 123
  let killed = false
  let exitCode: number | null = null
  let signalCode: NodeJS.Signals | null = null
  const kill = vi.fn(() => {
    killed = true
    return true
  })
  const process = {
    pid,
    stdin: {},
    stdout: {},
    get killed() {
      return killed
    },
    get exitCode() {
      return exitCode
    },
    get signalCode() {
      return signalCode
    },
    kill,
    on: emitter.on.bind(emitter),
    once: emitter.once.bind(emitter),
    off: emitter.off.bind(emitter)
  } as unknown as SpawnedProcess

  return {
    process,
    kill,
    setExited(code: number | null, signal: NodeJS.Signals | null) {
      exitCode = code
      signalCode = signal
    },
    emitExit(code: number | null = 0, signal: NodeJS.Signals | null = null, updateStatus = true) {
      if (updateStatus) {
        exitCode = code
        signalCode = signal
      }
      emitter.emit('exit', code, signal)
    },
    emitError(error: Error = new Error('spawn failed')) {
      emitter.emit('error', error)
    }
  }
}

const spawnOptions: SpawnOptions = {
  command: '/opt/claude',
  args: [],
  env: {},
  signal: new AbortController().signal
}

describe('ClaudeCodeProcessManager', () => {
  beforeEach(() => {
    LifecycleManager.reset()
    ServiceContainer.reset()
    BaseService.resetInstances()
  })

  it('sweeps only after every service that spawns through it has stopped', async () => {
    const stopped: string[] = []

    @Injectable('SpawningConsumerService')
    @ServicePhase(Phase.WhenReady)
    @DependsOn(['ClaudeCodeProcessManager'])
    class SpawningConsumerService extends BaseService {
      protected override onStop(): void {
        stopped.push('consumer')
      }
    }

    const container = ServiceContainer.getInstance()
    // Registered after the consumer on purpose: the sweep must follow @DependsOn, not registry order.
    container.register(SpawningConsumerService)
    container.register(ClaudeCodeProcessManager)

    await LifecycleManager.getInstance().startPhase(Phase.WhenReady)
    const killAll = vi
      .spyOn(container.get(ClaudeCodeProcessManager), 'killAll')
      .mockImplementation(() => void stopped.push('sweep'))

    await LifecycleManager.getInstance().stopAll()

    expect(killAll).toHaveBeenCalledExactlyOnceWith('SIGTERM')
    expect(stopped).toEqual(['consumer', 'sweep'])
  })

  it('maps SDK spawn options to Node spawn and stops tracking the child after exit', () => {
    const child = createFakeChild()
    const spawnProcess = vi.fn(() => child.process)
    const manager = new TestProcessManager(spawnProcess)
    const controller = new AbortController()
    const options: SpawnOptions = {
      command: '/opt/claude',
      args: ['--output-format', 'stream-json'],
      cwd: '/workspace',
      env: { ANTHROPIC_API_KEY: 'test-key' },
      signal: controller.signal
    }

    expect(manager.spawn(options)).toBe(child.process)
    expect(spawnProcess).toHaveBeenCalledWith('/opt/claude', ['--output-format', 'stream-json'], {
      cwd: '/workspace',
      env: { ANTHROPIC_API_KEY: 'test-key' },
      signal: controller.signal,
      stdio: ['pipe', 'pipe', 'ignore'],
      windowsHide: true
    })

    // The exit event is authoritative even for a custom SpawnedProcess whose status fields lag.
    child.emitExit(0, null, false)
    manager.killAll('SIGTERM')
    expect(child.kill).not.toHaveBeenCalled()
  })

  it('stops tracking a child whose spawn fails before receiving a pid', () => {
    const child = createFakeChild({ pid: undefined })
    const manager = new TestProcessManager(vi.fn(() => child.process))
    manager.spawn({ ...spawnOptions, command: '/missing/claude' })

    expect(() => child.emitError()).not.toThrow()
    manager.killAll('SIGTERM')
    expect(child.kill).not.toHaveBeenCalled()
  })

  it('signals only tracked children that are still live', () => {
    const live = createFakeChild()
    const alreadyExited = createFakeChild()
    const spawnProcess = vi.fn().mockReturnValueOnce(live.process).mockReturnValueOnce(alreadyExited.process)
    const manager = new TestProcessManager(spawnProcess)
    manager.spawn(spawnOptions)
    manager.spawn(spawnOptions)

    // Status fields report the exit, but no 'exit' event arrived to untrack the handle.
    alreadyExited.setExited(null, 'SIGTERM')

    manager.killAll('SIGTERM')
    expect(live.kill).toHaveBeenCalledExactlyOnceWith('SIGTERM')
    expect(alreadyExited.kill).not.toHaveBeenCalled()
  })

  it('sweeps live children on service stop', async () => {
    const child = createFakeChild()
    const manager = new TestProcessManager(vi.fn(() => child.process))
    manager.spawn(spawnOptions)

    await expect(manager._doStop()).resolves.toBeUndefined()
    expect(child.kill).toHaveBeenCalledExactlyOnceWith('SIGTERM')
  })

  it('absorbs child kill failures', () => {
    const child = createFakeChild()
    child.kill.mockImplementation(() => {
      throw new Error('kill failed')
    })
    const manager = new TestProcessManager(vi.fn(() => child.process))
    manager.spawn(spawnOptions)

    expect(() => manager.killAll('SIGTERM')).not.toThrow()
    expect(child.kill).toHaveBeenCalledExactlyOnceWith('SIGTERM')
  })
})
