import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electronMock = vi.hoisted(() => ({
  app: { on: vi.fn(), off: vi.fn(), getPath: vi.fn(() => '/mock/path'), isPackaged: false, setAppLogsPath: vi.fn() },
  ipcMain: { handle: vi.fn(), on: vi.fn(), removeHandler: vi.fn(), removeListener: vi.fn() },
  utilityProcess: { fork: vi.fn() },
  MessageChannelMain: vi.fn()
}))
vi.mock('electron', () => electronMock)

const utilityProcessManager = vi.hoisted(() => ({ current: null as unknown }))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const result = mockApplicationFactory()
  const originalGet = result.application.get.getMockImplementation()!
  result.application.get.mockImplementation((name: string) => {
    if (name === 'UtilityProcessManager') return utilityProcessManager.current
    return originalGet(name)
  })
  return result
})

// Pin to a supported platform so this suite is deterministic regardless of the machine it
// runs on (see InferenceServiceBase.darwinX64.test.ts for the gate itself).
vi.mock('@main/core/platform', () => ({ isDarwinX64: false }))

import { BaseService } from '@main/core/lifecycle'
import { getDependencies } from '@main/core/lifecycle/decorators'
import {
  createRecordingLogger,
  type EchoChildState,
  type EchoContract,
  echoDefinition,
  echoServeOptions,
  rejectionOf
} from '@main/core/utilityProcess/__tests__/hostTestUtils'
import {
  createMemoryProcessAdapter,
  flushMicrotasks,
  waitUntil
} from '@main/core/utilityProcess/__tests__/memoryProcessAdapter'
import { SERVICE_NAME_PREFIX } from '@main/core/utilityProcess/protocol/constants'
import type { UtilityProcessHandlers } from '@main/core/utilityProcess/runtime/serveUtilityProcess'
import type { UtilityProcessDefinition } from '@main/core/utilityProcess/types'
import { UtilityProcessManager } from '@main/core/utilityProcess/UtilityProcessManager'

import { embeddingInferenceProcess, ocrInferenceProcess } from '../inferenceProcess'
import { InferenceServiceBase } from '../InferenceServiceBase'
import type { InferenceInitData } from '../protocol'

/**
 * The base owns three things after the process machinery moved into `core/utilityProcess`:
 * one-at-a-time dispatch, relaunching when the hardware profile the live process was
 * launched with no longer applies, and keeping the caller's error the
 * child's error. Everything else — generations, idle release, the stop barrier — is
 * ProcessHost's, and is tested there.
 *
 * A stand-in contract keeps this about the base: the real embedding/OCR entries would drag
 * transformers and onnxruntime in for no added coverage.
 */

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

async function createService(handlers: Partial<UtilityProcessHandlers<EchoContract>> = {}): Promise<{
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
    child.serve<EchoContract, unknown>({ ...options, handlers: { ...options.handlers, ...handlers } })
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
  initDataSeen.length = 0
  definition = echoDefinition({
    createInitData: () => ({ appPath: '/app' })
  }) as UtilityProcessDefinition<EchoContract, InferenceInitData>
})

afterEach(() => {
  utilityProcessManager.current = null
})

describe('InferenceServiceBase lifecycle', () => {
  it('declares UtilityProcessManager as a dependency so onInit registers against an initialized manager', () => {
    expect(getDependencies(TestInferenceService)).toContain('UtilityProcessManager')
  })
})

describe('InferenceServiceBase dispatch', () => {
  it('never has two requests in flight at the child at once', async () => {
    const { service, adapter } = await createService()

    const first = service.block()
    const second = service.ping()
    await waitUntil(() => childStates[0]?.waitSignals.length === 1, 'first request in flight')

    // The queued ping must not reach the child while `wait` is still blocking it.
    await flushMicrotasks()
    expect(
      adapter.spawns[0].child.frames.filter((frame) => frame.kind === 'request').map((frame) => frame.method)
    ).toEqual(['wait'])

    childStates[0].release()
    await expect(first).resolves.toBe('released')
    await expect(second).resolves.toBe('pong')
  })

  it.each([embeddingInferenceProcess, ocrInferenceProcess])(
    '$id cancellation waits for exit before dispatching the next native operation',
    async (processDefinition) => {
      definition = { ...definition, cancellation: processDefinition.cancellation }
      const work = Promise.withResolvers<string>()
      const started: string[] = []
      const { service, adapter } = await createService({
        wait: () => {
          started.push('A')
          return work.promise
        },
        ping: () => {
          started.push('B')
          return 'pong'
        }
      })
      const controller = new AbortController()
      const reason = new Error('cancel native operation')
      let firstSettled = false
      const first = rejectionOf(service.block(controller.signal)).then((error) => {
        firstSettled = true
        return error
      })

      try {
        await waitUntil(() => started.length === 1, 'native operation A started')
        const oldChild = adapter.spawns[0].child
        oldChild.onKill(() => {})
        controller.abort(reason)
        const second = service.ping().catch((error: unknown) => error)
        await flushMicrotasks()

        expect(started).toEqual(['A'])
        expect(firstSettled).toBe(false)
        expect(oldChild.killed).toBe(true)
        expect(oldChild.exited).toBe(false)
        expect(adapter.spawns).toHaveLength(1)

        oldChild.exit(143)
        expect(await first).toBe(reason)
        await expect(second).resolves.toBe('pong')
        expect(started).toEqual(['A', 'B'])
        expect(adapter.spawns).toHaveLength(2)
      } finally {
        work.resolve('released')
        for (const { child } of adapter.spawns) child.exit(0)
        await service.terminate()
      }
    }
  )

  it.each([embeddingInferenceProcess, ocrInferenceProcess])(
    '$id skips a cancelled queued request without killing the active process',
    async (processDefinition) => {
      definition = { ...definition, cancellation: processDefinition.cancellation }
      const { service, adapter } = await createService()
      const controller = new AbortController()
      const reason = new Error('caller gave up')

      const blocking = service.block()
      await waitUntil(() => childStates[0]?.waitSignals.length === 1, 'first request in flight')
      const queued = rejectionOf(service.ping(controller.signal))
      controller.abort(reason)
      await flushMicrotasks()
      expect(adapter.spawns[0].child.killed).toBe(false)
      childStates[0].release()

      await expect(blocking).resolves.toBe('released')
      expect(await queued).toBe(reason)
      expect(adapter.spawns[0].child.killed).toBe(false)
      expect(adapter.spawns).toHaveLength(1)
      expect(
        adapter.spawns[0].child.frames.filter((frame) => frame.kind === 'request').map((frame) => frame.method)
      ).toEqual(['wait'])
      await service.terminate()
    }
  )

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
  it('reuses the running process while the resolved profile is unchanged', async () => {
    const { service, adapter } = await createService()

    await service.ping()
    await service.ping()

    expect(adapter.spawns).toHaveLength(1)
  })

  it('relaunches when the hardware acceleration preference changes the resolved profile', async () => {
    const profiles = await import('../inferenceAcceleration')
    const hardwareProfile = profiles.resolveLocalInferenceProfile(true, { platform: 'darwin', arch: 'arm64' })
    const resolveProfile = vi
      .spyOn(profiles, 'resolveLocalInferenceProfile')
      .mockImplementation((enabled) => (enabled ? hardwareProfile : profiles.CPU_LOCAL_INFERENCE_PROFILE))
    const { service, adapter } = await createService()

    try {
      await service.ping()
      MockMainPreferenceServiceUtils.setPreferenceValue(HARDWARE_KEY, true)
      await service.ping()

      expect(adapter.spawns).toHaveLength(2)
    } finally {
      resolveProfile.mockRestore()
      await service.terminate()
    }
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
