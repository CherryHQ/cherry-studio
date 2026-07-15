import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSessionById: vi.fn(),
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
  apiGatewayGetCurrentConfig: vi.fn()
}))

vi.mock('@data/services/AgentSessionService', () => ({
  agentSessionService: { getById: mocks.getSessionById }
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

vi.mock('@application', () => ({
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

const { buildClaudeCodeQueryRequestForAgentSession } = await import('../agentSessionWarmup')

describe('buildClaudeCodeQueryRequestForAgentSession resume-token precedence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSessionById.mockReturnValue({ id: 'session-1', agentId: 'agent-1' })
    mocks.getAgent.mockReturnValue({ id: 'agent-1', model: 'provider-1::model-1' })
    mocks.getProviderByProviderId.mockReturnValue({
      id: 'provider-1',
      endpointConfigs: { 'anthropic-messages': { baseUrl: 'https://anthropic.example.com' } }
    })
    mocks.getModelByKey.mockReturnValue({ id: 'model-1', apiModelId: 'claude-sonnet' })
    mocks.resolveEffectiveEndpoint.mockReturnValue({ baseUrl: 'https://api.example.com' })
    mocks.getRotatedApiKey.mockReturnValue('api-key')
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
    mocks.getLastRuntimeResumeToken.mockReturnValue('persisted-token')

    const request = await buildClaudeCodeQueryRequestForAgentSession('session-1', 'explicit-token')

    expect(request?.options.resume).toBe('explicit-token')
    expect(mocks.getLastRuntimeResumeToken).not.toHaveBeenCalled()
  })

  it('falls back to the persisted resume token when no explicit token is given', async () => {
    mocks.getLastRuntimeResumeToken.mockReturnValue('persisted-token')

    const request = await buildClaudeCodeQueryRequestForAgentSession('session-1')

    expect(request?.options.resume).toBe('persisted-token')
    expect(mocks.getLastRuntimeResumeToken).toHaveBeenCalledWith('session-1')
  })

  it('leaves resume undefined when neither an explicit nor a persisted token exists', async () => {
    mocks.getLastRuntimeResumeToken.mockReturnValue(null)

    const request = await buildClaudeCodeQueryRequestForAgentSession('session-1')

    expect(request?.options.resume).toBeUndefined()
    expect(mocks.getLastRuntimeResumeToken).toHaveBeenCalledWith('session-1')
  })

  it('routes with the connection-scoped model override instead of the agent latest model', async () => {
    mocks.getModelByKey.mockImplementation((_providerId: string, modelId: string) => ({
      id: modelId,
      apiModelId: `${modelId}-api`
    }))

    // A live turn's connection pins the model captured at turn creation; the agent may have been
    // edited to a different model since (here: agent.model is still provider-1::model-1).
    const request = await buildClaudeCodeQueryRequestForAgentSession(
      'session-1',
      undefined,
      'provider-1::model-2' as any
    )

    expect(request?.sdkModelId).toBe('model-2-api')
    // The whole route follows the override — the unset plan/small defaults must pin to the captured
    // model too, not fall back to the agent's latest `provider-1::model-1`.
    expect(request?.settings.env).toMatchObject({
      ANTHROPIC_MODEL: 'model-2-api',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'model-2-api',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'model-2-api',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'model-2-api'
    })
  })

  it('pins explicit plan/small to the captured primary for an overridden connection instead of the latest edited sub-models', async () => {
    mocks.getModelByKey.mockImplementation((_providerId: string, modelId: string) => ({
      id: modelId,
      apiModelId: `${modelId}-api`
    }))
    // The agent's primary is still provider-1::model-1, but plan/small were edited to point at another
    // provider in the same begin-turn-before-open-stream window that pinned the connection to model-2.
    mocks.getAgent.mockReturnValue({
      id: 'agent-1',
      model: 'provider-1::model-1',
      planModel: 'openai::gpt-plan',
      smallModel: 'other::small'
    })

    const request = await buildClaudeCodeQueryRequestForAgentSession(
      'session-1',
      undefined,
      'provider-1::model-2' as any
    )

    // The captured turn only recorded its primary; the edited plan/small must NOT leak in. They pin to the
    // captured primary, so every ANTHROPIC_DEFAULT_* stays on model-2 and the cross-provider sub-models do
    // not force the captured connection onto the gateway route — it stays on the direct provider key.
    expect(request?.settings.env).toMatchObject({
      ANTHROPIC_MODEL: 'model-2-api',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'model-2-api',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'model-2-api',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'model-2-api',
      ANTHROPIC_API_KEY: 'api-key'
    })
    expect(mocks.apiGatewayEnsureKey).not.toHaveBeenCalled()
  })

  it('uses the provider Anthropic endpoint directly when all selected models belong to that provider', async () => {
    mocks.getLastRuntimeResumeToken.mockReturnValue(null)

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

  it('injects the Ollama dummy token for direct Anthropic routing when no API key is configured', async () => {
    mocks.getAgent.mockReturnValue({ id: 'agent-1', model: 'ollama::qwen3:14b' })
    mocks.getProviderByProviderId.mockReturnValue({
      id: 'ollama',
      presetProviderId: 'ollama',
      endpointConfigs: { 'anthropic-messages': { baseUrl: 'http://localhost:11434' } }
    })
    mocks.getModelByKey.mockReturnValue({ id: 'qwen3:14b', apiModelId: 'qwen3:14b' })
    mocks.getRotatedApiKey.mockReturnValue('')
    mocks.getLastRuntimeResumeToken.mockReturnValue(null)

    const request = await buildClaudeCodeQueryRequestForAgentSession('session-1')

    expect(request?.sdkModelId).toBe('qwen3:14b')
    expect(request?.settings.env).toMatchObject({
      ANTHROPIC_BASE_URL: 'http://localhost:11434',
      ANTHROPIC_API_KEY: 'ollama',
      ANTHROPIC_AUTH_TOKEN: 'ollama',
      ANTHROPIC_MODEL: 'qwen3:14b',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'qwen3:14b',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'qwen3:14b',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'qwen3:14b'
    })
    expect(mocks.apiGatewayStart).not.toHaveBeenCalled()
  })

  it('strips a trailing API version from Anthropic base URLs before launching Claude Code agents', async () => {
    mocks.getLastRuntimeResumeToken.mockReturnValue(null)
    mocks.getProviderByProviderId.mockReturnValue({
      id: 'provider-1',
      endpointConfigs: { 'anthropic-messages': { baseUrl: 'https://anthropic.example.com/v1' } }
    })
    mocks.resolveEffectiveEndpoint.mockReturnValue({ baseUrl: 'https://anthropic.example.com/v1' })

    const request = await buildClaudeCodeQueryRequestForAgentSession('session-1')

    expect(request?.settings.env).toMatchObject({
      ANTHROPIC_BASE_URL: 'https://anthropic.example.com'
    })
  })

  it('routes non-Anthropic provider models through the local API gateway', async () => {
    mocks.getAgent.mockReturnValue({
      id: 'agent-1',
      model: 'openai::gpt-main',
      planModel: 'openai::gpt-plan',
      smallModel: 'other::small'
    })
    mocks.getProviderByProviderId.mockImplementation((providerId: string) => ({
      id: providerId,
      endpointConfigs: { 'openai-chat-completions': { baseUrl: `https://${providerId}.example.com` } }
    }))
    mocks.getModelByKey.mockImplementation((_providerId: string, modelId: string) => ({
      id: modelId,
      apiModelId: `${modelId}-api`
    }))
    mocks.apiGatewayIsRunning.mockReturnValue(false)
    mocks.apiGatewayGetCurrentConfig.mockReturnValue({ host: '127.0.0.1', port: 24444, apiKey: 'gateway-key' })
    mocks.getLastRuntimeResumeToken.mockReturnValue(null)

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

  it('pins cross-provider plan/small models onto the primary for an external-cli (claude-code) agent instead of routing through the gateway', async () => {
    mocks.getAgent.mockReturnValue({
      id: 'agent-1',
      model: 'claude-code::sonnet',
      planModel: 'openai::gpt-plan',
      smallModel: 'other::small'
    })
    mocks.getProviderByProviderId.mockImplementation((providerId: string) =>
      providerId === 'claude-code'
        ? {
            id: 'claude-code',
            authMethods: ['external-cli'],
            endpointConfigs: { 'anthropic-messages': { baseUrl: 'https://api.anthropic.com' } }
          }
        : {
            id: providerId,
            endpointConfigs: { 'openai-chat-completions': { baseUrl: `https://${providerId}.example.com` } }
          }
    )
    mocks.getModelByKey.mockImplementation((_providerId: string, modelId: string) => ({
      id: modelId,
      apiModelId: `${modelId}-api`
    }))
    mocks.getLastRuntimeResumeToken.mockReturnValue(null)

    const request = await buildClaudeCodeQueryRequestForAgentSession('session-1')

    // Stays on the subscription login: no gateway, no injected API key, and the
    // off-provider plan/small models collapse to the primary claude-code model.
    expect(mocks.apiGatewayEnsureKey).not.toHaveBeenCalled()
    expect(mocks.apiGatewayStart).not.toHaveBeenCalled()
    expect(request?.sdkModelId).toBe('sonnet-api')
    expect(request?.settings.env).toMatchObject({
      ANTHROPIC_MODEL: 'sonnet-api',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'sonnet-api',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'sonnet-api',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'sonnet-api'
    })
    expect(request?.settings.env).not.toHaveProperty('ANTHROPIC_API_KEY')
    expect(request?.settings.env).not.toHaveProperty('ANTHROPIC_BASE_URL')
  })

  it('routes Gemini provider models through the local API gateway', async () => {
    mocks.getAgent.mockReturnValue({
      id: 'agent-1',
      model: 'gemini::gemini-2.5-pro'
    })
    mocks.getProviderByProviderId.mockReturnValue({
      id: 'gemini',
      presetProviderId: 'gemini',
      defaultChatEndpoint: 'google-generate-content',
      authType: 'api-key',
      endpointConfigs: { 'google-generate-content': { baseUrl: 'https://generativelanguage.googleapis.com' } }
    })
    mocks.getModelByKey.mockReturnValue({ id: 'gemini-2.5-pro', apiModelId: 'gemini-2.5-pro' })
    mocks.getLastRuntimeResumeToken.mockReturnValue(null)

    const request = await buildClaudeCodeQueryRequestForAgentSession('session-1')

    expect(mocks.apiGatewayEnsureKey).toHaveBeenCalled()
    expect(mocks.apiGatewayStart).not.toHaveBeenCalled()
    expect(request?.sdkModelId).toBe('gemini:gemini-2.5-pro')
    expect(request?.settings.env).toMatchObject({
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:23333',
      ANTHROPIC_API_KEY: 'gateway-key',
      ANTHROPIC_AUTH_TOKEN: 'gateway-key',
      ANTHROPIC_MODEL: 'gemini:gemini-2.5-pro',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'gemini:gemini-2.5-pro',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'gemini:gemini-2.5-pro',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'gemini:gemini-2.5-pro'
    })
  })
})
