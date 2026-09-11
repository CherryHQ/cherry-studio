import { BaseService } from '@main/core/lifecycle'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { captured, mockTracerInit, mockTracerShutdown, MockCacheBatchSpanProcessor } = vi.hoisted(() => ({
  captured: {
    enabled: false,
    preferenceHandler: undefined as ((enabled: boolean) => void) | undefined,
    service: undefined as
      | {
          _doActivate(): Promise<boolean>
          _doDeactivate(): Promise<boolean>
          readonly isActivated: boolean
        }
      | undefined,
    storage: { isActivated: false },
    bridge: { isActivated: false },
    storageActivation: undefined as Promise<void> | undefined,
    transitions: [] as string[]
  },
  mockTracerInit: vi.fn(),
  mockTracerShutdown: vi.fn<() => Promise<void>>(() => Promise.resolve()),
  MockCacheBatchSpanProcessor: vi.fn((exporter: unknown, storage: unknown) => ({ exporter, storage }))
}))

vi.mock('@application', () => ({
  application: {
    get: vi.fn((name: string) => {
      if (name === 'PreferenceService') {
        return {
          get: vi.fn(() => captured.enabled),
          subscribeChange: vi.fn((_key: string, handler: (enabled: boolean) => void) => {
            captured.preferenceHandler = handler
            return () => {
              captured.preferenceHandler = undefined
            }
          })
        }
      }
      if (name === 'TraceStorageService') return captured.storage
      if (name === 'ClaudeCodeTraceBridgeService') return captured.bridge
      if (name === 'NodeTraceService') return captured.service
      throw new Error(`Unexpected service: ${name}`)
    }),
    activate: vi.fn(async (name: string) => {
      captured.transitions.push(`activate:${name}`)
      if (name === 'TraceStorageService') {
        await captured.storageActivation
        captured.storage.isActivated = true
        return
      }
      if (name === 'ClaudeCodeTraceBridgeService') {
        captured.bridge.isActivated = true
        return
      }
      await captured.service?._doActivate()
    }),
    deactivate: vi.fn(async (name: string) => {
      captured.transitions.push(`deactivate:${name}`)
      if (name === 'TraceStorageService') {
        captured.storage.isActivated = false
        return
      }
      if (name === 'ClaudeCodeTraceBridgeService') {
        captured.bridge.isActivated = false
        return
      }
      await captured.service?._doDeactivate()
    })
  },
  serviceList: []
}))

vi.mock('../FunctionSpanExporter', () => ({
  FunctionSpanExporter: vi.fn((callback: unknown) => ({ callback }))
}))

vi.mock('../CacheBatchSpanProcessor', () => ({
  CacheBatchSpanProcessor: MockCacheBatchSpanProcessor
}))

vi.mock('../NodeTracer', () => ({
  NodeTracer: {
    init: mockTracerInit,
    shutdown: mockTracerShutdown
  }
}))

import { NodeTraceService } from '../NodeTraceService'

type FlushableNodeTraceService = {
  reconciler: { flush(): Promise<void> }
}

function setDeveloperMode(enabled: boolean): void {
  captured.enabled = enabled
  captured.preferenceHandler?.(enabled)
}

async function flush(service: NodeTraceService): Promise<void> {
  await (service as unknown as FlushableNodeTraceService).reconciler.flush()
}

describe('NodeTraceService runtime preference', () => {
  beforeEach(() => {
    BaseService.resetInstances()
    captured.enabled = false
    captured.preferenceHandler = undefined
    captured.service = undefined
    captured.storage.isActivated = false
    captured.bridge.isActivated = false
    captured.storageActivation = undefined
    captured.transitions.length = 0
    mockTracerInit.mockReset()
    mockTracerShutdown.mockReset()
    mockTracerShutdown.mockResolvedValue()
    MockCacheBatchSpanProcessor.mockClear()
  })

  it('keeps tracing off until enabled and orders both runtime transitions safely', async () => {
    const service = new NodeTraceService()
    captured.service = service
    await service._doInit()

    expect(service.isActivated).toBe(false)
    expect(captured.storage.isActivated).toBe(false)
    expect(captured.bridge.isActivated).toBe(false)
    expect(mockTracerInit).not.toHaveBeenCalled()

    setDeveloperMode(true)
    await flush(service)

    expect(service.isActivated).toBe(true)
    expect(captured.storage.isActivated).toBe(true)
    expect(captured.bridge.isActivated).toBe(true)
    expect(captured.transitions).toEqual([
      'activate:TraceStorageService',
      'activate:NodeTraceService',
      'activate:ClaudeCodeTraceBridgeService'
    ])
    expect(mockTracerInit).toHaveBeenCalledTimes(1)

    setDeveloperMode(false)
    await flush(service)

    expect(service.isActivated).toBe(false)
    expect(captured.storage.isActivated).toBe(false)
    expect(captured.bridge.isActivated).toBe(false)
    expect(captured.transitions.slice(3)).toEqual([
      'deactivate:ClaudeCodeTraceBridgeService',
      'deactivate:NodeTraceService',
      'deactivate:TraceStorageService'
    ])
    expect(mockTracerShutdown).toHaveBeenCalledTimes(1)

    setDeveloperMode(true)
    await flush(service)

    expect(service.isActivated).toBe(true)
    expect(captured.storage.isActivated).toBe(true)
    expect(captured.bridge.isActivated).toBe(true)
    expect(mockTracerInit).toHaveBeenCalledTimes(2)
    expect(MockCacheBatchSpanProcessor).toHaveBeenCalledTimes(2)
    expect(MockCacheBatchSpanProcessor.mock.results[0].value).not.toBe(
      MockCacheBatchSpanProcessor.mock.results[1].value
    )
  })

  it('honours a re-enable that arrives while tracer shutdown is in flight', async () => {
    let releaseShutdown!: () => void
    mockTracerShutdown.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseShutdown = resolve
        })
    )

    captured.enabled = true
    const service = new NodeTraceService()
    captured.service = service
    await service._doInit()
    expect(service.isActivated).toBe(true)

    setDeveloperMode(false)
    await vi.waitFor(() => expect(mockTracerShutdown).toHaveBeenCalledTimes(1))

    setDeveloperMode(true)
    releaseShutdown()
    await flush(service)

    expect(service.isActivated).toBe(true)
    expect(captured.storage.isActivated).toBe(true)
    expect(captured.bridge.isActivated).toBe(true)
    expect(mockTracerInit).toHaveBeenCalledTimes(2)
    expect(captured.transitions).not.toContain('deactivate:TraceStorageService')
  })

  it('does not start the tracer when developer mode is disabled during storage activation', async () => {
    let releaseStorage!: () => void
    captured.storageActivation = new Promise<void>((resolve) => {
      releaseStorage = resolve
    })

    const service = new NodeTraceService()
    captured.service = service
    await service._doInit()

    setDeveloperMode(true)
    await vi.waitFor(() => expect(captured.transitions).toEqual(['activate:TraceStorageService']))
    setDeveloperMode(false)
    releaseStorage()
    await flush(service)

    expect(service.isActivated).toBe(false)
    expect(captured.storage.isActivated).toBe(false)
    expect(captured.bridge.isActivated).toBe(false)
    expect(mockTracerInit).not.toHaveBeenCalled()
    expect(captured.transitions).toEqual(['activate:TraceStorageService', 'deactivate:TraceStorageService'])
  })

  it('does not publish a tracer when shutdown overtakes dependency loading', async () => {
    const service = new NodeTraceService()
    captured.service = service
    await service._doInit()

    let markLoading!: () => void
    const loading = new Promise<void>((resolve) => {
      markLoading = resolve
    })
    let releaseDependencies!: () => void
    const dependenciesReleased = new Promise<void>((resolve) => {
      releaseDependencies = resolve
    })
    const originalLoader = (service as any).loadTracerDependencies.bind(service)
    ;(service as any).loadTracerDependencies = async () => {
      markLoading()
      await dependenciesReleased
      return originalLoader()
    }

    const activation = service._doActivate()
    await loading
    await service._doStop()
    releaseDependencies()

    await expect(activation).rejects.toThrow('activation was cancelled during shutdown')
    expect(service.isActivated).toBe(false)
    expect(mockTracerInit).not.toHaveBeenCalled()
  })

  it('finishes deactivation when flushing the old tracer fails', async () => {
    captured.enabled = true
    const service = new NodeTraceService()
    captured.service = service
    await service._doInit()
    expect(service.isActivated).toBe(true)

    mockTracerShutdown.mockRejectedValueOnce(new Error('flush failed'))
    setDeveloperMode(false)
    await flush(service)

    expect(service.isActivated).toBe(false)
    expect(captured.storage.isActivated).toBe(false)
  })
})
