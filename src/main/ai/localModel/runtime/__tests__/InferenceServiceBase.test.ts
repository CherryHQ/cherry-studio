import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electronMock = vi.hoisted(() => ({
  app: { on: vi.fn(), off: vi.fn(), getPath: vi.fn(() => '/mock/path'), isPackaged: false, setAppLogsPath: vi.fn() },
  ipcMain: { handle: vi.fn(), on: vi.fn(), removeHandler: vi.fn(), removeListener: vi.fn() },
  utilityProcess: { fork: vi.fn() },
  MessageChannelMain: vi.fn()
}))
vi.mock('electron', () => electronMock)

const getRoutingSnapshot = vi.hoisted(() => vi.fn())
const utilityProcessManager = vi.hoisted(() => ({ current: null as unknown }))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const result = mockApplicationFactory()
  const originalGet = result.application.get.getMockImplementation()!
  result.application.get.mockImplementation((name: string) => {
    if (name === 'ProxyService') return { getRoutingSnapshot }
    if (name === 'UtilityProcessManager') return utilityProcessManager.current
    return originalGet(name)
  })
  return result
})

// Pin to a supported platform so this suite is deterministic regardless of the machine it
// runs on (see InferenceServiceBase.darwinX64.test.ts for the gate itself).
vi.mock('@main/core/platform', () => ({ isDarwinX64: false }))

import { BaseService } from '@main/core/lifecycle'
import {
  createRecordingLogger,
  type EchoChildState,
  type EchoContract,
  echoDefinition,
  echoServeOptions,
  rejectionOf
} from '@main/core/utilityProcess/__tests__/hostTestUtils'
import { createMemoryProcessAdapter, waitUntil } from '@main/core/utilityProcess/__tests__/memoryProcessAdapter'
import {
  __resetInstalledUtilityProcessManifestForTesting,
  installUtilityProcessManifest
} from '@main/core/utilityProcess/installedManifest'
import { SERVICE_NAME_PREFIX } from '@main/core/utilityProcess/protocol/constants'
import type { UtilityProcessDefinition } from '@main/core/utilityProcess/types'
import { UtilityProcessManager } from '@main/core/utilityProcess/UtilityProcessManager'
import type { ProxyRoutingSnapshot } from '@main/services/proxy/proxyRouting'

import { InferenceServiceBase } from '../InferenceServiceBase'
import type { InferenceInitData } from '../protocol'

/**
 * The base owns three things after the process machinery moved into `core/utilityProcess`:
 * one-at-a-time dispatch, relaunching when the proxy routing or the hardware profile the
 * live process was launched with no longer applies, and keeping the caller's error the
 * child's error. Everything else — generations, idle release, the stop barrier — is
 * ProcessHost's, and is tested there.
 *
 * A stand-in contract keeps this about the base: the real embedding/OCR entries would drag
 * transformers and onnxruntime in for no added coverage.
 */

const DIRECT_ROUTING: ProxyRoutingSnapshot = { version: 1, mode: 'direct' }
const HARDWARE_KEY = 'feature.local_model.hardware_acceleration.enabled'

const initDataSeen: unknown[] = []
let childStates: EchoChildState[]
let definition: UtilityProcessDefinition<EchoContract, InferenceInitData>

class TestInferenceService extends InferenceServiceBase<EchoContract> {
  constructor() {
    super(definition, 'embedding')
  }

  ping(signal?: AbortSignal) {
    return this.run('ping', undefined, { signal })
  }

  block(signal?: AbortSignal) {
    return this.run('wait', undefined, { signal })
  }

  boom() {
    return this.run('fail', undefined)
  }

  nothing() {
    return this.run('noop', undefined)
  }
}

async function createService(): Promise<{
  service: TestInferenceService
  adapter: ReturnType<typeof createMemoryProcessAdapter>
}> {
  childStates = []
  const adapter = createMemoryProcessAdapter((child, _index, { serviceName }) => {
    const { options, state } = echoServeOptions((error) => child.triggerFatal(error), {
      id: serviceName.slice(SERVICE_NAME_PREFIX.length),
      initialize: (initData) => {
        initDataSeen.push(initData)
      }
    })
    childStates.push(state)
    child.serve(options)
  })
  const manager = new UtilityProcessManager({
    adapter,
    logger: createRecordingLogger(),
    resolveEntry: (entry) => `/out/${entry}.js`,
    getTempDir: () => '/tmp/cherry-test'
  })
  await manager._doInit()
  utilityProcessManager.current = manager
  const service = new TestInferenceService()
  await service._doInit()
  return { service, adapter }
}

beforeEach(() => {
  BaseService.resetInstances()
  MockMainPreferenceServiceUtils.resetMocks()
  MockMainPreferenceServiceUtils.setPreferenceValue(HARDWARE_KEY, false)
  getRoutingSnapshot.mockResolvedValue(DIRECT_ROUTING)
  initDataSeen.length = 0
  __resetInstalledUtilityProcessManifestForTesting()
  definition = echoDefinition({
    createInitData: () => ({ appPath: '/app' }) as unknown as InferenceInitData
  }) as UtilityProcessDefinition<EchoContract, InferenceInitData>
  installUtilityProcessManifest([definition])
})

afterEach(() => {
  __resetInstalledUtilityProcessManifestForTesting()
  utilityProcessManager.current = null
})

describe('InferenceServiceBase dispatch', () => {
  it('never has two requests in flight at the child at once', async () => {
    const { service } = await createService()

    const first = service.block()
    const second = service.ping()
    await waitUntil(() => childStates[0]?.waitSignals.length === 1, 'first request in flight')

    // The queued ping must not reach the child while `wait` is still blocking it.
    await Promise.resolve()
    expect(childStates[0].waitSignals).toHaveLength(1)

    childStates[0].release()
    await expect(first).resolves.toBe('released')
    await expect(second).resolves.toBe('pong')
  })

  it('rejects a request whose signal aborted while it waited in the queue', async () => {
    const { service } = await createService()
    const controller = new AbortController()

    const blocking = service.block()
    await waitUntil(() => childStates[0]?.waitSignals.length === 1, 'first request in flight')
    const queued = rejectionOf(service.ping(controller.signal))
    controller.abort(new Error('caller gave up'))
    childStates[0].release()

    await expect(blocking).resolves.toBe('released')
    expect(await queued).toEqual(new Error('caller gave up'))
  })

  it('resolves a method whose output is void instead of reading it as a failure', async () => {
    const { service } = await createService()

    // `load` (the embedding download) returns void; a sentinel on the queue's own
    // `T | void` result type would reject every completed download.
    await expect(service.nothing()).resolves.toBeUndefined()
  })

  it('surfaces the error the child threw, not the transport wrapper around it', async () => {
    const { service } = await createService()

    const error = await rejectionOf(service.boom())

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('handler failed')
    expect(error).toHaveProperty('code', 'E_HANDLER')
  })
})

describe('InferenceServiceBase runtime staleness', () => {
  it('reuses the running process while the routing version and profile are unchanged', async () => {
    const { service, adapter } = await createService()

    await service.ping()
    await service.ping()

    expect(adapter.spawns).toHaveLength(1)
  })

  it('relaunches with a fresh snapshot when the proxy routing version advances', async () => {
    const { service, adapter } = await createService()
    await service.ping()

    getRoutingSnapshot.mockResolvedValue({ version: 2, mode: 'direct' } satisfies ProxyRoutingSnapshot)
    await service.ping()

    expect(adapter.spawns).toHaveLength(2)
    expect(initDataSeen).toHaveLength(2)
  })

  it('relaunches when the hardware acceleration preference changes the resolved profile', async () => {
    const { service, adapter } = await createService()
    await service.ping()

    MockMainPreferenceServiceUtils.setPreferenceValue(HARDWARE_KEY, true)
    await service.ping()

    // Only platforms with a hardware profile change id here; on the rest the profile stays
    // `cpu` and reusing the process is correct.
    const { resolveLocalInferenceProfile } = await import('../inferenceAcceleration')
    const expected = resolveLocalInferenceProfile(true).id === 'cpu' ? 1 : 2
    expect(adapter.spawns).toHaveLength(expected)
  })
})

describe('InferenceServiceBase teardown', () => {
  it('terminate() resolves only once the process has actually exited', async () => {
    const { service, adapter } = await createService()
    await service.ping()

    await service.terminate()

    expect(adapter.spawns[0].child.exited).toBe(true)
  })

  it('terminateThen runs `after` with the process down and no request able to relaunch it', async () => {
    const { service, adapter } = await createService()
    await service.ping()

    let spawnsDuringAfter = 0
    const blocked = rejectionOf(
      service.terminateThen(async () => {
        spawnsDuringAfter = adapter.spawns.filter((spawn) => !spawn.child.exited).length
        await service.ping()
      })
    )

    expect(await blocked).toHaveProperty('code', 'PROCESS_BLOCKED')
    expect(spawnsDuringAfter).toBe(0)
  })
})
