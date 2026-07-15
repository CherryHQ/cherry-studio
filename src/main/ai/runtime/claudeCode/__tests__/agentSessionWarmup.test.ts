import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSessionById: vi.fn(),
  getAgent: vi.fn(),
  getProviderByProviderId: vi.fn(),
  getModelByKey: vi.fn(),
  getRotatedApiKey: vi.fn(),
  getApiKeys: vi.fn(),
  getLastRuntimeResumeToken: vi.fn(),
  resolveEffectiveEndpoint: vi.fn(),
  buildSessionSettings: vi.fn(),
  buildSkillWhitelist: vi.fn(),
  findChannelBySessionId: vi.fn(),
  findMcpServerByIdOrName: vi.fn(),
  preferenceGet: vi.fn(),
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
    getRotatedApiKey: mocks.getRotatedApiKey,
    getApiKeys: mocks.getApiKeys
  }
}))

vi.mock('@data/services/ModelService', () => ({
  modelService: { getByKey: mocks.getModelByKey }
}))

vi.mock('@data/services/AgentSessionMessageService', () => ({
  agentSessionMessageService: { getLastRuntimeResumeToken: mocks.getLastRuntimeResumeToken }
}))

vi.mock('@data/services/McpServerService', () => ({
  mcpServerService: { findByIdOrName: mocks.findMcpServerByIdOrName }
}))

vi.mock('@data/services/AgentChannelService', () => ({
  agentChannelService: { findBySessionId: mocks.findChannelBySessionId }
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
      if (name === 'PreferenceService') {
        return { get: mocks.preferenceGet }
      }
      throw new Error(`Unexpected application.get(${name})`)
    })
  }
}))

vi.mock('../../provider/endpoint', () => ({
  resolveEffectiveEndpoint: mocks.resolveEffectiveEndpoint
}))

vi.mock('../settingsBuilder', () => ({
  buildClaudeCodeSessionSettings: mocks.buildSessionSettings,
  buildSkillWhitelist: mocks.buildSkillWhitelist
}))

const { buildClaudeCodeQueryRequestForAgentSession, deriveConnectionConfig } = await import('../agentSessionWarmup')

describe('buildClaudeCodeQueryRequestForAgentSession resume-token precedence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSessionById.mockReturnValue({
      id: 'session-1',
      agentId: 'agent-1',
      workspace: { type: 'user', path: '/workspace/project' }
    })
    mocks.getAgent.mockReturnValue({ id: 'agent-1', model: 'provider-1::model-1' })
    mocks.getProviderByProviderId.mockReturnValue({
      id: 'provider-1',
      endpointConfigs: { 'anthropic-messages': { baseUrl: 'https://anthropic.example.com' } }
    })
    mocks.getModelByKey.mockReturnValue({ id: 'model-1', apiModelId: 'claude-sonnet' })
    mocks.resolveEffectiveEndpoint.mockReturnValue({ baseUrl: 'https://api.example.com' })
    mocks.getRotatedApiKey.mockReturnValue('api-key')
    mocks.getApiKeys.mockReturnValue([{ key: 'api-key', isEnabled: true }])
    mocks.buildSkillWhitelist.mockResolvedValue([])
    mocks.findChannelBySessionId.mockReturnValue(null)
    mocks.findMcpServerByIdOrName.mockReturnValue(undefined)
    mocks.preferenceGet.mockReturnValue(undefined)
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

  it('captures the baseline from the same agent snapshot that materializes the request', async () => {
    const materializedAgent = {
      id: 'agent-1',
      model: 'provider-1::model-1',
      disabledTools: [],
      mcps: [],
      configuration: { max_turns: 1 }
    }
    const editedAgent = {
      ...materializedAgent,
      configuration: { max_turns: 2 }
    }
    mocks.getAgent.mockReturnValue(materializedAgent)
    mocks.buildSessionSettings.mockImplementationOnce(async (_session, _provider, _options, agentSnapshot) => {
      expect(agentSnapshot).toBe(materializedAgent)
      // Simulate an agent edit while the async settings builder is still materializing the request.
      mocks.getAgent.mockReturnValue(editedAgent)
      return { maxTurns: agentSnapshot.configuration.max_turns, skills: [] }
    })

    const request = await buildClaudeCodeQueryRequestForAgentSession('session-1')
    const current = await deriveConnectionConfig('session-1')

    expect(request?.settings.maxTurns).toBe(1)
    expect(current.ok).toBe(true)
    if (!request || !current.ok) throw new Error('expected request and current config')
    expect(request.connectionConfig.rebuildSignature).not.toBe(current.config.rebuildSignature)
  })

  it('captures the channel binding that materializes the request and rebuilds after a later binding', async () => {
    mocks.getAgent.mockReturnValue({
      id: 'agent-1',
      model: 'provider-1::model-1',
      disabledTools: [],
      mcps: [],
      configuration: { builtin_role: 'assistant' }
    })
    mocks.buildSessionSettings.mockImplementationOnce(async (_session, _provider, options) => {
      expect(options?.linkedChannelSnapshot).toBeNull()
      // Simulate an external channel binding while settings are still being materialized.
      mocks.findChannelBySessionId.mockReturnValue({ id: 'channel-1', sessionId: 'session-1' })
      return { env: {}, skills: [] }
    })

    const request = await buildClaudeCodeQueryRequestForAgentSession('session-1')
    const current = await deriveConnectionConfig('session-1')

    expect(current.ok).toBe(true)
    if (!request || !current.ok) throw new Error('expected request and current config')
    expect(request.connectionConfig.rebuildSignature).not.toBe(current.config.rebuildSignature)
  })

  it('captures provider and model facts from the route materialized before a connect-time edit', async () => {
    const materializedProvider = {
      id: 'provider-1',
      endpointConfigs: { 'anthropic-messages': { baseUrl: 'https://old.example.com' } }
    }
    const editedProvider = {
      id: 'provider-1',
      endpointConfigs: { 'anthropic-messages': { baseUrl: 'https://new.example.com' } }
    }
    mocks.getProviderByProviderId.mockReturnValue(materializedProvider)
    mocks.getModelByKey.mockReturnValue({ id: 'model-1', apiModelId: 'old-model' })
    mocks.resolveEffectiveEndpoint.mockImplementation((provider) => ({
      baseUrl: provider.endpointConfigs['anthropic-messages'].baseUrl
    }))
    mocks.buildSessionSettings.mockImplementationOnce(async () => {
      // Simulate provider/model edits while the async settings builder is still materializing.
      mocks.getProviderByProviderId.mockReturnValue(editedProvider)
      mocks.getModelByKey.mockReturnValue({ id: 'model-1', apiModelId: 'new-model' })
      return { env: {}, skills: [] }
    })

    const request = await buildClaudeCodeQueryRequestForAgentSession('session-1')
    const current = await deriveConnectionConfig('session-1')

    expect(request?.settings.env).toMatchObject({
      ANTHROPIC_BASE_URL: 'https://old.example.com',
      ANTHROPIC_MODEL: 'old-model'
    })
    expect(current.ok).toBe(true)
    if (!request || !current.ok) throw new Error('expected request and current config')
    expect(request.connectionConfig.rebuildSignature).not.toBe(current.config.rebuildSignature)
  })

  it('captures MCP definition facts from the snapshot materialized before a connect-time edit', async () => {
    const materializedServer = {
      id: 'mcp-1',
      name: 'server',
      type: 'stdio',
      command: 'npx old-server'
    }
    const editedServer = { ...materializedServer, command: 'npx new-server' }
    mocks.getAgent.mockReturnValue({
      id: 'agent-1',
      model: 'provider-1::model-1',
      disabledTools: [],
      mcps: ['mcp-1'],
      configuration: {}
    })
    mocks.findMcpServerByIdOrName.mockReturnValue(materializedServer)
    mocks.buildSessionSettings.mockImplementationOnce(async (_session, _provider, options) => {
      expect(options?.mcpServerSnapshots?.get('mcp-1')).toBe(materializedServer)
      // Simulate an MCP definition edit while the async settings builder is still materializing.
      mocks.findMcpServerByIdOrName.mockReturnValue(editedServer)
      return { env: {}, skills: [] }
    })

    const request = await buildClaudeCodeQueryRequestForAgentSession('session-1')
    const current = await deriveConnectionConfig('session-1')

    expect(current.ok).toBe(true)
    if (!request || !current.ok) throw new Error('expected request and current config')
    expect(request.connectionConfig.rebuildSignature).not.toBe(current.config.rebuildSignature)
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

  it('fingerprints the enabled key set, stable across rotation and sensitive to key-set edits', async () => {
    mocks.getApiKeys.mockReturnValue([
      { key: 'key-a', isEnabled: true },
      { key: 'key-b', isEnabled: true }
    ])
    mocks.getRotatedApiKey.mockReturnValueOnce('key-a').mockReturnValueOnce('key-b')

    const first = await buildClaudeCodeQueryRequestForAgentSession('session-1')
    const second = await buildClaudeCodeQueryRequestForAgentSession('session-1')

    // Rotation picked different keys, but the enabled SET is identical → same fingerprint.
    expect(first?.settings.env?.ANTHROPIC_API_KEY).toBe('key-a')
    expect(second?.settings.env?.ANTHROPIC_API_KEY).toBe('key-b')
    expect(first?.credentialsFingerprint).toBe(second?.credentialsFingerprint)

    mocks.getApiKeys.mockReturnValue([{ key: 'key-a', isEnabled: true }])
    const afterKeyRemoval = await buildClaudeCodeQueryRequestForAgentSession('session-1')

    expect(afterKeyRemoval?.credentialsFingerprint).not.toBe(first?.credentialsFingerprint)
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

describe('deriveConnectionConfig', () => {
  const sessionWithWorkspace = {
    id: 'session-1',
    agentId: 'agent-1',
    workspace: { type: 'user', path: '/workspace/project' }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSessionById.mockReturnValue(sessionWithWorkspace)
    mocks.getAgent.mockReturnValue({
      id: 'agent-1',
      model: 'provider-1::model-1',
      disabledTools: [],
      mcps: [],
      configuration: {}
    })
    mocks.getProviderByProviderId.mockReturnValue({
      id: 'provider-1',
      endpointConfigs: { 'anthropic-messages': { baseUrl: 'https://anthropic.example.com' } }
    })
    mocks.getModelByKey.mockImplementation((_providerId: string, modelId: string) => ({
      id: modelId,
      apiModelId: `${modelId}-api`
    }))
    mocks.resolveEffectiveEndpoint.mockReturnValue({ baseUrl: 'https://api.example.com' })
    mocks.getApiKeys.mockReturnValue([{ key: 'api-key', isEnabled: true }])
    mocks.buildSkillWhitelist.mockResolvedValue([])
    mocks.findChannelBySessionId.mockReturnValue(null)
    mocks.findMcpServerByIdOrName.mockReturnValue(undefined)
    mocks.preferenceGet.mockReturnValue(undefined)
    mocks.apiGatewayGetCurrentConfig.mockReturnValue({ host: '127.0.0.1', port: 23333 })
  })

  async function deriveSignature() {
    const result = await deriveConnectionConfig('session-1')
    if (!result.ok) throw new Error('expected ok derive')
    return result.config
  }

  it('is a pure read: no rotation advance, no gateway effects, no settings materialization', async () => {
    const result = await deriveConnectionConfig('session-1')

    expect(result.ok).toBe(true)
    expect(mocks.getRotatedApiKey).not.toHaveBeenCalled()
    expect(mocks.apiGatewayEnsureKey).not.toHaveBeenCalled()
    expect(mocks.apiGatewayStart).not.toHaveBeenCalled()
    // mkdir / builtin-agent provisioning / shared snapshot update all live inside
    // buildClaudeCodeSessionSettings — derive must never enter it.
    expect(mocks.buildSessionSettings).not.toHaveBeenCalled()
  })

  it('does not start the gateway even when the route resolves to it', async () => {
    mocks.getAgent.mockReturnValue({
      id: 'agent-1',
      model: 'provider-1::model-1',
      planModel: 'other-provider::gpt-plan',
      disabledTools: [],
      mcps: [],
      configuration: {}
    })
    mocks.getProviderByProviderId.mockImplementation((providerId: string) => ({ id: providerId }))

    const result = await deriveConnectionConfig('session-1')

    expect(result.ok).toBe(true)
    expect(mocks.apiGatewayEnsureKey).not.toHaveBeenCalled()
    expect(mocks.apiGatewayStart).not.toHaveBeenCalled()
    // The gateway fingerprint reads the persisted preference instead of ensureValidApiKey.
    expect(mocks.preferenceGet).toHaveBeenCalledWith('feature.api_gateway.api_key')
  })

  it('is stable across repeated derivation and across key rotation', async () => {
    const first = await deriveSignature()
    const second = await deriveSignature()

    expect(second.rebuildSignature).toBe(first.rebuildSignature)
  })

  it('changes the rebuild signature for each rebuild-group input', async () => {
    const base = await deriveSignature()

    mocks.findChannelBySessionId.mockReturnValue({ id: 'channel-1', sessionId: 'session-1' })
    const channelChanged = await deriveSignature()
    expect(channelChanged.rebuildSignature).not.toBe(base.rebuildSignature)
    mocks.findChannelBySessionId.mockReturnValue(null)

    mocks.getSessionById.mockReturnValue({ ...sessionWithWorkspace, workspace: { type: 'user', path: '/elsewhere' } })
    const workspaceChanged = await deriveSignature()
    expect(workspaceChanged.rebuildSignature).not.toBe(base.rebuildSignature)
    mocks.getSessionById.mockReturnValue(sessionWithWorkspace)

    mocks.buildSkillWhitelist.mockResolvedValue(['new-skill'])
    const skillsChanged = await deriveSignature()
    expect(skillsChanged.rebuildSignature).not.toBe(base.rebuildSignature)
    mocks.buildSkillWhitelist.mockResolvedValue([])

    mocks.getAgent.mockReturnValue({
      id: 'agent-1',
      model: 'provider-1::model-1',
      planModel: 'provider-1::model-2',
      disabledTools: [],
      mcps: [],
      configuration: {}
    })
    const planModelChanged = await deriveSignature()
    expect(planModelChanged.rebuildSignature).not.toBe(base.rebuildSignature)

    mocks.getAgent.mockReturnValue({
      id: 'agent-1',
      model: 'provider-1::model-1',
      disabledTools: [],
      mcps: [],
      configuration: { max_turns: 5 }
    })
    const maxTurnsChanged = await deriveSignature()
    expect(maxTurnsChanged.rebuildSignature).not.toBe(base.rebuildSignature)

    mocks.getAgent.mockReturnValue({
      id: 'agent-1',
      model: 'provider-1::model-1',
      disabledTools: [],
      mcps: [],
      configuration: { bootstrap_completed: false }
    })
    const bootstrapChanged = await deriveSignature()
    expect(bootstrapChanged.rebuildSignature).not.toBe(base.rebuildSignature)

    mocks.getAgent.mockReturnValue({
      id: 'agent-1',
      model: 'provider-1::model-1',
      disabledTools: ['WebSearch'],
      mcps: [],
      configuration: {}
    })
    const disabledToolsChanged = await deriveSignature()
    expect(disabledToolsChanged.rebuildSignature).not.toBe(base.rebuildSignature)

    mocks.getAgent.mockReturnValue({
      id: 'agent-1',
      model: 'provider-1::model-1',
      disabledTools: [],
      mcps: ['mcp-1'],
      configuration: {}
    })
    mocks.findMcpServerByIdOrName.mockReturnValue({
      id: 'mcp-1',
      name: 'server',
      type: 'stdio',
      command: 'npx old-server'
    })
    const withMcp = await deriveSignature()
    expect(withMcp.rebuildSignature).not.toBe(base.rebuildSignature)

    // Same MCP id, edited definition — the definition facts must be signed, not just the id.
    mocks.findMcpServerByIdOrName.mockReturnValue({
      id: 'mcp-1',
      name: 'server',
      type: 'stdio',
      command: 'npx new-server'
    })
    const mcpDefinitionChanged = await deriveSignature()
    expect(mcpDefinitionChanged.rebuildSignature).not.toBe(withMcp.rebuildSignature)
  })

  it('keeps permission mode live-only while disabled tools also require a rebuild', async () => {
    const base = await deriveSignature()

    mocks.getAgent.mockReturnValue({
      id: 'agent-1',
      model: 'provider-1::model-1',
      disabledTools: [],
      mcps: [],
      configuration: { permission_mode: 'acceptEdits' }
    })
    const policyChanged = await deriveSignature()

    expect(policyChanged.rebuildSignature).toBe(base.rebuildSignature)
    expect(policyChanged.live.toolPolicy).toEqual({
      permissionMode: 'acceptEdits',
      disabledTools: [],
      mcps: []
    })
    expect(base.live.toolPolicy.permissionMode).toBeNull()

    mocks.getAgent.mockReturnValue({
      id: 'agent-1',
      model: 'provider-1::model-1',
      disabledTools: ['WebSearch'],
      mcps: [],
      configuration: { permission_mode: 'acceptEdits' }
    })
    const disabledToolsChanged = await deriveSignature()

    expect(disabledToolsChanged.rebuildSignature).not.toBe(policyChanged.rebuildSignature)
    expect(disabledToolsChanged.live.toolPolicy.disabledTools).toEqual(['WebSearch'])

    mocks.getAgent.mockReturnValue({
      id: 'agent-1',
      model: 'provider-1::model-1',
      disabledTools: [],
      mcps: [],
      configuration: { permission_mode: 'acceptEdits' }
    })
    const toolReenabled = await deriveSignature()
    expect(toolReenabled.rebuildSignature).toBe(policyChanged.rebuildSignature)
  })

  it('reports unroutable for deleted agents, missing workspaces and deleted provider rows', async () => {
    mocks.getAgent.mockReturnValue(undefined)
    expect(await deriveConnectionConfig('session-1')).toEqual({ ok: false, reason: 'unroutable' })

    mocks.getAgent.mockReturnValue({ id: 'agent-1', model: 'provider-1::model-1', configuration: {} })
    mocks.getSessionById.mockReturnValue({ id: 'session-1', agentId: 'agent-1' })
    expect(await deriveConnectionConfig('session-1')).toEqual({ ok: false, reason: 'unroutable' })

    mocks.getSessionById.mockReturnValue(sessionWithWorkspace)
    mocks.getProviderByProviderId.mockImplementation(() => {
      throw new Error('Provider not found')
    })
    expect(await deriveConnectionConfig('session-1')).toEqual({ ok: false, reason: 'unroutable' })
  })
})
