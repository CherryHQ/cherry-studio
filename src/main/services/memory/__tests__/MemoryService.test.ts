/**
 * Unit tests for MemoryService — tests provider switching, IPC wiring,
 * and graceful fallback to NullProvider on activation failure.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    })
  }
}))

// Mock providers so we don't need DB or network
vi.mock('../providers/HindsightProvider', () => ({
  HindsightProvider: vi.fn().mockImplementation(() => ({
    id: 'hindsight',
    capabilities: {
      supportsReflect: true,
      supportsMentalModels: true,
      supportsBanks: true,
      serverSideExtraction: true
    },
    init: vi.fn().mockResolvedValue(undefined),
    add: vi.fn().mockResolvedValue([]),
    search: vi.fn().mockResolvedValue({ results: [] }),
    list: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockResolvedValue(null),
    update: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue(undefined),
    deleteAll: vi.fn().mockResolvedValue(undefined),
    listUsers: vi.fn().mockResolvedValue([]),
    healthCheck: vi.fn().mockResolvedValue(true),
    destroy: vi.fn().mockResolvedValue(undefined)
  }))
}))

vi.mock('../providers/LibSqlProvider', () => ({
  LibSqlProvider: vi.fn().mockImplementation(() => ({
    id: 'libsql',
    capabilities: {
      supportsReflect: false,
      supportsMentalModels: false,
      supportsBanks: false,
      serverSideExtraction: false
    },
    init: vi.fn().mockResolvedValue(undefined),
    add: vi.fn().mockResolvedValue([]),
    search: vi.fn().mockResolvedValue({ results: [] }),
    list: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockResolvedValue(null),
    update: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue(undefined),
    deleteAll: vi.fn().mockResolvedValue(undefined),
    listUsers: vi.fn().mockResolvedValue([]),
    healthCheck: vi.fn().mockResolvedValue(true),
    destroy: vi.fn().mockResolvedValue(undefined)
  }))
}))

import { BaseService } from '@main/core/lifecycle/BaseService'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'

import { MemoryService } from '../MemoryService'

describe('MemoryService', () => {
  beforeEach(() => {
    BaseService.resetInstances()
    MockMainPreferenceServiceUtils.resetMocks()
    MockMainPreferenceServiceUtils.setPreferenceValue('feature.memory.provider', 'off')
  })

  it('starts with NullProvider when provider is off', async () => {
    const service = new MemoryService()
    // @ts-expect-error access private
    await service.onInit()
    // @ts-expect-error access private
    expect(service.currentProviderId).toBe('off')
  })

  it('activates HindsightProvider when preference changes to hindsight', async () => {
    const service = new MemoryService()
    // @ts-expect-error access private
    await service.onInit()

    MockMainPreferenceServiceUtils.setPreferenceValue('feature.memory.provider', 'hindsight')
    // Allow async activation to complete
    await vi.waitFor(() => {
      // @ts-expect-error access private
      expect(service.currentProviderId).toBe('hindsight')
    })
  })

  it('falls back to NullProvider when provider activation fails', async () => {
    const { HindsightProvider } = await import('../providers/HindsightProvider')
    vi.mocked(HindsightProvider).mockImplementationOnce(
      () =>
        ({
          id: 'hindsight',
          capabilities: {} as never,
          init: vi.fn().mockRejectedValue(new Error('connection refused')),
          add: vi.fn(),
          search: vi.fn(),
          list: vi.fn(),
          get: vi.fn(),
          update: vi.fn(),
          delete: vi.fn(),
          deleteAll: vi.fn(),
          listUsers: vi.fn(),
          healthCheck: vi.fn(),
          destroy: vi.fn()
        }) as any
    )

    const service = new MemoryService()
    // @ts-expect-error access private
    await service.onInit()
    // @ts-expect-error access private
    await service.activateProvider('hindsight')

    // @ts-expect-error access private
    expect(service.currentProviderId).toBe('off')
  })

  it('getCapabilities returns NullProvider capabilities when disabled', async () => {
    const service = new MemoryService()
    // @ts-expect-error access private
    await service.onInit()
    const caps = service.getCapabilities()
    expect(caps.supportsReflect).toBe(false)
    expect(caps.serverSideExtraction).toBe(false)
  })
})
