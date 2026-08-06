import { EventEmitter } from 'node:events'

import type { SpawnedProcess, SpawnOptions } from '@anthropic-ai/claude-agent-sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ClaudeCodeProcessManager } from '../ClaudeCodeProcessManager'

function createFakeChild(options: { pid?: number } = {}) {
  const emitter = new EventEmitter()
  const pid = 'pid' in options ? options.pid : 123
  let killed = false
  let exitCode: number | null = null
  let signalCode: NodeJS.Signals | null = null
  const kill = vi.fn((_signal: NodeJS.Signals) => {
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

describe('ClaudeCodeProcessManager', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('maps SDK spawn options to Node spawn and stops tracking the child after exit', async () => {
    vi.useFakeTimers()
    const child = createFakeChild()
    const spawnProcess = vi.fn(() => child.process)
    const manager = new ClaudeCodeProcessManager(spawnProcess)
    const controller = new AbortController()
    const options: SpawnOptions = {
      command: '/opt/claude',
      args: ['--output-format', 'stream-json'],
      cwd: '/workspace',
      env: { ANTHROPIC_API_KEY: 'test-key' },
      signal: controller.signal
    }

    expect(manager.spawnClaudeCodeProcess(options)).toBe(child.process)
    expect(spawnProcess).toHaveBeenCalledWith('/opt/claude', ['--output-format', 'stream-json'], {
      cwd: '/workspace',
      env: { ANTHROPIC_API_KEY: 'test-key' },
      signal: controller.signal,
      stdio: ['pipe', 'pipe', 'ignore'],
      windowsHide: true
    })

    // The exit event is authoritative even for a custom SpawnedProcess whose status fields lag.
    child.emitExit(0, null, false)
    await expect(manager.shutdown(() => undefined)).resolves.toBeUndefined()
    expect(child.kill).not.toHaveBeenCalled()
  })

  it('stops tracking a child whose spawn fails before receiving a pid', async () => {
    vi.useFakeTimers()
    const child = createFakeChild({ pid: undefined })
    const manager = new ClaudeCodeProcessManager(vi.fn(() => child.process))
    manager.spawnClaudeCodeProcess({
      command: '/missing/claude',
      args: [],
      env: {},
      signal: new AbortController().signal
    })

    expect(() => child.emitError()).not.toThrow()
    await expect(manager.shutdown(() => undefined)).resolves.toBeUndefined()
    expect(child.kill).not.toHaveBeenCalled()
  })

  it('escalates only tracked live children and reuses one signal chain across repeated shutdowns', async () => {
    vi.useFakeTimers()
    const gracefulExit = createFakeChild()
    const termExit = createFakeChild()
    const stubborn = createFakeChild()
    const spawnProcess = vi
      .fn()
      .mockReturnValueOnce(gracefulExit.process)
      .mockReturnValueOnce(termExit.process)
      .mockReturnValueOnce(stubborn.process)
    const manager = new ClaudeCodeProcessManager(spawnProcess)
    const options = {
      command: '/opt/claude',
      args: [],
      env: {},
      signal: new AbortController().signal
    }
    manager.spawnClaudeCodeProcess(options)
    manager.spawnClaudeCodeProcess(options)
    manager.spawnClaudeCodeProcess(options)

    const firstClose = vi.fn()
    const shutdown = manager.shutdown(firstClose)
    await vi.advanceTimersByTimeAsync(1_999)
    expect(gracefulExit.kill).not.toHaveBeenCalled()
    expect(termExit.kill).not.toHaveBeenCalled()
    expect(stubborn.kill).not.toHaveBeenCalled()

    gracefulExit.emitExit(0, null, false)
    await vi.advanceTimersByTimeAsync(1)
    expect(gracefulExit.kill).not.toHaveBeenCalled()
    expect(termExit.kill).toHaveBeenCalledExactlyOnceWith('SIGTERM')
    expect(stubborn.kill).toHaveBeenCalledExactlyOnceWith('SIGTERM')

    termExit.emitExit(null, 'SIGTERM', false)
    await vi.advanceTimersByTimeAsync(999)
    expect(stubborn.kill).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    await expect(shutdown).resolves.toBeUndefined()
    expect(termExit.kill).toHaveBeenCalledTimes(1)
    expect(stubborn.kill).toHaveBeenNthCalledWith(2, 'SIGKILL')

    const secondClose = vi.fn()
    await expect(manager.shutdown(secondClose)).resolves.toBeUndefined()
    await vi.runAllTimersAsync()
    expect(firstClose).toHaveBeenCalledOnce()
    expect(secondClose).toHaveBeenCalledOnce()
    expect(termExit.kill).toHaveBeenCalledTimes(1)
    expect(stubborn.kill).toHaveBeenCalledTimes(2)
  })

  it('absorbs synchronous and asynchronous graceful close failures', async () => {
    vi.useFakeTimers()
    const throwingManager = new ClaudeCodeProcessManager(vi.fn())
    const rejectingManager = new ClaudeCodeProcessManager(vi.fn())

    await expect(
      throwingManager.shutdown(() => {
        throw new Error('close failed')
      })
    ).resolves.toBeUndefined()
    await expect(rejectingManager.shutdown(() => Promise.reject(new Error('close failed')))).resolves.toBeUndefined()
  })

  it('bounds a hanging graceful close and absorbs child kill failures', async () => {
    vi.useFakeTimers()
    const child = createFakeChild()
    child.kill.mockImplementation(() => {
      throw new Error('kill failed')
    })
    const manager = new ClaudeCodeProcessManager(vi.fn(() => child.process))
    manager.spawnClaudeCodeProcess({
      command: '/opt/claude',
      args: [],
      env: {},
      signal: new AbortController().signal
    })

    const shutdown = manager.shutdown(() => new Promise<void>(() => {}))
    await vi.advanceTimersByTimeAsync(3_000)

    await expect(shutdown).resolves.toBeUndefined()
    expect(child.kill).toHaveBeenNthCalledWith(1, 'SIGTERM')
    expect(child.kill).toHaveBeenNthCalledWith(2, 'SIGKILL')
  })
})
