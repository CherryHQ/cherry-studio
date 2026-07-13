import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { application } from '@application'
import { ENDPOINT_TYPE, type Model as DataModel, MODEL_CAPABILITY, type UniqueModelId } from '@shared/data/types/model'
import type { Provider as DataProvider } from '@shared/data/types/provider'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// --- Mocks for OpenClawService dependencies ---

vi.mock('@main/core/lifecycle', () => {
  class MockBaseService {}
  return {
    BaseService: MockBaseService,
    Injectable: () => (target: unknown) => target,
    ServicePhase: () => (target: unknown) => target,
    DependsOn: () => (target: unknown) => target,
    Phase: { Background: 'background', WhenReady: 'whenReady', BeforeReady: 'beforeReady' }
  }
})

vi.mock('@application', () => ({
  application: {
    get: vi.fn((name: string) => {
      if (name === 'MainWindowService') {
        return {
          getMainWindow: vi.fn(() => ({
            webContents: { send: vi.fn() }
          }))
        }
      }
      if (name === 'WindowManager') {
        return { broadcastToType: vi.fn(), getWindowsByType: vi.fn(() => []) }
      }
      throw new Error(`[MockApplication] Unknown service: ${name}`)
    }),
    getPath: vi.fn()
  }
}))

vi.mock('@main/utils/binaryResolver', () => ({
  getBinaryPath: vi.fn(() => Promise.resolve('/mock/bin/openclaw'))
}))

vi.mock('@data/services/ModelService', () => ({
  modelService: {
    getByKey: vi.fn(),
    list: vi.fn()
  }
}))

vi.mock('@data/services/ProviderService', () => ({
  providerService: {
    getApiKeys: vi.fn(),
    getByProviderId: vi.fn()
  }
}))

vi.mock('@main/utils/shellEnv', () => ({
  refreshShellEnv: vi.fn(() => Promise.resolve({ PATH: '/usr/bin' }))
}))

vi.mock('@main/services/RegionService', () => ({
  regionService: { isInChina: vi.fn(() => Promise.resolve(false)) }
}))

vi.mock('@main/core/platform', () => ({
  isWin: false
}))

vi.mock('@shared/utils', () => ({
  hasApiVersion: vi.fn(() => false),
  withoutTrailingSlash: vi.fn((url: string) => url.replace(/\/+$/, ''))
}))

// openClawParsers: not mocked — tested directly below

vi.mock('../VertexAiService', () => ({
  vertexAiService: { getAccessToken: vi.fn(() => Promise.resolve('mock-token')) }
}))

// --- Import service after mocks are set up ---

async function createService() {
  const { OpenClawService } = await import('../OpenClawService')
  return new OpenClawService()
}

function createProvider(overrides: Partial<DataProvider> = {}): DataProvider {
  return {
    id: 'openai',
    name: 'OpenAI',
    endpointConfigs: {
      [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://api.openai.com' }
    },
    defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
    apiKeys: [{ id: 'key-1', label: 'Primary', isEnabled: true }],
    authType: 'api-key',
    apiFeatures: {
      arrayContent: true,
      streamOptions: true,
      developerRole: false,
      serviceTier: false,
      verbosity: false
    },
    settings: {},
    isEnabled: true,
    ...overrides
  }
}

function createModel(overrides: Partial<DataModel> = {}): DataModel {
  return {
    id: 'openai::gpt-4o',
    providerId: 'openai',
    apiModelId: 'gpt-4o',
    name: 'GPT-4o',
    capabilities: [],
    endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS],
    supportsStreaming: true,
    isEnabled: true,
    isHidden: false,
    ...overrides
  }
}

describe('OpenClawService gateway status state machine', () => {
  let service: Awaited<ReturnType<typeof createService>>
  let checkHealthSpy: ReturnType<typeof vi.spyOn>
  let findBinarySpy: ReturnType<typeof vi.spyOn>
  let checkPortOpenSpy: ReturnType<typeof vi.spyOn>
  let startAndWaitSpy: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    vi.clearAllMocks()
    service = await createService()

    // Reset internal state via reflection
    ;(service as any).gatewayStatus = 'stopped'
    ;(service as any).gatewayPort = 18790
    ;(service as any).gatewayAuthToken = ''

    // Spy on private methods via prototype
    checkHealthSpy = vi.spyOn(service as any, 'checkGatewayHealth')
    findBinarySpy = vi.spyOn(service as any, 'findOpenClawBinary')
    checkPortOpenSpy = vi.spyOn(service as any, 'checkPortOpen')
    startAndWaitSpy = vi.spyOn(service as any, 'startAndWaitForGateway')
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('getDashboardUrl', () => {
    it('uses fragment token to keep dashboard auth client-side', () => {
      // @ts-expect-error -- accessing private field for testing
      service.gatewayAuthToken = 'a b+c'

      const url = service.getDashboardUrl()
      expect(url).toBe(`http://127.0.0.1:18790#token=${encodeURIComponent('a b+c')}`)
    })
  })

  // ─── getStatus ───────────────────────────────────────────────

  describe('getStatus', () => {
    it('returns "starting" immediately without probing health', async () => {
      ;(service as any).gatewayStatus = 'starting'

      const result = await service.getStatus()

      expect(result).toEqual({ status: 'starting', port: 18790 })
      expect(checkHealthSpy).not.toHaveBeenCalled()
    })

    it('detects externally running gateway when stopped', async () => {
      ;(service as any).gatewayStatus = 'stopped'
      checkHealthSpy.mockResolvedValue({ status: 'healthy', gatewayPort: 18790 })

      const result = await service.getStatus()

      expect(result).toEqual({ status: 'running', port: 18790 })
    })

    it('detects externally running gateway when in error state', async () => {
      ;(service as any).gatewayStatus = 'error'
      checkHealthSpy.mockResolvedValue({ status: 'healthy', gatewayPort: 18790 })

      const result = await service.getStatus()

      expect(result).toEqual({ status: 'running', port: 18790 })
    })

    it('detects crashed gateway and transitions running → stopped', async () => {
      ;(service as any).gatewayStatus = 'running'
      checkHealthSpy.mockResolvedValue({ status: 'unhealthy', gatewayPort: 18790 })

      const result = await service.getStatus()

      expect(result).toEqual({ status: 'stopped', port: 18790 })
    })

    it('stays running when health probe is healthy', async () => {
      ;(service as any).gatewayStatus = 'running'
      checkHealthSpy.mockResolvedValue({ status: 'healthy', gatewayPort: 18790 })

      const result = await service.getStatus()

      expect(result).toEqual({ status: 'running', port: 18790 })
    })

    it('stays stopped when health probe is unhealthy', async () => {
      ;(service as any).gatewayStatus = 'stopped'
      checkHealthSpy.mockResolvedValue({ status: 'unhealthy', gatewayPort: 18790 })

      const result = await service.getStatus()

      expect(result).toEqual({ status: 'stopped', port: 18790 })
    })

    it('stays in error when health probe is unhealthy', async () => {
      ;(service as any).gatewayStatus = 'error'
      checkHealthSpy.mockResolvedValue({ status: 'unhealthy', gatewayPort: 18790 })

      const result = await service.getStatus()

      expect(result).toEqual({ status: 'error', port: 18790 })
    })
  })

  // ─── startGateway ────────────────────────────────────────────

  describe('startGateway', () => {
    it('rejects concurrent startup calls', async () => {
      ;(service as any).gatewayStatus = 'starting'

      const result = await service.startGateway()

      expect(result).toEqual({ success: false, message: 'Gateway is already starting' })
    })

    it('stops stale gateway and restarts when port is in use by our gateway', async () => {
      // First call: port occupied; after stop: port free
      checkPortOpenSpy.mockResolvedValueOnce(true).mockResolvedValue(false)
      checkHealthSpy
        .mockResolvedValueOnce({ status: 'healthy', gatewayPort: 18790 }) // startGateway detects our gateway
        .mockResolvedValue({ status: 'unhealthy', gatewayPort: 18790 }) // waitForGatewayStop confirms stopped
      findBinarySpy.mockResolvedValue('/mock/bin/openclaw')
      startAndWaitSpy.mockResolvedValue(undefined)

      const result = await service.startGateway()

      expect(result).toEqual({ success: true })
      expect((service as any).gatewayStatus).toBe('running')
    })

    it('fails when port is in use by another application', async () => {
      checkPortOpenSpy.mockResolvedValue(true)
      checkHealthSpy.mockResolvedValue({ status: 'unhealthy', gatewayPort: 18790 })

      const result = await service.startGateway()

      expect(result.success).toBe(false)
      expect('message' in result && result.message).toContain('already in use')
    })

    it('fails when binary is not found', async () => {
      checkPortOpenSpy.mockResolvedValue(false)
      findBinarySpy.mockResolvedValue(null)

      const result = await service.startGateway()

      expect(result).toEqual({
        success: false,
        message: 'OpenClaw binary not found. Please install OpenClaw first.'
      })
    })

    it('transitions to running on successful start', async () => {
      checkPortOpenSpy.mockResolvedValue(false)
      findBinarySpy.mockResolvedValue('/mock/bin/openclaw')
      startAndWaitSpy.mockResolvedValue(undefined)

      const result = await service.startGateway()

      expect(result).toEqual({ success: true })
      expect((service as any).gatewayStatus).toBe('running')
    })

    it('transitions to error when start fails', async () => {
      checkPortOpenSpy.mockResolvedValue(false)
      findBinarySpy.mockResolvedValue('/mock/bin/openclaw')
      startAndWaitSpy.mockRejectedValue(new Error('Gateway timeout'))

      const result = await service.startGateway()

      expect(result).toEqual({ success: false, message: 'Gateway timeout' })
      expect((service as any).gatewayStatus).toBe('error')
    })

    it('sets status to starting during startup', async () => {
      checkPortOpenSpy.mockResolvedValue(false)
      findBinarySpy.mockResolvedValue('/mock/bin/openclaw')

      let statusDuringStart: string | undefined
      startAndWaitSpy.mockImplementation(async () => {
        statusDuringStart = (service as any).gatewayStatus
      })

      await service.startGateway()

      expect(statusDuringStart).toBe('starting')
    })

    it('uses custom port when provided', async () => {
      checkPortOpenSpy.mockResolvedValue(false)
      findBinarySpy.mockResolvedValue('/mock/bin/openclaw')
      startAndWaitSpy.mockResolvedValue(undefined)

      await service.startGateway(9999)

      expect((service as any).gatewayPort).toBe(9999)
    })
  })

  // ─── stopGateway ─────────────────────────────────────────────

  describe('stopGateway', () => {
    it('transitions to stopped on successful stop', async () => {
      ;(service as any).gatewayStatus = 'running'
      checkHealthSpy.mockResolvedValue({ status: 'unhealthy', gatewayPort: 18790 }) // gateway stopped

      const result = await service.stopGateway()

      expect(result).toEqual({ success: true })
      expect((service as any).gatewayStatus).toBe('stopped')
    })

    it('transitions to error when gateway fails to stop', async () => {
      vi.useFakeTimers()
      ;(service as any).gatewayStatus = 'running'
      checkHealthSpy.mockResolvedValue({ status: 'healthy', gatewayPort: 18790 }) // still running

      const resultPromise = service.stopGateway()
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.success).toBe(false)
      expect((service as any).gatewayStatus).toBe('error')
      expect(checkHealthSpy).toHaveBeenCalledTimes(3)
    })
  })

  // ─── syncConfig ─────────────────────────────────────────────

  describe('syncConfig', () => {
    // Regression: syncProviderConfig writes config.gateway.port from this.gatewayPort, but sync
    // runs before startGateway(port) updates it. A caller-supplied port must be applied first, or
    // a custom port is written as the stale default (18790) and the gateway binds the wrong port.
    it('applies the caller port before syncProviderConfig writes the config', async () => {
      const { modelService } = await import('@data/services/ModelService')
      const { providerService } = await import('@data/services/ProviderService')
      vi.mocked(providerService.getByProviderId).mockResolvedValue(createProvider())
      const model = createModel()
      vi.mocked(modelService.getByKey).mockResolvedValue(model)
      vi.mocked(modelService.list).mockResolvedValue([model])
      vi.mocked(providerService.getApiKeys).mockResolvedValue([{ id: 'key-1', key: 'sk-test', isEnabled: true }])

      let portAtWrite: number | undefined
      vi.spyOn(service, 'syncProviderConfig').mockImplementation(async () => {
        portAtWrite = (service as any).gatewayPort
        return { success: true }
      })

      await service.syncConfig('openai::gpt-4o', 20000)

      expect(portAtWrite).toBe(20000)
      expect((service as any).gatewayPort).toBe(20000)
    })

    it('leaves the current gateway port unchanged when no port is supplied', async () => {
      ;(service as any).gatewayPort = 12345
      const { modelService } = await import('@data/services/ModelService')
      const { providerService } = await import('@data/services/ProviderService')
      vi.mocked(providerService.getByProviderId).mockResolvedValue(createProvider())
      const model = createModel()
      vi.mocked(modelService.getByKey).mockResolvedValue(model)
      vi.mocked(modelService.list).mockResolvedValue([model])
      vi.mocked(providerService.getApiKeys).mockResolvedValue([{ id: 'key-1', key: 'sk-test', isEnabled: true }])
      vi.spyOn(service, 'syncProviderConfig').mockResolvedValue({ success: true })

      await service.syncConfig('openai::gpt-4o')

      expect((service as any).gatewayPort).toBe(12345)
    })

    it('resolves a unique model id before syncing OpenClaw config', async () => {
      const { modelService } = await import('@data/services/ModelService')
      const { providerService } = await import('@data/services/ProviderService')
      vi.mocked(providerService.getByProviderId).mockResolvedValue(createProvider())
      const model = createModel()
      vi.mocked(modelService.getByKey).mockResolvedValue(model)
      vi.mocked(modelService.list).mockResolvedValue([model])
      vi.mocked(providerService.getApiKeys).mockResolvedValue([{ id: 'key-1', key: 'sk-test', isEnabled: true }])
      const syncProviderConfigSpy = vi.spyOn(service, 'syncProviderConfig').mockResolvedValue({ success: true })

      const result = await service.syncConfig('openai::gpt-4o')

      expect(result).toEqual({ success: true })
      expect(syncProviderConfigSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'openai',
          apiKey: 'sk-test',
          apiHost: 'https://api.openai.com',
          anthropicApiHost: undefined,
          models: [expect.objectContaining({ id: 'gpt-4o', endpoint_type: 'openai' })]
        }),
        expect.objectContaining({ id: 'gpt-4o', endpoint_type: 'openai' })
      )
      expect(modelService.list).toHaveBeenCalledWith({ providerId: 'openai', enabled: true })
    })

    it('does not route a mixed provider OpenAI model through the Anthropic endpoint', async () => {
      const { modelService } = await import('@data/services/ModelService')
      const { providerService } = await import('@data/services/ProviderService')
      vi.mocked(providerService.getByProviderId).mockResolvedValue(
        createProvider({
          id: 'new-api',
          name: 'New API',
          endpointConfigs: {
            [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://new-api.example.com/openai' },
            [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { baseUrl: 'https://new-api.example.com/anthropic' }
          }
        })
      )
      const model = createModel({ id: 'new-api::gpt-4o', providerId: 'new-api' })
      const anthropicModel = createModel({
        id: 'new-api::claude-sonnet-4',
        providerId: 'new-api',
        apiModelId: 'claude-sonnet-4',
        name: 'Claude Sonnet 4',
        endpointTypes: [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]
      })
      vi.mocked(modelService.getByKey).mockResolvedValue(model)
      vi.mocked(modelService.list).mockResolvedValue([model, anthropicModel])
      vi.mocked(providerService.getApiKeys).mockResolvedValue([{ id: 'key-1', key: 'sk-test', isEnabled: true }])
      const syncProviderConfigSpy = vi.spyOn(service, 'syncProviderConfig').mockResolvedValue({ success: true })

      const result = await service.syncConfig('new-api::gpt-4o')

      expect(result).toEqual({ success: true })
      expect(syncProviderConfigSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          apiHost: 'https://new-api.example.com/openai',
          anthropicApiHost: undefined,
          models: [expect.objectContaining({ id: 'gpt-4o', endpoint_type: 'openai' })]
        }),
        expect.objectContaining({ endpoint_type: 'openai' })
      )
    })

    it('excludes hidden models from the synced model list', async () => {
      const { modelService } = await import('@data/services/ModelService')
      const { providerService } = await import('@data/services/ProviderService')
      vi.mocked(providerService.getByProviderId).mockResolvedValue(createProvider())
      const visibleModel = createModel()
      const hiddenModel = createModel({ id: 'openai::hidden-model', apiModelId: 'hidden-model', isHidden: true })
      vi.mocked(modelService.getByKey).mockResolvedValue(visibleModel)
      vi.mocked(modelService.list).mockResolvedValue([visibleModel, hiddenModel])
      vi.mocked(providerService.getApiKeys).mockResolvedValue([{ id: 'key-1', key: 'sk-test', isEnabled: true }])
      const syncProviderConfigSpy = vi.spyOn(service, 'syncProviderConfig').mockResolvedValue({ success: true })

      const result = await service.syncConfig('openai::gpt-4o')

      expect(result).toEqual({ success: true })
      expect(syncProviderConfigSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          models: [expect.objectContaining({ id: 'gpt-4o' })]
        }),
        expect.anything()
      )
    })

    it('excludes non-chat models from the synced model list', async () => {
      const { modelService } = await import('@data/services/ModelService')
      const { providerService } = await import('@data/services/ProviderService')
      vi.mocked(providerService.getByProviderId).mockResolvedValue(createProvider())
      const chatModel = createModel()
      const embeddingModel = createModel({
        id: 'openai::text-embedding-3-large',
        apiModelId: 'text-embedding-3-large',
        name: 'Text Embedding 3 Large',
        capabilities: [MODEL_CAPABILITY.EMBEDDING]
      })
      vi.mocked(modelService.getByKey).mockResolvedValue(chatModel)
      vi.mocked(modelService.list).mockResolvedValue([chatModel, embeddingModel])
      vi.mocked(providerService.getApiKeys).mockResolvedValue([{ id: 'key-1', key: 'sk-test', isEnabled: true }])
      const syncProviderConfigSpy = vi.spyOn(service, 'syncProviderConfig').mockResolvedValue({ success: true })

      const result = await service.syncConfig('openai::gpt-4o')

      expect(result).toEqual({ success: true })
      expect(syncProviderConfigSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          models: [expect.objectContaining({ id: 'gpt-4o' })]
        }),
        expect.anything()
      )
    })

    it('returns an error for invalid model selections', async () => {
      // Bypasses the compile-time UniqueModelId contract on purpose: the service's
      // runtime safeParse is the boundary defense for non-IPC callers.
      const result = await service.syncConfig('invalid-model-id' as UniqueModelId)

      expect(result).toEqual({ success: false, message: 'Invalid OpenClaw model selection' })
    })

    it('returns an error when the selected endpoint has no API host', async () => {
      const { modelService } = await import('@data/services/ModelService')
      const { providerService } = await import('@data/services/ProviderService')
      vi.mocked(providerService.getByProviderId).mockResolvedValue(
        createProvider({
          endpointConfigs: {}
        })
      )
      const model = createModel()
      vi.mocked(modelService.getByKey).mockResolvedValue(model)
      vi.mocked(modelService.list).mockResolvedValue([model])
      vi.mocked(providerService.getApiKeys).mockResolvedValue([{ id: 'key-1', key: 'sk-test', isEnabled: true }])

      const result = await service.syncConfig('openai::gpt-4o')

      expect(result).toEqual({
        success: false,
        message: `Provider openai has no API host configured for ${ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS}`
      })
    })

    it('does not borrow an API host from another endpoint type', async () => {
      const { modelService } = await import('@data/services/ModelService')
      const { providerService } = await import('@data/services/ProviderService')
      vi.mocked(providerService.getByProviderId).mockResolvedValue(
        createProvider({
          endpointConfigs: {
            [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://api.openai.com' }
          }
        })
      )
      const model = createModel({
        endpointTypes: [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]
      })
      vi.mocked(modelService.getByKey).mockResolvedValue(model)
      vi.mocked(modelService.list).mockResolvedValue([model])
      vi.mocked(providerService.getApiKeys).mockResolvedValue([{ id: 'key-1', key: 'sk-test', isEnabled: true }])
      const syncProviderConfigSpy = vi.spyOn(service, 'syncProviderConfig').mockResolvedValue({ success: true })

      const result = await service.syncConfig('openai::gpt-4o')

      expect(result).toEqual({
        success: false,
        message: `Provider openai has no API host configured for ${ENDPOINT_TYPE.ANTHROPIC_MESSAGES}`
      })
      expect(syncProviderConfigSpy).not.toHaveBeenCalled()
    })

    it('returns an error when an API-key provider has no enabled API key', async () => {
      const { modelService } = await import('@data/services/ModelService')
      const { providerService } = await import('@data/services/ProviderService')
      vi.mocked(providerService.getByProviderId).mockResolvedValue(createProvider())
      const model = createModel()
      vi.mocked(modelService.getByKey).mockResolvedValue(model)
      vi.mocked(modelService.list).mockResolvedValue([model])
      vi.mocked(providerService.getApiKeys).mockResolvedValue([])

      const result = await service.syncConfig('openai::gpt-4o')

      expect(result).toEqual({ success: false, message: 'Provider openai has no enabled API key configured' })
    })

    it('returns an error when the selected OpenClaw model is non-chat', async () => {
      const { modelService } = await import('@data/services/ModelService')
      const { providerService } = await import('@data/services/ProviderService')
      vi.mocked(providerService.getByProviderId).mockResolvedValue(createProvider())
      const embeddingModel = createModel({
        id: 'openai::text-embedding-3-large',
        apiModelId: 'text-embedding-3-large',
        name: 'Text Embedding 3 Large',
        capabilities: [MODEL_CAPABILITY.EMBEDDING]
      })
      vi.mocked(modelService.getByKey).mockResolvedValue(embeddingModel)
      vi.mocked(modelService.list).mockResolvedValue([embeddingModel])
      vi.mocked(providerService.getApiKeys).mockResolvedValue([{ id: 'key-1', key: 'sk-test', isEnabled: true }])
      const syncProviderConfigSpy = vi.spyOn(service, 'syncProviderConfig').mockResolvedValue({ success: true })

      const result = await service.syncConfig('openai::text-embedding-3-large')

      expect(result).toEqual({ success: false, message: 'Selected OpenClaw model must support chat' })
      expect(syncProviderConfigSpy).not.toHaveBeenCalled()
    })

    it('allows keyless GPUStack providers during sync', async () => {
      const { modelService } = await import('@data/services/ModelService')
      const { providerService } = await import('@data/services/ProviderService')
      vi.mocked(providerService.getByProviderId).mockResolvedValue(
        createProvider({
          id: 'gpustack',
          name: 'GPUStack',
          presetProviderId: 'gpustack',
          endpointConfigs: {
            [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'http://127.0.0.1:8080/v1' }
          }
        })
      )
      const model = createModel({
        id: 'gpustack::qwen3',
        providerId: 'gpustack',
        apiModelId: 'qwen3',
        name: 'Qwen3'
      })
      vi.mocked(modelService.getByKey).mockResolvedValue(model)
      vi.mocked(modelService.list).mockResolvedValue([model])
      vi.mocked(providerService.getApiKeys).mockResolvedValue([])
      const syncProviderConfigSpy = vi.spyOn(service, 'syncProviderConfig').mockResolvedValue({ success: true })

      const result = await service.syncConfig('gpustack::qwen3')

      expect(result).toEqual({ success: true })
      expect(syncProviderConfigSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'gpustack',
          apiKey: 'gpustack',
          apiHost: 'http://127.0.0.1:8080/v1'
        }),
        expect.objectContaining({ id: 'qwen3' })
      )
    })

    it('maps Anthropic endpoint models to Anthropic OpenClaw provider config', async () => {
      const { modelService } = await import('@data/services/ModelService')
      const { providerService } = await import('@data/services/ProviderService')
      vi.mocked(providerService.getByProviderId).mockResolvedValue(
        createProvider({
          id: 'new-api',
          name: 'New API',
          endpointConfigs: {
            [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { baseUrl: 'https://new-api.example.com/anthropic' }
          }
        })
      )
      const model = createModel({
        id: 'new-api::claude-sonnet-4',
        providerId: 'new-api',
        apiModelId: 'claude-sonnet-4',
        endpointTypes: [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]
      })
      vi.mocked(modelService.getByKey).mockResolvedValue(model)
      vi.mocked(modelService.list).mockResolvedValue([model])
      vi.mocked(providerService.getApiKeys).mockResolvedValue([{ id: 'key-1', key: 'sk-test', isEnabled: true }])
      const syncProviderConfigSpy = vi.spyOn(service, 'syncProviderConfig').mockResolvedValue({ success: true })

      const result = await service.syncConfig('new-api::claude-sonnet-4')

      expect(result).toEqual({ success: true })
      expect(syncProviderConfigSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'anthropic',
          apiHost: 'https://new-api.example.com/anthropic',
          anthropicApiHost: 'https://new-api.example.com/anthropic'
        }),
        expect.objectContaining({ id: 'claude-sonnet-4', endpoint_type: 'anthropic' })
      )
    })

    it('maps OpenAI Responses endpoint models through provider and model config', async () => {
      const { modelService } = await import('@data/services/ModelService')
      const { providerService } = await import('@data/services/ProviderService')
      vi.mocked(providerService.getByProviderId).mockResolvedValue(
        createProvider({
          endpointConfigs: {
            [ENDPOINT_TYPE.OPENAI_RESPONSES]: { baseUrl: 'https://api.openai.com' }
          },
          defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_RESPONSES
        })
      )
      const model = createModel({
        endpointTypes: [ENDPOINT_TYPE.OPENAI_RESPONSES]
      })
      vi.mocked(modelService.getByKey).mockResolvedValue(model)
      vi.mocked(modelService.list).mockResolvedValue([model])
      vi.mocked(providerService.getApiKeys).mockResolvedValue([{ id: 'key-1', key: 'sk-test', isEnabled: true }])
      const syncProviderConfigSpy = vi.spyOn(service, 'syncProviderConfig').mockResolvedValue({ success: true })

      const result = await service.syncConfig('openai::gpt-4o')

      expect(result).toEqual({ success: true })
      expect(syncProviderConfigSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'openai-response',
          apiHost: 'https://api.openai.com'
        }),
        expect.objectContaining({ endpoint_type: 'openai-response' })
      )
    })

    it('determines OpenAI Responses API type from model endpoint type', () => {
      const apiType = (service as any).determineApiType(
        {
          id: 'openai',
          type: 'openai',
          apiHost: 'https://api.openai.com'
        },
        { id: 'gpt-4o', provider: 'openai', endpoint_type: 'openai-response' }
      )

      expect(apiType).toBe('openai-responses')
    })

    it('returns an error for providers OpenClaw sync cannot adapt yet', async () => {
      const { modelService } = await import('@data/services/ModelService')
      const { providerService } = await import('@data/services/ProviderService')
      vi.mocked(providerService.getByProviderId).mockResolvedValue(
        createProvider({
          id: 'vertexai',
          presetProviderId: 'vertexai',
          name: 'Vertex AI',
          endpointConfigs: {
            [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]: { baseUrl: 'https://generativelanguage.googleapis.com' }
          },
          defaultChatEndpoint: ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT
        })
      )
      const model = createModel({
        id: 'vertexai::gemini-2.5-pro',
        providerId: 'vertexai',
        apiModelId: 'gemini-2.5-pro',
        endpointTypes: [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]
      })
      vi.mocked(modelService.getByKey).mockResolvedValue(model)
      vi.mocked(modelService.list).mockResolvedValue([model])
      vi.mocked(providerService.getApiKeys).mockResolvedValue([{ id: 'key-1', key: 'sk-test', isEnabled: true }])

      const result = await service.syncConfig('vertexai::gemini-2.5-pro')

      expect(result).toEqual({ success: false, message: 'OpenClaw sync does not support Vertex AI providers yet' })
    })
  })

  // ─── syncProviderConfig existing-config handling ─────────────

  describe('syncProviderConfig existing-config handling', () => {
    let configDir: string

    // Minimal legacy-shaped provider/model — syncProviderConfig still takes the
    // migration legacyTypes shapes, not the Data* ones used by syncConfig.
    const legacyProvider = {
      id: 'openai',
      type: 'openai',
      name: 'OpenAI',
      apiKey: 'sk-test',
      apiHost: 'https://api.openai.com',
      models: [{ id: 'gpt-4o', name: 'GPT-4o' }]
    } as any
    const legacyModel = { id: 'gpt-4o', provider: 'openai', name: 'GPT-4o' } as any

    beforeEach(() => {
      configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-config-'))
      vi.mocked(application.getPath).mockReturnValue(configDir)
    })

    afterEach(() => {
      fs.rmSync(configDir, { recursive: true, force: true })
    })

    it('aborts the sync when the existing config is not valid JSON', async () => {
      const configPath = path.join(configDir, 'openclaw.json')
      fs.writeFileSync(configPath, '{ not json', 'utf-8')

      const result = await service.syncProviderConfig(legacyProvider, legacyModel)

      expect(result.success).toBe(false)
      expect('message' in result && result.message).toMatch(/not valid JSON/)
      // The unparseable file must survive so the user can repair it by hand.
      expect(fs.readFileSync(configPath, 'utf-8')).toBe('{ not json')
    })

    it('writes a fresh config when none exists yet', async () => {
      const result = await service.syncProviderConfig(legacyProvider, legacyModel)

      expect(result).toEqual({ success: true })
      const written = JSON.parse(fs.readFileSync(path.join(configDir, 'openclaw.json'), 'utf-8'))
      expect(written.models.providers['cherry-openai']).toMatchObject({ apiKey: 'sk-test' })
      expect(written.agents.defaults.model.primary).toBe('cherry-openai/gpt-4o')
    })
  })

  // ─── Full state transition scenarios ─────────────────────────

  describe('full lifecycle transitions', () => {
    it('stopped → starting → running → (crash) → stopped', async () => {
      expect((service as any).gatewayStatus).toBe('stopped')

      // Start
      checkPortOpenSpy.mockResolvedValue(false)
      findBinarySpy.mockResolvedValue('/mock/bin/openclaw')
      startAndWaitSpy.mockResolvedValue(undefined)
      await service.startGateway()
      expect((service as any).gatewayStatus).toBe('running')

      // Gateway crashes externally — getStatus detects it
      checkHealthSpy.mockResolvedValue({ status: 'unhealthy', gatewayPort: 18790 })
      const status = await service.getStatus()
      expect(status.status).toBe('stopped')
    })

    it('stopped → starting → error → (external recovery) → running', async () => {
      // Start fails
      checkPortOpenSpy.mockResolvedValue(false)
      findBinarySpy.mockResolvedValue('/mock/bin/openclaw')
      startAndWaitSpy.mockRejectedValue(new Error('timeout'))
      await service.startGateway()
      expect((service as any).gatewayStatus).toBe('error')

      // External recovery — someone starts gateway manually
      checkHealthSpy.mockResolvedValue({ status: 'healthy', gatewayPort: 18790 })
      const status = await service.getStatus()
      expect(status.status).toBe('running')
    })

    it('running → getStatus unhealthy → stopped → getStatus healthy → running', async () => {
      ;(service as any).gatewayStatus = 'running'

      // getStatus detects crash
      checkHealthSpy.mockResolvedValue({ status: 'unhealthy', gatewayPort: 18790 })
      const crashed = await service.getStatus()
      expect(crashed.status).toBe('stopped')

      // getStatus detects recovery
      checkHealthSpy.mockResolvedValue({ status: 'healthy', gatewayPort: 18790 })
      const recovered = await service.getStatus()
      expect(recovered.status).toBe('running')
    })
  })
})
