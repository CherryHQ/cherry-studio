import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSessionById: vi.fn(),
  ensureTraceId: vi.fn(),
  getAgent: vi.fn(),
  getProviderByProviderId: vi.fn(),
  getModelByKey: vi.fn(),
  getRotatedApiKey: vi.fn(),
  getLastRuntimeResumeToken: vi.fn(),
  resolveEffectiveEndpoint: vi.fn(),
  buildSessionSettings: vi.fn(),
  apiGatewayEnsureKey: vi.fn(),
  apiGatewayIsRunning: vi.fn(),
  apiGatewayStart: vi.fn(),
  apiGatewayGetCurrentConfig: vi.fn(),
  isTraceModeEnabled: vi.fn(),
  traceEnvForPrewarm: vi.fn()
}))

vi.mock('@data/services/AgentSessionService', () => ({
  agentSessionService: { getById: mocks.getSessionById, ensureTraceId: mocks.ensureTraceId }
}))

vi.mock('@data/services/AgentService', () => ({
  agentService: { getAgent: mocks.getAgent }
}))

vi.mock('@data/services/ProviderService', () => ({
  providerService: {
    getByProviderId: mocks.getProviderByProviderId,
    getRotatedApiKey: mocks.getRotatedApiKey
  }
}))

vi.mock('@data/services/ModelService', () => ({
  modelService: { getByKey: mocks.getModelByKey }
}))

vi.mock('@data/services/AgentSessionMessageService', () => ({
  agentSessionMessageService: { getLastRuntimeResumeToken: mocks.getLastRuntimeResumeToken }
}))

vi.mock('@main/core/application', () => ({
  application: {
    get: vi.fn((name: string) => {
      if (name === 'ApiGatewayService') {
        return {
          ensureValidApiKey: mocks.apiGatewayEnsureKey,
          isRunning: mocks.apiGatewayIsRunning,
          start: mocks.apiGatewayStart,
          getCurrentConfig: mocks.apiGatewayGetCurrentConfig
        }
      }
      if (name === 'ClaudeCodeTraceBridgeService') {
        return {
          isTraceModeEnabled: mocks.isTraceModeEnabled,
          traceEnvForPrewarm: mocks.traceEnvForPrewarm
        }
      }
      throw new Error(`Unexpected application.get(${name})`)
    })
  }
}))

vi.mock('../../provider/endpoint', () => ({
  resolveEffectiveEndpoint: mocks.resolveEffectiveEndpoint
}))

vi.mock('../settingsBuilder', () => ({
  buildClaudeCodeSessionSettings: mocks.buildSessionSettings
}))

const { buildClaudeCodeQueryRequestForAgentSession, buildClaudeCodeWarmQueryRequestForAgentSession } = await import(
  '../agentSessionWarmup'
)

describe('buildClaudeCodeQueryRequestForAgentSession resume-token precedence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.isTraceModeEnabled.mockReturnValue(false)
    mocks.getSessionById.mockResolvedValue({ id: 'session-1', agentId: 'agent-1' })
    mocks.getAgent.mockResolvedValue({ id: 'agent-1', model: 'provider-1::model-1' })
    mocks.getProviderByProviderId.mockResolvedValue({
      id: 'provider-1',
      endpointConfigs: { 'anthropic-messages': { baseUrl: 'https://anthropic.example.com' } }
    })
    mocks.getModelByKey.mockResolvedValue({ id: 'model-1', apiModelId: 'claude-sonnet' })
    mocks.resolveEffectiveEndpoint.mockReturnValue({ baseUrl: 'https://api.example.com' })
    mocks.getRotatedApiKey.mockResolvedValue('api-key')
    mocks.apiGatewayEnsureKey.mockResolvedValue('gateway-key')
    mocks.apiGatewayIsRunning.mockReturnValue(true)
    mocks.apiGatewayStart.mockResolvedValue(undefined)
    mocks.apiGatewayGetCurrentConfig.mockReturnValue({ host: '127.0.0.1', port: 23333, apiKey: 'gateway-key' })
    // settingsBuilder receives `lastAgentSessionId` and reflects it as `resume`;
    // mirror that so the builder's own precedence is what the test exercises.
    mocks.buildSessionSettings.mockImplementation(async (_session, _provider, options) => ({
      env: {},
      ...(options?.lastAgentSessionId ? { resume: options.lastAgentSessionId } : {})
    }))
  })

  it('uses the explicit effectiveResume token and ignores the persisted one', async () => {
    mocks.getLastRuntimeResumeToken.mockResolvedValue('persisted-token')

    const request = await buildClaudeCodeQueryRequestForAgentSession('session-1', 'explicit-token')

    expect(request?.options.resume).toBe('explicit-token')
    expect(mocks.getLastRuntimeResumeToken).not.toHaveBeenCalled()
  })

  it('falls back to the persisted resume token when no explicit token is given', async () => {
    mocks.getLastRuntimeResumeToken.mockResolvedValue('persisted-token')

    const request = await buildClaudeCodeQueryRequestForAgentSession('session-1')

    expect(request?.options.resume).toBe('persisted-token')
    expect(mocks.getLastRuntimeResumeToken).toHaveBeenCalledWith('session-1')
  })

  it('leaves resume undefined when neither an explicit nor a persisted token exists', async () => {
    mocks.getLastRuntimeResumeToken.mockResolvedValue(null)

    const request = await buildClaudeCodeQueryRequestForAgentSession('session-1')

    expect(request?.options.resume).toBeUndefined()
    expect(mocks.getLastRuntimeResumeToken).toHaveBeenCalledWith('session-1')
  })

  it('uses the provider Anthropic endpoint directly when all selected models belong to that provider', async () => {
    mocks.getLastRuntimeResumeToken.mockResolvedValue(null)

    const request = await buildClaudeCodeQueryRequestForAgentSession('session-1')

    expect(request?.sdkModelId).toBe('claude-sonnet')
    expect(request?.settings.env).toMatchObject({
      ANTHROPIC_BASE_URL: 'https://anthropic.example.com',
      ANTHROPIC_API_KEY: 'api-key',
      ANTHROPIC_AUTH_TOKEN: 'api-key',
      ANTHROPIC_MODEL: 'claude-sonnet',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-sonnet',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-sonnet'
    })
    expect(mocks.apiGatewayStart).not.toHaveBeenCalled()
  })

  it('routes non-Anthropic provider models through the local API gateway', async () => {
    mocks.getAgent.mockResolvedValue({
      id: 'agent-1',
      model: 'openai::gpt-main',
      planModel: 'openai::gpt-plan',
      smallModel: 'other::small'
    })
    mocks.getProviderByProviderId.mockImplementation(async (providerId: string) => ({
      id: providerId,
      endpointConfigs: { 'openai-chat-completions': { baseUrl: `https://${providerId}.example.com` } }
    }))
    mocks.getModelByKey.mockImplementation(async (_providerId: string, modelId: string) => ({
      id: modelId,
      apiModelId: `${modelId}-api`
    }))
    mocks.apiGatewayIsRunning.mockReturnValue(false)
    mocks.apiGatewayGetCurrentConfig.mockReturnValue({ host: '127.0.0.1', port: 24444, apiKey: 'gateway-key' })
    mocks.getLastRuntimeResumeToken.mockResolvedValue(null)

    const request = await buildClaudeCodeQueryRequestForAgentSession('session-1')

    expect(mocks.apiGatewayEnsureKey).toHaveBeenCalled()
    expect(mocks.apiGatewayStart).toHaveBeenCalled()
    expect(request?.sdkModelId).toBe('openai:gpt-main-api')
    expect(request?.settings.env).toMatchObject({
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:24444',
      ANTHROPIC_API_KEY: 'gateway-key',
      ANTHROPIC_AUTH_TOKEN: 'gateway-key',
      ANTHROPIC_MODEL: 'openai:gpt-main-api',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'openai:gpt-main-api',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'openai:gpt-plan-api',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'other:small-api'
    })
  })

  it('rejects Gemini provider models instead of routing them through the API gateway', async () => {
    mocks.getAgent.mockResolvedValue({
      id: 'agent-1',
      model: 'gemini::gemini-2.5-pro'
    })
    mocks.getProviderByProviderId.mockResolvedValue({
      id: 'gemini',
      presetProviderId: 'gemini',
      defaultChatEndpoint: 'google-generate-content',
      authType: 'api-key',
      endpointConfigs: { 'google-generate-content': { baseUrl: 'https://generativelanguage.googleapis.com' } }
    })
    mocks.getModelByKey.mockResolvedValue({ id: 'gemini-2.5-pro', apiModelId: 'gemini-2.5-pro' })
    mocks.getLastRuntimeResumeToken.mockResolvedValue(null)

    await expect(buildClaudeCodeQueryRequestForAgentSession('session-1')).rejects.toThrow(
      'Gemini provider models are not supported by Claude Code agents: gemini'
    )
    expect(mocks.apiGatewayEnsureKey).not.toHaveBeenCalled()
    expect(mocks.apiGatewayStart).not.toHaveBeenCalled()
  })
})

describe('buildClaudeCodeWarmQueryRequestForAgentSession trace env baking', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.isTraceModeEnabled.mockReturnValue(false)
    mocks.getSessionById.mockResolvedValue({ id: 'session-1', agentId: 'agent-1' })
    mocks.getAgent.mockResolvedValue({ id: 'agent-1', model: 'provider-1::model-1' })
    mocks.getProviderByProviderId.mockResolvedValue({
      id: 'provider-1',
      endpointConfigs: { 'anthropic-messages': { baseUrl: 'https://anthropic.example.com' } }
    })
    mocks.getModelByKey.mockResolvedValue({ id: 'model-1', apiModelId: 'claude-sonnet' })
    mocks.resolveEffectiveEndpoint.mockReturnValue({ baseUrl: 'https://api.example.com' })
    mocks.getRotatedApiKey.mockResolvedValue('api-key')
    mocks.getLastRuntimeResumeToken.mockResolvedValue(null)
    mocks.buildSessionSettings.mockResolvedValue({ env: {} })
  })

  it('leaves warm options untouched and skips trace plumbing when trace mode is off', async () => {
    const request = await buildClaudeCodeWarmQueryRequestForAgentSession('session-1')

    expect(request?.options.env).not.toHaveProperty('TRACEPARENT')
    expect(mocks.ensureTraceId).not.toHaveBeenCalled()
    expect(mocks.traceEnvForPrewarm).not.toHaveBeenCalled()
  })

  it('bakes the session-stable trace env into warm options when trace mode is on', async () => {
    mocks.isTraceModeEnabled.mockReturnValue(true)
    const traceId = 'a'.repeat(32)
    mocks.ensureTraceId.mockResolvedValue(traceId)
    mocks.traceEnvForPrewarm.mockResolvedValue({
      CLAUDE_CODE_ENABLE_TELEMETRY: '1',
      TRACEPARENT: `00-${traceId}-${'a'.repeat(16)}-01`
    })

    const request = await buildClaudeCodeWarmQueryRequestForAgentSession('session-1')

    // rootSpanId is the deterministic first-16-hex of the traceId (see deriveRootSpanId).
    expect(mocks.ensureTraceId).toHaveBeenCalledWith('session-1')
    expect(mocks.traceEnvForPrewarm).toHaveBeenCalledWith(traceId, 'a'.repeat(16))
    expect(request?.options.env).toMatchObject({
      // Base runtime env from the builder is preserved …
      ANTHROPIC_MODEL: 'claude-sonnet',
      // … and the trace env is merged on top, matching what the live connection injects.
      CLAUDE_CODE_ENABLE_TELEMETRY: '1',
      TRACEPARENT: `00-${traceId}-${'a'.repeat(16)}-01`
    })
  })
})
