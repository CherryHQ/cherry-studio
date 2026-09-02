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
import { __resetInstalledUtilityProcessManifestForTesting, installUtilityProcessManifest } from '../installedManifest'
import { SERVICE_NAME_PREFIX } from '../protocol/constants'
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
import { createMemoryProcessAdapter, waitUntil } from './memoryProcessAdapter'

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

function createManager() {
  const states: EchoChildState[] = []
  const adapter = createMemoryProcessAdapter((child, _index, { serviceName }) => {
    const { options, state } = echoServeOptions((error) => child.triggerFatal(error), {
      id: serviceName.slice(SERVICE_NAME_PREFIX.length)
    })
    states.push(state)
    child.serve(options)
  })
  const manager = new UtilityProcessManager({
    adapter,
    logger: createRecordingLogger(),
    resolveEntry: (entry) => `/out/${entry}.js`,
    getTempDir: () => '/tmp/cherry-test'
  })
  return { manager, adapter, states }
}

function emitChildProcessGone(serviceName: string): void {
  for (const listener of electronMock.listeners.get('child-process-gone') ?? []) {
    listener({}, { type: 'Utility', reason: 'crashed', exitCode: 11, serviceName })
  }
}

beforeEach(() => {
  BaseService.resetInstances()
  __resetInstalledUtilityProcessManifestForTesting()
  installUtilityProcessManifest([echoDefinition, otherDefinition])
  electronMock.listeners.clear()
})

afterEach(() => {
  __resetInstalledUtilityProcessManifestForTesting()
})

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

  it('rejects definitions that are not the installed manifest objects', async () => {
    const { manager } = createManager()
    const lookalike = defineUtilityProcess<EchoContract>({
      id: ECHO_ID,
      entry: 'test-echo',
      cancellation: 'cooperative'
    })

    expect(() => manager.client(lookalike)).toThrow(/not an installed manifest definition/)
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
