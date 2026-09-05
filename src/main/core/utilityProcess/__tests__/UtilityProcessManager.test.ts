import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electronMock = vi.hoisted(() => {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>()
  return {
    listeners,
    app: {
      on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
        listeners.set(event, [...(listeners.get(event) ?? []), listener])
      }),
      off: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
        listeners.set(
          event,
          (listeners.get(event) ?? []).filter((candidate) => candidate !== listener)
        )
      }),
      getPath: vi.fn(() => '/mock/path'),
      isPackaged: false,
      setAppLogsPath: vi.fn()
    },
    ipcMain: { handle: vi.fn(), on: vi.fn(), removeHandler: vi.fn(), removeListener: vi.fn() },
    utilityProcess: { fork: vi.fn() },
    MessageChannelMain: vi.fn()
  }
})

vi.mock('electron', () => electronMock)

import { BaseService } from '@main/core/lifecycle'

import { defineUtilityProcess } from '../defineUtilityProcess'
import { SERVICE_NAME_PREFIX, STOP_TOTAL_MS } from '../protocol/constants'
import type { ServeUtilityProcessOptions } from '../runtime/utilityProcessServer'
import { isUtilityProcessError } from '../UtilityProcessError'
import { UtilityProcessManager } from '../UtilityProcessManager'
import {
  createRecordingLogger,
  ECHO_ID,
  type EchoChildState,
  type EchoContract,
  echoServeOptions,
  rejectionOf
} from './hostTestUtils'
import { createMemoryProcessAdapter, flushMicrotasks, type MemoryChild, waitUntil } from './memoryProcessAdapter'

const echoDefinition = defineUtilityProcess<EchoContract>({
  id: ECHO_ID,
  entry: 'test-echo',
  cancellation: 'cooperative'
})
const otherDefinition = defineUtilityProcess<EchoContract>({
  id: 'test.other',
  entry: 'test-other',
  cancellation: 'cooperative'
})

function createManager(
  options: {
    serve?: Partial<ServeUtilityProcessOptions<EchoContract, unknown>>
    /** Replaces the echo runtime for the first spawn only. */
    firstSpawn?: (child: MemoryChild) => void
  } = {}
) {
  const states: EchoChildState[] = []
  const adapter = createMemoryProcessAdapter((child, index, { serviceName }) => {
    if (index === 0 && options.firstSpawn !== undefined) {
      options.firstSpawn(child)
      return
    }
    const { options: serve, state } = echoServeOptions((error) => child.triggerFatal(error), {
      id: serviceName.slice(SERVICE_NAME_PREFIX.length),
      ...options.serve
    })
    states.push(state)
    child.serve(serve)
  })
  const manager = new UtilityProcessManager({
    adapter,
    logger: createRecordingLogger(),
    resolveEntry: (entry) => `/out/${entry}.js`,
    getTempDir: () => '/tmp/cherry-test'
  })
  manager.register(echoDefinition)
  manager.register(otherDefinition)
  return { manager, adapter, states }
}

function emitChildProcessGone(serviceName: string): void {
  for (const listener of electronMock.listeners.get('child-process-gone') ?? []) {
    listener({}, { type: 'Utility', reason: 'crashed', exitCode: 11, serviceName })
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  BaseService.resetInstances()
  electronMock.listeners.clear()
})

afterEach(() => vi.useRealTimers())

describe('UtilityProcessManager', () => {
  it('returns one cached client per definition without spawning', async () => {
    const { manager, adapter } = createManager()
    await manager._doInit()

    const first = manager.client(echoDefinition)
    const second = manager.client(echoDefinition)

    expect(second).toBe(first)
    expect(manager.client(otherDefinition)).not.toBe(first)
    expect(adapter.spawns).toHaveLength(0)
    await manager._doStop()
  })

  it('rejects a definition object that was not registered', async () => {
    const { manager } = createManager()
    const lookalike = defineUtilityProcess<EchoContract>({
      id: ECHO_ID,
      entry: 'test-echo',
      cancellation: 'cooperative'
    })

    expect(() => manager.client(lookalike)).toThrow(/not registered/)
  })

  it('register() is idempotent for the same object and refuses a different object with the same id', () => {
    const { manager } = createManager()
    const lookalike = defineUtilityProcess<EchoContract>({
      id: ECHO_ID,
      entry: 'test-echo',
      cancellation: 'cooperative'
    })

    expect(() => manager.register(echoDefinition)).not.toThrow()
    expect(() => manager.register(lookalike)).toThrow(/already registered/)
    expect(() => manager.register({ ...echoDefinition, id: 'test.bad', cancellation: 'nope' } as never)).toThrow(
      TypeError
    )
    expect(manager.client(echoDefinition)).toBe(manager.client(echoDefinition))
  })

  it('routes requests through the client to the child and stops it on demand', async () => {
    const { manager, adapter } = createManager()
    await manager._doInit()
    const client = manager.client(echoDefinition)

    await expect(client.request('ping', undefined)).resolves.toBe('pong')
    await client.stop()

    expect(adapter.spawns).toHaveLength(1)
    expect(adapter.spawns[0].child.exitCode).toBe(0)
    await manager._doStop()
  })

  it('stops every live process on onStop and blocks later requests', async () => {
    const { manager, adapter } = createManager()
    await manager._doInit()
    await manager.client(echoDefinition).request('ping', undefined)
    await manager.client(otherDefinition).request('ping', undefined)

    await manager._doStop()

    expect(adapter.spawns.map((spawn) => spawn.child.exitCode)).toEqual([0, 0])
    const error = await rejectionOf(manager.client(echoDefinition).request('ping', undefined))
    expect(isUtilityProcessError(error, 'PROCESS_BLOCKED')).toBe(true)
    await expect(manager.client(echoDefinition).stop()).resolves.toBeUndefined()
    expect(adapter.spawns).toHaveLength(2)
  })

  it('treats child-process-gone as diagnostics only, before and after the exit', async () => {
    const { manager, adapter, states } = createManager()
    await manager._doInit()
    const client = manager.client(echoDefinition)
    const serviceName = `${SERVICE_NAME_PREFIX}${ECHO_ID}`

    const pending = client.request('wait', undefined)
    await waitUntil(() => states[0]?.waitSignals.length === 1, 'handler started')
    emitChildProcessGone(serviceName)
    states[0].release()
    await expect(pending).resolves.toBe('released')

    await client.stop()
    emitChildProcessGone(serviceName)
    await expect(client.request('ping', undefined)).resolves.toBe('pong')
    expect(adapter.spawns).toHaveLength(2)
    await manager._doStop()
    expect(electronMock.listeners.get('child-process-gone') ?? []).toHaveLength(0)
  })

  it('stop() and withStopped() issued during onStop resolve only after the child has exited', async () => {
    const { manager, adapter } = createManager({
      serve: { dispose: () => new Promise((resolve) => setTimeout(resolve, 100)) }
    })
    await manager._doInit()
    const client = manager.client(echoDefinition)
    await client.request('ping', undefined)
    const child = adapter.spawns[0].child

    const stopping = manager._doStop()
    await flushMicrotasks()
    expect(child.exited).toBe(false)
    const stopSaw = client.stop().then(() => child.exited)
    const gateSaw = client.withStopped(() => child.exited)

    await vi.advanceTimersByTimeAsync(100)
    await stopping
    expect(await stopSaw).toBe(true)
    expect(await gateSaw).toBe(true)
  })

  it('keeps a child that outlives onStop blocked through a restart until it exits, then spawns one replacement', async () => {
    const { manager, adapter } = createManager({
      firstSpawn: (child) => {
        child.onKill(() => {})
        child.onFrame(() => {})
        void child.awaitConnect().then(() => child.reply({ kind: 'ready' }))
      }
    })
    await manager._doInit()
    const client = manager.client(echoDefinition)
    const orphan = rejectionOf(client.request('wait', undefined))
    await waitUntil(() => adapter.spawns[0]?.child.frames.some((frame) => frame.kind === 'request'), 'request sent')
    const stuck = adapter.spawns[0].child

    const stopping = manager._doStop()
    await vi.advanceTimersByTimeAsync(STOP_TOTAL_MS)
    await stopping
    expect(isUtilityProcessError(await orphan, 'PROCESS_STOP_FAILED')).toBe(true)
    await manager._doInit()

    const blocked = await rejectionOf(client.request('ping', undefined))
    expect(isUtilityProcessError(blocked, 'PROCESS_BLOCKED')).toBe(true)
    expect(adapter.spawns).toHaveLength(1)

    stuck.exit(137)
    await flushMicrotasks()
    await expect(client.request('ping', undefined)).resolves.toBe('pong')
    expect(adapter.spawns).toHaveLength(2)
    await manager._doStop()
  })

  it('gates requests behind withStopped even when nothing has spawned yet', async () => {
    const { manager, adapter } = createManager()
    await manager._doInit()
    const client = manager.client(echoDefinition)
    let blockedCode: string | undefined

    await client.withStopped(async () => {
      const error = await rejectionOf(client.request('ping', undefined))
      blockedCode = isUtilityProcessError(error) ? error.code : undefined
    })

    expect(blockedCode).toBe('PROCESS_BLOCKED')
    expect(adapter.spawns).toHaveLength(0)
    await manager._doStop()
  })
})
