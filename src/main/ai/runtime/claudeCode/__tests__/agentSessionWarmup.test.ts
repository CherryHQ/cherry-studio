import { REASONING_FORMAT_PROFILES } from '@cherrystudio/provider-registry'
import { ENDPOINT_TYPE, type EndpointType, type Model, MODEL_CAPABILITY } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSessionById: vi.fn(),
  getAgent: vi.fn(),
  getProviderByProviderId: vi.fn(),
  getModelByKey: vi.fn(),
  resolveApiKey: vi.fn(),
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
  apiGatewayEnsureRunning: vi.fn(),
  apiGatewayGetCurrentConfig: vi.fn(),
  apiGatewayGetAgentSessionUsageHeaders: vi.fn(),
  apiGatewayGetInternalRequestToken: vi.fn(),
  resolveReasoningProfile: vi.fn(),
  getAppLanguage: vi.fn(),
  getProxyEnvironment: vi.fn(),
  getClaudeCodeLoginShellEnvironment: vi.fn(),
  ensureTranscriptAvailableForWorkspace: vi.fn(),
  getTurnTrustedNotifyChannels: vi.fn()
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
    resolveApiKey: mocks.resolveApiKey,
    getApiKeys: mocks.getApiKeys
  }
}))

vi.mock('@data/services/ModelService', () => ({
  modelService: { getByKey: mocks.getModelByKey }
}))

vi.mock('@data/services/AgentSessionMessageService', () => ({
  agentSessionMessageService: { getLastRuntimeResumeToken: mocks.getLastRuntimeResumeToken }
}))

vi.mock('@data/services/ProviderRegistryService', () => ({
  providerRegistryService: { resolveReasoningProfile: mocks.resolveReasoningProfile }
}))

vi.mock('@data/services/McpServerService', () => ({
  mcpServerService: { findByIdOrName: mocks.findMcpServerByIdOrName }
}))

vi.mock('@data/services/AgentChannelService', () => ({
  agentChannelService: { findBySessionId: mocks.findChannelBySessionId }
}))

vi.mock('@application', () => ({
  application: {
    getPath: vi.fn((name: string) => {
      if (name === 'feature.agents.claude.root') return '/app/Data/Agents/.claude'
      throw new Error(`Unexpected application.getPath(${name})`)
    }),
    get: vi.fn((name: string) => {
      if (name === 'ApiGatewayService') {
        return {
          ensureValidApiKey: mocks.apiGatewayEnsureKey,
          isRunning: mocks.apiGatewayIsRunning,
          start: mocks.apiGatewayStart,
          ensureRunning: mocks.apiGatewayEnsureRunning,
          getCurrentConfig: mocks.apiGatewayGetCurrentConfig,
          getAgentSessionUsageHeaders: mocks.apiGatewayGetAgentSessionUsageHeaders,
          getInternalRequestToken: mocks.apiGatewayGetInternalRequestToken
        }
      }
      if (name === 'PreferenceService') {
        return { get: mocks.preferenceGet }
      }
      if (name === 'AgentSessionRuntimeService') {
        return { getTurnTrustedNotifyChannels: mocks.getTurnTrustedNotifyChannels }
      }
      throw new Error(`Unexpected application.get(${name})`)
    })
  }
}))

vi.mock('@main/i18n', () => ({
  getAppLanguage: mocks.getAppLanguage
}))

vi.mock('@main/services/proxy/proxyEnv', () => ({
  CHERRY_NODE_PROXY_BYPASS_RULES_ENV: 'CHERRY_STUDIO_NODE_PROXY_BYPASS_RULES',
  CHERRY_NODE_PROXY_RULES_ENV: 'CHERRY_STUDIO_NODE_PROXY_RULES',
  getProxyEnvironment: mocks.getProxyEnvironment
}))

vi.mock('../../../provider/endpoint', () => ({
  resolveEffectiveEndpoint: mocks.resolveEffectiveEndpoint
}))

vi.mock('../settingsBuilder', () => ({
  buildClaudeCodeSessionSettings: mocks.buildSessionSettings,
  buildSkillWhitelist: mocks.buildSkillWhitelist,
  getClaudeCodeLoginShellEnvironment: mocks.getClaudeCodeLoginShellEnvironment
}))

vi.mock('../claudeProjectDirectory', () => ({
  ensureTranscriptAvailableForWorkspace: mocks.ensureTranscriptAvailableForWorkspace
}))

const {
  buildClaudeCodeQueryRequestForAgentSession,
  buildClaudeCodeWarmQueryRequestForAgentSession,
  deriveConnectionConfig
} = await import('../agentSessionWarmup')
const { ApiGatewayNotRunningError } = await import('../../agentApiGateway')

function resolveTestEffectiveEndpoint(provider: Provider, model: Model, preferredEndpointType?: EndpointType) {
  const preferred =
    preferredEndpointType &&
    model.endpointTypes?.includes(preferredEndpointType) &&
    provider.endpointConfigs?.[preferredEndpointType]?.baseUrl
      ? preferredEndpointType
      : undefined
  const endpointType =
    preferred ??
    model.endpointTypes?.[0] ??
    provider.defaultChatEndpoint ??
    (provider.endpointConfigs?.[ENDPOINT_TYPE.ANTHROPIC_MESSAGES] ? ENDPOINT_TYPE.ANTHROPIC_MESSAGES : undefined)
  return {
    endpointType,
    baseUrl: (endpointType && provider.endpointConfigs?.[endpointType]?.baseUrl) || 'https://api.example.com'
  }
}

describe('buildClaudeCodeQueryRequestForAgentSession resume-token precedence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveReasoningProfile.mockReturnValue({
      format: 'anthropic',
      wire: REASONING_FORMAT_PROFILES.anthropic.wire
    })
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
    mocks.getModelByKey.mockReturnValue({ id: 'model-1', apiModelId: 'claude-sonnet', contextWindow: 128_000 })
    mocks.resolveEffectiveEndpoint.mockImplementation(resolveTestEffectiveEndpoint)
    mocks.resolveApiKey.mockReturnValue({
      value: 'api-key',
      apiKeySelection: { attribution: 'explicit', id: 'key-a', masked: 'api-****-key' }
    })
    mocks.getApiKeys.mockReturnValue([{ key: 'api-key', isEnabled: true }])
    mocks.buildSkillWhitelist.mockResolvedValue([])
    mocks.findChannelBySessionId.mockReturnValue(null)
    mocks.findMcpServerByIdOrName.mockReturnValue(undefined)
    mocks.preferenceGet.mockReturnValue(undefined)
    mocks.apiGatewayEnsureKey.mockResolvedValue('gateway-key')
    mocks.apiGatewayIsRunning.mockReturnValue(true)
    mocks.apiGatewayStart.mockResolvedValue(undefined)
    mocks.apiGatewayEnsureRunning.mockResolvedValue(undefined)
    mocks.apiGatewayGetCurrentConfig.mockReturnValue({
      enabled: true,
      host: '127.0.0.1',
      port: 23333,
      apiKey: 'gateway-key'
    })
    mocks.apiGatewayGetAgentSessionUsageHeaders.mockReturnValue({
      'x-cherry-agent-session-id': 'session-1',
      'x-cherry-internal-usage-token': 'internal-token'
    })
    mocks.getAppLanguage.mockReturnValue('en-US')
    mocks.getProxyEnvironment.mockReturnValue({})
    mocks.getClaudeCodeLoginShellEnvironment.mockResolvedValue({})
    mocks.ensureTranscriptAvailableForWorkspace.mockResolvedValue('present')
    mocks.apiGatewayGetInternalRequestToken.mockReturnValue('internal-request-token')
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
    expect(mocks.ensureTranscriptAvailableForWorkspace).toHaveBeenCalledWith(
      '/app/Data/Agents/.claude',
      '/workspace/project',
      'explicit-token'
    )
  })

  it('falls back to the persisted resume token when no explicit token is given', async () => {
    mocks.getLastRuntimeResumeToken.mockReturnValue('persisted-token')

    const request = await buildClaudeCodeQueryRequestForAgentSession('session-1')

    expect(request?.options.resume).toBe('persisted-token')
    expect(mocks.getLastRuntimeResumeToken).toHaveBeenCalledWith('session-1')
  })

  it('keeps resume best effort when transcript relocation fails', async () => {
    mocks.ensureTranscriptAvailableForWorkspace.mockRejectedValueOnce(new Error('copy failed'))

    const request = await buildClaudeCodeQueryRequestForAgentSession('session-1', 'explicit-token')

    expect(request?.options.resume).toBe('explicit-token')
  })

  it('leaves resume undefined when neither an explicit nor a persisted token exists', async () => {
    mocks.getLastRuntimeResumeToken.mockReturnValue(null)

    const request = await buildClaudeCodeQueryRequestForAgentSession('session-1')

    expect(request?.options.resume).toBeUndefined()
    expect(mocks.getLastRuntimeResumeToken).toHaveBeenCalledWith('session-1')
    expect(mocks.ensureTranscriptAvailableForWorkspace).not.toHaveBeenCalled()
  })

  it('passes the per-turn knowledge selection into settings and the warm signature', async () => {
    const request = await buildClaudeCodeQueryRequestForAgentSession(
      'session-1',
      undefined,
      undefined,
      'default',
      false,
      ['kb-selected']
    )

    expect(mocks.buildSessionSettings).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ contextWindow: 128_000, knowledgeBaseIds: ['kb-selected'] }),
      expect.anything()
    )
    expect(request?.knowledgeBaseIds).toEqual(['kb-selected'])
  })

  it('passes native image support from the captured connection model into settings', async () => {
    mocks.getModelByKey.mockReturnValue({
      id: 'model-1',
      apiModelId: 'claude-sonnet',
      capabilities: [MODEL_CAPABILITY.IMAGE_RECOGNITION]
    })

    await buildClaudeCodeQueryRequestForAgentSession('session-1')

    expect(mocks.buildSessionSettings).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ supportsImages: true }),
      expect.anything()
    )

    mocks.getModelByKey.mockReturnValue({ id: 'model-1', apiModelId: 'text-only', capabilities: [] })

    await buildClaudeCodeQueryRequestForAgentSession('session-1')

    expect(mocks.buildSessionSettings).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ supportsImages: false }),
      expect.anything()
    )
  })

  it('pins the rebuild baseline to the context window used to materialize settings', async () => {
    const model = { id: 'model-1', apiModelId: 'claude-sonnet', contextWindow: 128_000 }
    mocks.getModelByKey.mockReturnValue(model)
    mocks.buildSessionSettings.mockImplementationOnce(async (_session, _provider, options) => {
      expect(options).toEqual(expect.objectContaining({ contextWindow: 128_000 }))
      model.contextWindow = 1_000_000
      return { env: {} }
    })

    const request = await buildClaudeCodeQueryRequestForAgentSession('session-1')
    model.contextWindow = 128_000
    const current = await deriveConnectionConfig('session-1')
    if (!request || !current.ok) throw new Error('expected materialized request and current config')

    expect(request.connectionConfig.rebuildSignature).toBe(current.config.rebuildSignature)
    expect(request.connectionConfig.rebuildFactFingerprints.contextWindow).toBe(
      current.config.rebuildFactFingerprints.contextWindow
    )
  })

  it('captures the proxy fingerprint from the environment that materializes settings', async () => {
    mocks.getProxyEnvironment.mockReturnValue({ HTTP_PROXY: 'http://proxy-new.example.com:8080' })
    mocks.buildSessionSettings.mockResolvedValueOnce({
      env: { HTTP_PROXY: 'http://proxy-old.example.com:8080' }
    })

    const request = await buildClaudeCodeQueryRequestForAgentSession('session-1')
    const current = await deriveConnectionConfig('session-1')

    if (!request || !current.ok) throw new Error('expected materialized request and current config')
    expect(request.connectionConfig.rebuildFactFingerprints.proxyEnvironment).not.toBe(
      current.config.rebuildFactFingerprints.proxyEnvironment
    )
  })

  it('uses the Agent static binding instead of the per-turn selection', async () => {
    mocks.getAgent.mockReturnValue({
      id: 'agent-1',
      model: 'provider-1::model-1',
      knowledgeBaseIds: ['kb-bound']
    })

    const request = await buildClaudeCodeQueryRequestForAgentSession(
      'session-1',
      undefined,
      undefined,
      'default',
      false,
      ['kb-selected']
    )

    expect(request?.knowledgeBaseIds).toEqual(['kb-bound'])
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

  it('strips ENABLE_TOOL_SEARCH when the connection model rejects dynamically-loaded tools', async () => {
    // The settings builder force-enables ToolSearch for every agent; the route must undo that for
    // models whose provider rejects dynamic tool declarations (Kimi non-K3 → tokenization failed).
    mocks.buildSessionSettings.mockResolvedValue({ env: { ENABLE_TOOL_SEARCH: 'auto' } })
    mocks.getModelByKey.mockReturnValue({ id: 'model-1', apiModelId: 'kimi-for-coding', contextWindow: 262_144 })

    const request = await buildClaudeCodeQueryRequestForAgentSession('session-1')

    expect(request?.settings.env).not.toHaveProperty('ENABLE_TOOL_SEARCH')
  })

  it('keeps ENABLE_TOOL_SEARCH for models that accept dynamically-loaded tools', async () => {
    mocks.buildSessionSettings.mockResolvedValue({ env: { ENABLE_TOOL_SEARCH: 'auto' } })
    mocks.getModelByKey.mockReturnValue({ id: 'model-1', apiModelId: 'kimi-k3', contextWindow: 262_144 })

    const request = await buildClaudeCodeQueryRequestForAgentSession('session-1')

    expect(request?.settings.env).toMatchObject({ ENABLE_TOOL_SEARCH: 'auto' })
  })

  it('gates ToolSearch on the per-turn connection model, not the agent model', async () => {
    // agent.model is Claude, but this turn's connection was captured on kimi-for-coding — the
    // toggle must follow the connection model (the one that actually receives the declarations).
    mocks.buildSessionSettings.mockResolvedValue({ env: { ENABLE_TOOL_SEARCH: 'auto' } })
    mocks.getModelByKey.mockImplementation((_providerId: string, modelId: string) => ({
      id: modelId,
      apiModelId: modelId === 'model-2' ? 'kimi-for-coding' : 'claude-sonnet',
      contextWindow: 262_144
    }))

    const request = await buildClaudeCodeQueryRequestForAgentSession(
      'session-1',
      undefined,
      'provider-1::model-2' as any
    )

    expect(request?.settings.env).toMatchObject({ ANTHROPIC_MODEL: 'kimi-for-coding' })
    expect(request?.settings.env).not.toHaveProperty('ENABLE_TOOL_SEARCH')
  })

  it('captures the baseline from the same agent snapshot that materializes the request', async () => {
    const materializedAgent = {
      id: 'agent-1',
      model: 'provider-1::model-1',
      disabledTools: [],
      mcps: [],
      configuration: { env_vars: { FOO: '1' } }
    }
    const editedAgent = {
      ...materializedAgent,
      configuration: { env_vars: { FOO: '2' } }
    }
    mocks.getAgent.mockReturnValue(materializedAgent)
    mocks.buildSessionSettings.mockImplementationOnce(async (_session, _provider, _options, agentSnapshot) => {
      expect(agentSnapshot).toBe(materializedAgent)
      // Simulate an agent edit while the async settings builder is still materializing the request.
      mocks.getAgent.mockReturnValue(editedAgent)
      return { env: agentSnapshot.configuration.env_vars, skills: [] }
    })

    const request = await buildClaudeCodeQueryRequestForAgentSession('session-1')
    const current = await deriveConnectionConfig('session-1')

    expect(request?.settings.env?.FOO).toBe('1')
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
      mocks.findChannelBySessionId.mockReturnValue({ id: 'channel-1', sessionId: 'session-1', agentId: 'agent-1' })
      return { env: {}, skills: [] }
    })

    const request = await buildClaudeCodeQueryRequestForAgentSession('session-1')
    const current = await deriveConnectionConfig('session-1')

    expect(current.ok).toBe(true)
    if (!request || !current.ok) throw new Error('expected request and current config')
    expect(request.connectionConfig.rebuildSignature).not.toBe(current.config.rebuildSignature)
  })

  it('carries the turn notification authority into the prewarm request that keys warm reuse', async () => {
    const notificationContext = {
      sourceChannel: null,
      channels: [{ id: 'channel-1', type: 'telegram' }],
      allowAnyOwnedChannel: false
    } as const
    mocks.getTurnTrustedNotifyChannels.mockReturnValue(notificationContext.channels)

    const warmRequest = await buildClaudeCodeWarmQueryRequestForAgentSession('session-1')

    expect(mocks.buildSessionSettings).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ notificationContext }),
      expect.anything()
    )
    expect(warmRequest?.notificationContext).toEqual(notificationContext)
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
      endpointType: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
      baseUrl: provider.endpointConfigs[ENDPOINT_TYPE.ANTHROPIC_MESSAGES].baseUrl
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
    mocks.resolveApiKey
      .mockReturnValueOnce({
        value: 'key-a',
        apiKeySelection: { attribution: 'explicit', id: 'key-a', masked: 'key-****-a' }
      })
      .mockReturnValueOnce({
        value: 'key-b',
        apiKeySelection: { attribution: 'explicit', id: 'key-b', masked: 'key-****-b' }
      })

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

  it('passes app attribution and provider extra headers to direct SDK requests with provider overrides', async () => {
    mocks.getProviderByProviderId.mockReturnValue({
      id: 'provider-1',
      endpointConfigs: { 'anthropic-messages': { baseUrl: 'https://anthropic.example.com' } },
      settings: {
        extraHeaders: {
          'http-referer': 'https://custom.example.com',
          'x-title': 'Custom App',
          'X-Provider': 'provider-value',
          'x-shared': 'provider-value'
        }
      }
    })
    mocks.buildSessionSettings.mockResolvedValueOnce({
      env: {
        ANTHROPIC_CUSTOM_HEADERS: 'X-Agent: agent-value\nX-Shared: agent-value'
      }
    })

    const request = await buildClaudeCodeQueryRequestForAgentSession('session-1')

    expect(request?.settings.env?.ANTHROPIC_CUSTOM_HEADERS).toBe(
      'http-referer: https://custom.example.com\nX-Agent: agent-value\nX-Provider: provider-value\nx-shared: provider-value\nx-title: Custom App'
    )
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
    expect(request?.settings.env?.ANTHROPIC_CUSTOM_HEADERS).toBe(
      'HTTP-Referer: https://cherry-ai.com\nX-Title: Cherry Studio'
    )
    expect(request?.usageCapture).toEqual({
      owner: 'agent-sdk',
      credentialReceipt: { attribution: 'explicit', id: 'key-a', masked: 'api-****-key' },
      providerId: 'provider-1',
      providerName: null,
      source: { type: 'agent', id: 'agent-1', name: null, icon: null },
      frozenModels: [
        {
          modelId: 'model-1',
          apiModelId: 'claude-sonnet',
          modelName: 'model-1',
          pricingSnapshot: null,
          aliases: ['claude-sonnet', 'model-1']
        }
      ]
    })
    expect(mocks.apiGatewayStart).not.toHaveBeenCalled()
  })

  it('routes an OpenCode Go OpenAI-compatible model through the gateway despite its Anthropic endpoint', async () => {
    mocks.getAgent.mockReturnValue({ id: 'agent-1', model: 'opencode::deepseek-v4-pro' })
    mocks.getProviderByProviderId.mockReturnValue({
      id: 'opencode',
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      endpointConfigs: {
        [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { baseUrl: 'https://opencode.ai/zen/go/v1' },
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://opencode.ai/zen/go/v1' }
      }
    })
    mocks.getModelByKey.mockReturnValue({
      id: 'deepseek-v4-pro',
      apiModelId: 'deepseek-v4-pro',
      endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]
    })
    mocks.getLastRuntimeResumeToken.mockReturnValue(null)

    const request = await buildClaudeCodeQueryRequestForAgentSession('session-1')

    expect(mocks.apiGatewayEnsureKey).toHaveBeenCalled()
    expect(request?.sdkModelId).toBe('opencode:deepseek-v4-pro')
    expect(request?.settings.env).toMatchObject({
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:23333',
      ANTHROPIC_MODEL: 'opencode:deepseek-v4-pro'
    })
    expect(request?.usageCapture).toEqual({ owner: 'provider-calls' })
  })

  it('routes a model that declares Anthropic Messages behind another dialect directly', async () => {
    // DeepSeek V4 Flash lists `openai-responses` first (in-app chat's default) and `anthropic-messages`
    // third. The Agent SDK speaks Messages natively, so it must not take the translating gateway hop.
    mocks.getAgent.mockReturnValue({ id: 'agent-1', model: 'deepseek::deepseek-v4-flash' })
    mocks.getProviderByProviderId.mockReturnValue({
      id: 'deepseek',
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      endpointConfigs: {
        [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { baseUrl: 'https://api.deepseek.com/anthropic' },
        [ENDPOINT_TYPE.OPENAI_RESPONSES]: { baseUrl: 'https://api.deepseek.com' }
      }
    })
    mocks.getModelByKey.mockReturnValue({
      id: 'deepseek-v4-flash',
      apiModelId: 'deepseek-v4-flash',
      endpointTypes: [
        ENDPOINT_TYPE.OPENAI_RESPONSES,
        ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
        ENDPOINT_TYPE.ANTHROPIC_MESSAGES
      ]
    })
    mocks.getLastRuntimeResumeToken.mockReturnValue(null)

    const request = await buildClaudeCodeQueryRequestForAgentSession('session-1')

    expect(mocks.apiGatewayEnsureKey).not.toHaveBeenCalled()
    expect(request?.sdkModelId).toBe('deepseek-v4-flash')
    expect(request?.settings.env).toMatchObject({
      ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
      ANTHROPIC_MODEL: 'deepseek-v4-flash'
    })
  })

  it('routes a declared Anthropic model through the gateway when the provider configures no Messages base URL', async () => {
    // Without a Messages base URL there is nothing to point ANTHROPIC_BASE_URL at; falling back to the
    // effective host would post Messages bodies at an OpenAI-compatible endpoint.
    mocks.getAgent.mockReturnValue({ id: 'agent-1', model: 'custom::relay-model' })
    mocks.getProviderByProviderId.mockReturnValue({
      id: 'custom',
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      endpointConfigs: { [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://relay.example.com' } }
    })
    mocks.getModelByKey.mockReturnValue({
      id: 'relay-model',
      apiModelId: 'relay-model',
      endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, ENDPOINT_TYPE.ANTHROPIC_MESSAGES]
    })
    mocks.getLastRuntimeResumeToken.mockReturnValue(null)

    const request = await buildClaudeCodeQueryRequestForAgentSession('session-1')

    expect(mocks.apiGatewayEnsureKey).toHaveBeenCalled()
    expect(request?.settings.env).toMatchObject({
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:23333',
      ANTHROPIC_MODEL: 'custom:relay-model'
    })
  })

  it('captures distinct same-provider models for direct-route usage attribution', async () => {
    mocks.getAgent.mockReturnValue({
      id: 'agent-1',
      model: 'provider-1::model-1',
      planModel: 'provider-1::model-2',
      smallModel: 'provider-1::model-3'
    })
    mocks.getModelByKey.mockImplementation((_providerId: string, modelId: string) => ({
      id: modelId,
      apiModelId: `${modelId}-api`
    }))
    mocks.getLastRuntimeResumeToken.mockReturnValue(null)

    const request = await buildClaudeCodeQueryRequestForAgentSession('session-1')

    expect(request?.settings.env).toMatchObject({
      ANTHROPIC_MODEL: 'model-1-api',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'model-2-api',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'model-3-api'
    })
    expect(request?.usageCapture).toMatchObject({
      owner: 'agent-sdk',
      frozenModels: [
        { modelId: 'model-1', apiModelId: 'model-1-api', aliases: ['model-1-api', 'model-1'] },
        { modelId: 'model-2', apiModelId: 'model-2-api', aliases: ['model-2-api', 'model-2'] },
        { modelId: 'model-3', apiModelId: 'model-3-api', aliases: ['model-3-api', 'model-3'] }
      ]
    })
  })

  it('appends [1m] for a >=1M model on an Anthropic-preset provider repointed at a custom proxy', async () => {
    // Provider derived from the Anthropic preset (presetProviderId stays 'anthropic') but its Base URL
    // was changed to a custom proxy — must NOT be treated as first-party, so the 1M suffix still applies.
    mocks.getProviderByProviderId.mockReturnValue({
      id: 'my-anthropic-proxy',
      presetProviderId: 'anthropic',
      endpointConfigs: { 'anthropic-messages': { baseUrl: 'https://anthropic.mycorp.com' } }
    })
    mocks.getModelByKey.mockReturnValue({ id: 'model-1', apiModelId: 'claude-sonnet', contextWindow: 1_000_000 })
    mocks.getLastRuntimeResumeToken.mockReturnValue(null)

    const request = await buildClaudeCodeQueryRequestForAgentSession('session-1')

    expect(request?.sdkModelId).toBe('claude-sonnet[1m]')
    expect(request?.settings.env).toMatchObject({
      ANTHROPIC_BASE_URL: 'https://anthropic.mycorp.com',
      ANTHROPIC_MODEL: 'claude-sonnet[1m]',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-sonnet[1m]',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet[1m]',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-sonnet[1m]'
    })
  })

  it('skips [1m] for a >=1M model on the first-party Anthropic endpoint (Claude Code manages it)', async () => {
    mocks.getProviderByProviderId.mockReturnValue({
      id: 'anthropic',
      presetProviderId: 'anthropic',
      endpointConfigs: { 'anthropic-messages': { baseUrl: 'https://api.anthropic.com' } }
    })
    mocks.getModelByKey.mockReturnValue({ id: 'model-1', apiModelId: 'claude-sonnet-4-5', contextWindow: 1_000_000 })
    mocks.getLastRuntimeResumeToken.mockReturnValue(null)

    const request = await buildClaudeCodeQueryRequestForAgentSession('session-1')

    expect(request?.sdkModelId).toBe('claude-sonnet-4-5')
    expect(request?.settings.env).toMatchObject({
      ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
      ANTHROPIC_MODEL: 'claude-sonnet-4-5'
    })
  })

  it('injects the Ollama dummy token for direct Anthropic routing when no API key is configured', async () => {
    mocks.getAgent.mockReturnValue({ id: 'agent-1', model: 'ollama::qwen3:14b' })
    mocks.getProviderByProviderId.mockReturnValue({
      id: 'ollama',
      presetProviderId: 'ollama',
      endpointConfigs: { 'anthropic-messages': { baseUrl: 'http://localhost:11434' } }
    })
    mocks.getModelByKey.mockReturnValue({ id: 'qwen3:14b', apiModelId: 'qwen3:14b' })
    mocks.resolveApiKey.mockReturnValue({ value: '', apiKeySelection: { attribution: 'unknown' } })
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
    mocks.resolveEffectiveEndpoint.mockReturnValue({
      endpointType: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
      baseUrl: 'https://anthropic.example.com/v1'
    })

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
      endpointConfigs: { 'openai-chat-completions': { baseUrl: `https://${providerId}.example.com` } },
      settings: { extraHeaders: { 'X-Upstream-Secret': `${providerId}-secret` } }
    }))
    mocks.getModelByKey.mockImplementation((_providerId: string, modelId: string) => ({
      id: modelId,
      apiModelId: `${modelId}-api`
    }))
    mocks.apiGatewayGetCurrentConfig.mockReturnValue({
      enabled: true,
      host: '127.0.0.1',
      port: 24444,
      apiKey: 'gateway-key'
    })
    mocks.getLastRuntimeResumeToken.mockReturnValue(null)

    const request = await buildClaudeCodeQueryRequestForAgentSession('session-1')

    expect(mocks.apiGatewayEnsureKey).toHaveBeenCalled()
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
    expect(request?.settings.env?.ANTHROPIC_CUSTOM_HEADERS).toBe(
      'x-cherry-agent-session-id: session-1\nx-cherry-internal-usage-token: internal-token'
    )
    expect(request?.usageCapture).toEqual({ owner: 'provider-calls' })
  })

  // The gateway is never started implicitly (#18521); the caller turns this into the prompt that
  // offers to enable it, and the failed route must leave no persisted key behind.
  it('fails a gateway route instead of starting the gateway the user disabled', async () => {
    mocks.getAgent.mockReturnValue({ id: 'agent-1', model: 'openai::gpt-main' })
    mocks.getProviderByProviderId.mockReturnValue({
      id: 'openai',
      endpointConfigs: { 'openai-chat-completions': { baseUrl: 'https://openai.example.com' } }
    })
    mocks.getModelByKey.mockReturnValue({ id: 'gpt-main', apiModelId: 'gpt-main-api' })
    mocks.apiGatewayGetCurrentConfig.mockReturnValue({ enabled: false, host: '127.0.0.1', port: 23333 })
    mocks.apiGatewayIsRunning.mockReturnValue(false)

    await expect(buildClaudeCodeQueryRequestForAgentSession('session-1')).rejects.toBeInstanceOf(
      ApiGatewayNotRunningError
    )
    expect(mocks.apiGatewayStart).not.toHaveBeenCalled()
    expect(mocks.apiGatewayEnsureRunning).not.toHaveBeenCalled()
    expect(mocks.apiGatewayEnsureKey).not.toHaveBeenCalled()
  })

  // `!isRunning()` is not consent: the gateway is also down while binding at boot, mid-restart, or
  // after a failed activation. Prompting there would ask the user to enable what they already did.
  it('converges an enabled-but-not-yet-listening gateway instead of asking for consent again', async () => {
    mocks.getAgent.mockReturnValue({ id: 'agent-1', model: 'openai::gpt-main' })
    mocks.getProviderByProviderId.mockReturnValue({
      id: 'openai',
      endpointConfigs: { 'openai-chat-completions': { baseUrl: 'https://openai.example.com' } }
    })
    mocks.getModelByKey.mockReturnValue({ id: 'gpt-main', apiModelId: 'gpt-main-api' })
    mocks.apiGatewayIsRunning.mockReturnValue(false)

    const request = await buildClaudeCodeQueryRequestForAgentSession('session-1')

    // `ensureRunning`, never `start`: converging must not be able to re-persist the intent.
    expect(mocks.apiGatewayEnsureRunning).toHaveBeenCalled()
    expect(mocks.apiGatewayStart).not.toHaveBeenCalled()
    expect(request?.settings.env).toMatchObject({ ANTHROPIC_BASE_URL: 'http://127.0.0.1:23333' })
  })

  it('bypasses the materialized API gateway host without making the rebuild baseline stale', async () => {
    const proxyUrl = 'http://remote-proxy.example:7890'
    mocks.getAgent.mockReturnValue({ id: 'agent-1', model: 'openai::gpt-main' })
    mocks.getProviderByProviderId.mockReturnValue({
      id: 'openai',
      endpointConfigs: { 'openai-chat-completions': { baseUrl: 'https://openai.example.com' } }
    })
    mocks.getModelByKey.mockReturnValue({ id: 'gpt-main', apiModelId: 'gpt-main' })
    mocks.apiGatewayGetCurrentConfig.mockReturnValue({
      enabled: true,
      host: '127.0.0.2',
      port: 23333,
      apiKey: 'gateway-key'
    })
    mocks.preferenceGet.mockImplementation((key: string) =>
      key === 'feature.api_gateway.api_key' ? 'gateway-key' : undefined
    )
    mocks.getProxyEnvironment.mockReturnValue({ HTTP_PROXY: proxyUrl })
    mocks.buildSessionSettings.mockResolvedValue({ env: { HTTP_PROXY: proxyUrl } })

    const request = await buildClaudeCodeQueryRequestForAgentSession('session-1')
    const current = await deriveConnectionConfig('session-1')

    if (!request || !current.ok) throw new Error('expected materialized request and current config')
    expect(request.settings.env).toMatchObject({
      ANTHROPIC_BASE_URL: 'http://127.0.0.2:23333',
      NO_PROXY: 'localhost,127.0.0.1,::1,[::1],127.0.0.2',
      no_proxy: 'localhost,127.0.0.1,::1,[::1],127.0.0.2'
    })
    expect(request.connectionConfig.rebuildSignature).toBe(current.config.rebuildSignature)
  })

  it('carries Codex Fast through the internal gateway header', async () => {
    mocks.getAgent.mockReturnValue({ id: 'agent-1', model: 'openai-codex::gpt-5-4' })
    mocks.getProviderByProviderId.mockReturnValue({
      id: 'openai-codex',
      fastMode: { transport: 'openai-priority' },
      endpointConfigs: { 'openai-responses': { baseUrl: 'https://chatgpt.com/backend-api/codex' } }
    })
    mocks.getModelByKey.mockReturnValue({
      id: 'gpt-5-4',
      apiModelId: 'gpt-5.4',
      supportsFastMode: true
    })
    mocks.getLastRuntimeResumeToken.mockReturnValue(null)

    const request = await buildClaudeCodeQueryRequestForAgentSession('session-1', undefined, undefined, 'default', true)

    // `mergeAnthropicCustomHeaders` canonicalizes to a case-insensitively sorted, deduplicated list.
    expect(request?.settings.env).toMatchObject({
      ANTHROPIC_CUSTOM_HEADERS:
        'x-cherry-agent-session-id: session-1\nX-Cherry-Fast-Mode: true\nX-Cherry-Internal-Request-Token: internal-request-token\nx-cherry-internal-usage-token: internal-token'
    })
  })

  it('preserves existing Anthropic custom headers when enabling Codex Fast', async () => {
    mocks.getAgent.mockReturnValue({ id: 'agent-1', model: 'openai-codex::gpt-5-4' })
    mocks.getProviderByProviderId.mockReturnValue({
      id: 'openai-codex',
      fastMode: { transport: 'openai-priority' },
      endpointConfigs: { 'openai-responses': { baseUrl: 'https://chatgpt.com/backend-api/codex' } }
    })
    mocks.getModelByKey.mockReturnValue({
      id: 'gpt-5-4',
      apiModelId: 'gpt-5.4',
      supportsFastMode: true
    })
    mocks.getLastRuntimeResumeToken.mockReturnValue(null)
    mocks.buildSessionSettings.mockResolvedValueOnce({
      env: { ANTHROPIC_CUSTOM_HEADERS: 'X-Custom-Header: retained' }
    })

    const request = await buildClaudeCodeQueryRequestForAgentSession('session-1', undefined, undefined, 'default', true)

    // Sorted canonical order — the retained custom header survives the merge.
    expect(request?.settings.env?.ANTHROPIC_CUSTOM_HEADERS).toBe(
      'x-cherry-agent-session-id: session-1\nX-Cherry-Fast-Mode: true\nX-Cherry-Internal-Request-Token: internal-request-token\nx-cherry-internal-usage-token: internal-token\nX-Custom-Header: retained'
    )
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
            endpointConfigs: { 'anthropic-messages': { baseUrl: 'https://api.anthropic.com' } },
            settings: { extraHeaders: { 'X-Upstream-Secret': 'subscription-secret' } }
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
    expect(request?.settings.env).not.toHaveProperty('ANTHROPIC_CUSTOM_HEADERS')
    expect(request?.usageCapture).toEqual({
      owner: 'agent-sdk',
      credentialReceipt: { attribution: 'auth', method: 'external-cli' },
      providerId: 'claude-code',
      providerName: null,
      source: { type: 'agent', id: 'agent-1', name: null, icon: null },
      frozenModels: [
        {
          modelId: 'sonnet',
          apiModelId: 'sonnet-api',
          modelName: 'sonnet',
          pricingSnapshot: null,
          aliases: ['sonnet-api', 'sonnet']
        }
      ]
    })
  })

  it('passes Claude Code Fast to the SDK settings builder', async () => {
    mocks.getAgent.mockReturnValue({ id: 'agent-1', model: 'claude-code::claude-opus-4-8' })
    mocks.getProviderByProviderId.mockReturnValue({
      id: 'claude-code',
      authMethods: ['external-cli'],
      fastMode: { transport: 'claude-code' },
      endpointConfigs: { 'anthropic-messages': { baseUrl: 'https://api.anthropic.com' } }
    })
    mocks.getModelByKey.mockReturnValue({
      id: 'claude-opus-4-8',
      apiModelId: 'claude-opus-4-8',
      supportsFastMode: true
    })
    mocks.getLastRuntimeResumeToken.mockReturnValue(null)

    await buildClaudeCodeQueryRequestForAgentSession('session-1', undefined, undefined, 'default', true)

    expect(mocks.buildSessionSettings).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ fastMode: true }),
      expect.anything()
    )
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
    mocks.resolveEffectiveEndpoint.mockImplementation(resolveTestEffectiveEndpoint)
    mocks.getApiKeys.mockReturnValue([{ key: 'api-key', isEnabled: true }])
    mocks.buildSkillWhitelist.mockResolvedValue([])
    mocks.findChannelBySessionId.mockReturnValue(null)
    mocks.findMcpServerByIdOrName.mockReturnValue(undefined)
    mocks.preferenceGet.mockReturnValue(undefined)
    mocks.apiGatewayGetCurrentConfig.mockReturnValue({ enabled: true, host: '127.0.0.1', port: 23333 })
    mocks.getAppLanguage.mockReturnValue('en-US')
    mocks.getProxyEnvironment.mockReturnValue({})
    mocks.getClaudeCodeLoginShellEnvironment.mockResolvedValue({})
  })

  async function deriveSignature() {
    const result = await deriveConnectionConfig('session-1', undefined, 'default', false, [])
    if (!result.ok) throw new Error('expected ok derive')
    return result.config
  }

  it('is a pure read: no rotation advance, no gateway effects, no settings materialization', async () => {
    const result = await deriveConnectionConfig('session-1')

    expect(result.ok).toBe(true)
    expect(mocks.resolveApiKey).not.toHaveBeenCalled()
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
    expect(second.rebuildFactFingerprints).toEqual(first.rebuildFactFingerprints)
  })

  it('does not rebuild when only the usage pricing capture time changes', async () => {
    mocks.getModelByKey.mockImplementation((_providerId: string, modelId: string) => ({
      id: modelId,
      apiModelId: `${modelId}-api`,
      pricing: {
        input: { perMillionTokens: 1, currency: 'USD' as const },
        output: { perMillionTokens: 2, currency: 'USD' as const }
      }
    }))
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-07-30T00:00:00.000Z'))
      const first = await deriveSignature()
      vi.setSystemTime(new Date('2026-07-30T00:01:00.000Z'))
      const second = await deriveSignature()

      expect(second.rebuildSignature).toBe(first.rebuildSignature)
      expect(second.rebuildFactFingerprints.route).toBe(first.rebuildFactFingerprints.route)

      mocks.getModelByKey.mockImplementation((_providerId: string, modelId: string) => ({
        id: modelId,
        apiModelId: `${modelId}-api`,
        pricing: {
          input: { perMillionTokens: 3, currency: 'USD' as const },
          output: { perMillionTokens: 2, currency: 'USD' as const }
        }
      }))
      const repriced = await deriveSignature()

      expect(repriced.rebuildFactFingerprints.route).not.toBe(second.rebuildFactFingerprints.route)
    } finally {
      vi.useRealTimers()
    }
  })

  it('changes the rebuild signature when direct-provider extra headers change', async () => {
    mocks.getProviderByProviderId.mockReturnValue({
      id: 'provider-1',
      endpointConfigs: { 'anthropic-messages': { baseUrl: 'https://anthropic.example.com' } },
      settings: { extraHeaders: { 'X-Tenant': 'tenant-a' } }
    })
    const first = await deriveSignature()

    mocks.getProviderByProviderId.mockReturnValue({
      id: 'provider-1',
      endpointConfigs: { 'anthropic-messages': { baseUrl: 'https://anthropic.example.com' } },
      settings: { extraHeaders: { 'X-Tenant': 'tenant-b' } }
    })
    const changed = await deriveSignature()

    expect(changed.rebuildSignature).not.toBe(first.rebuildSignature)
  })

  it('changes the rebuild signature when the app language changes', async () => {
    const english = await deriveSignature()

    mocks.getAppLanguage.mockReturnValue('zh-CN')
    const chinese = await deriveSignature()

    expect(chinese.rebuildSignature).not.toBe(english.rebuildSignature)
    expect(
      Object.keys(english.rebuildFactFingerprints).filter(
        (name) => english.rebuildFactFingerprints[name] !== chinese.rebuildFactFingerprints[name]
      )
    ).toEqual(['language'])
  })

  it('changes only the prompt username rebuild fact when the user name changes', async () => {
    mocks.preferenceGet.mockImplementation((key: string) => (key === 'app.user.name' ? 'Alice' : undefined))
    const alice = await deriveSignature()

    mocks.preferenceGet.mockImplementation((key: string) => (key === 'app.user.name' ? 'Bob' : undefined))
    const bob = await deriveSignature()

    expect(bob.rebuildSignature).not.toBe(alice.rebuildSignature)
    expect(
      Object.keys(alice.rebuildFactFingerprints).filter(
        (name) => alice.rebuildFactFingerprints[name] !== bob.rebuildFactFingerprints[name]
      )
    ).toEqual(['promptUserName'])
  })

  it('changes only the prompt model name rebuild fact when the resolved Agent model name changes', async () => {
    const agent = {
      id: 'agent-1',
      model: 'provider-1::model-1',
      modelName: 'Model One',
      disabledTools: [],
      mcps: [],
      configuration: {}
    }
    mocks.getAgent.mockReturnValue(agent)
    const original = await deriveSignature()

    mocks.getAgent.mockReturnValue({ ...agent, modelName: 'Renamed Model' })
    const renamed = await deriveSignature()

    expect(renamed.rebuildSignature).not.toBe(original.rebuildSignature)
    expect(
      Object.keys(original.rebuildFactFingerprints).filter(
        (name) => original.rebuildFactFingerprints[name] !== renamed.rebuildFactFingerprints[name]
      )
    ).toEqual(['promptModelName'])
  })

  it('changes only the proxy-environment rebuild fact when the effective Cherry proxy changes', async () => {
    mocks.getProxyEnvironment.mockReturnValue({ HTTP_PROXY: 'http://proxy-a.example.com:8080' })
    const first = await deriveSignature()

    mocks.getProxyEnvironment.mockReturnValue({ HTTP_PROXY: 'http://proxy-b.example.com:8080' })
    const changed = await deriveSignature()

    expect(changed.rebuildSignature).not.toBe(first.rebuildSignature)
    expect(
      Object.keys(first.rebuildFactFingerprints).filter(
        (name) => first.rebuildFactFingerprints[name] !== changed.rebuildFactFingerprints[name]
      )
    ).toEqual(['proxyEnvironment'])
  })

  it('keeps the rebuild signature stable for semantically equivalent proxy bypass variables', async () => {
    const proxyUrl = 'http://proxy.example.com:8080'
    mocks.getProxyEnvironment.mockReturnValue({
      HTTP_PROXY: proxyUrl,
      no_proxy: 'service.internal; localhost 127.0.0.1 ::1 [::1]'
    })
    const fromLowercase = await deriveSignature()

    mocks.getProxyEnvironment.mockReturnValue({
      HTTP_PROXY: proxyUrl,
      NO_PROXY: 'service.internal,localhost,127.0.0.1,::1,[::1]'
    })
    const fromUppercase = await deriveSignature()

    expect(fromUppercase.rebuildSignature).toBe(fromLowercase.rebuildSignature)
    expect(fromUppercase.rebuildFactFingerprints.proxyEnvironment).toBe(
      fromLowercase.rebuildFactFingerprints.proxyEnvironment
    )
  })

  it('derives proxy rebuild facts from the provenance-aware login-shell snapshot', async () => {
    const currentProxyEnvironment = { HTTP_PROXY: 'http://current-cherry-proxy.example:7890' }
    mocks.getProxyEnvironment.mockReturnValue(currentProxyEnvironment)
    mocks.getClaudeCodeLoginShellEnvironment.mockResolvedValueOnce({
      SOCKS_PROXY: 'socks5://user-shell-proxy.example:1080'
    })
    const withUserShellProxy = await deriveSignature()

    mocks.getClaudeCodeLoginShellEnvironment.mockResolvedValueOnce({})
    const withoutUserShellProxy = await deriveSignature()

    expect(mocks.getClaudeCodeLoginShellEnvironment).toHaveBeenCalledWith(currentProxyEnvironment)
    expect(withUserShellProxy.rebuildSignature).not.toBe(withoutUserShellProxy.rebuildSignature)
    expect(withUserShellProxy.rebuildFactFingerprints.proxyEnvironment).not.toBe(
      withoutUserShellProxy.rebuildFactFingerprints.proxyEnvironment
    )
  })

  it('keeps the rebuild signature stable for semantically equivalent Agent bypass env vars', async () => {
    const proxyUrl = 'http://agent-proxy.example.com:8080'
    mocks.getAgent.mockReturnValue({
      id: 'agent-1',
      model: 'provider-1::model-1',
      disabledTools: [],
      mcps: [],
      configuration: {
        env_vars: {
          HTTP_PROXY: proxyUrl,
          no_proxy: 'service.internal; localhost 127.0.0.1 ::1 [::1]'
        }
      }
    })
    const fromLowercase = await deriveSignature()

    mocks.getAgent.mockReturnValue({
      id: 'agent-1',
      model: 'provider-1::model-1',
      disabledTools: [],
      mcps: [],
      configuration: {
        env_vars: {
          HTTP_PROXY: proxyUrl,
          NO_PROXY: 'service.internal,localhost,127.0.0.1,::1,[::1]'
        }
      }
    })
    const fromUppercase = await deriveSignature()

    expect(fromUppercase.rebuildSignature).toBe(fromLowercase.rebuildSignature)
    expect(fromUppercase.rebuildFactFingerprints.proxyEnvironment).toBe(
      fromLowercase.rebuildFactFingerprints.proxyEnvironment
    )
  })

  it('reports only the proxy-environment rebuild fact when an Agent proxy URL changes', async () => {
    const agentWithProxy = (proxyUrl: string) => ({
      id: 'agent-1',
      model: 'provider-1::model-1',
      disabledTools: [],
      mcps: [],
      configuration: { env_vars: { HTTP_PROXY: proxyUrl } }
    })
    mocks.getAgent.mockReturnValue(agentWithProxy('http://agent-proxy-a.example.com:8080'))
    const first = await deriveSignature()

    mocks.getAgent.mockReturnValue(agentWithProxy('http://agent-proxy-b.example.com:8080'))
    const changed = await deriveSignature()

    expect(changed.rebuildSignature).not.toBe(first.rebuildSignature)
    expect(
      Object.keys(first.rebuildFactFingerprints).filter(
        (name) => first.rebuildFactFingerprints[name] !== changed.rebuildFactFingerprints[name]
      )
    ).toEqual(['proxyEnvironment'])
  })

  it('rebuilds when task notification recipients change', async () => {
    mocks.getTurnTrustedNotifyChannels.mockReturnValue([{ id: 'channel-1', type: 'telegram' }])
    const first = await deriveSignature()
    mocks.getTurnTrustedNotifyChannels.mockReturnValue([{ id: 'channel-2', type: 'feishu' }])

    expect((await deriveSignature()).rebuildSignature).not.toBe(first.rebuildSignature)
  })

  it('changes the rebuild signature when model context metadata changes', async () => {
    mocks.getModelByKey.mockImplementation((_providerId: string, modelId: string) => ({
      id: modelId,
      apiModelId: `${modelId}-api`,
      contextWindow: 128_000
    }))
    const original = await deriveSignature()

    mocks.getModelByKey.mockImplementation((_providerId: string, modelId: string) => ({
      id: modelId,
      apiModelId: `${modelId}-api`,
      contextWindow: 256_000
    }))
    const changed = await deriveSignature()

    expect(changed.rebuildSignature).not.toBe(original.rebuildSignature)
    expect(
      Object.keys(original.rebuildFactFingerprints).filter(
        (name) => original.rebuildFactFingerprints[name] !== changed.rebuildFactFingerprints[name]
      )
    ).toEqual(['contextWindow'])
  })

  it('changes the rebuild signature for each rebuild-group input', async () => {
    const base = await deriveSignature()

    mocks.findChannelBySessionId.mockReturnValue({ id: 'channel-1', sessionId: 'session-1', agentId: 'agent-1' })
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

  it('fingerprints knowledge-base bindings as a set', async () => {
    mocks.getAgent.mockReturnValue({
      id: 'agent-1',
      model: 'provider-1::model-1',
      disabledTools: [],
      mcps: [],
      knowledgeBaseIds: ['kb-b', 'kb-a'],
      configuration: {}
    })
    const bound = await deriveSignature()

    mocks.getAgent.mockReturnValue({
      id: 'agent-1',
      model: 'provider-1::model-1',
      disabledTools: [],
      mcps: [],
      knowledgeBaseIds: ['kb-a', 'kb-b'],
      configuration: {}
    })
    const reordered = await deriveSignature()

    mocks.getAgent.mockReturnValue({
      id: 'agent-1',
      model: 'provider-1::model-1',
      disabledTools: [],
      mcps: [],
      knowledgeBaseIds: ['kb-a'],
      configuration: {}
    })
    const unbound = await deriveSignature()

    expect(reordered.rebuildSignature).toBe(bound.rebuildSignature)
    expect(unbound.rebuildSignature).not.toBe(bound.rebuildSignature)
  })

  it('fingerprints composer knowledge selection only when the Agent has no static binding', async () => {
    const unselected = await deriveConnectionConfig('session-1', undefined, 'default', false, [])
    const selected = await deriveConnectionConfig('session-1', undefined, 'default', false, ['kb-selected'])
    if (!unselected.ok || !selected.ok) throw new Error('expected ok derive')
    expect(selected.config.rebuildSignature).not.toBe(unselected.config.rebuildSignature)

    mocks.getAgent.mockReturnValue({
      id: 'agent-1',
      model: 'provider-1::model-1',
      disabledTools: [],
      mcps: [],
      knowledgeBaseIds: ['kb-bound'],
      configuration: {}
    })
    const firstSelection = await deriveConnectionConfig('session-1', undefined, 'default', false, ['kb-a'])
    const secondSelection = await deriveConnectionConfig('session-1', undefined, 'default', false, ['kb-b'])
    if (!firstSelection.ok || !secondSelection.ok) throw new Error('expected ok derive')
    expect(secondSelection.config.rebuildSignature).toBe(firstSelection.config.rebuildSignature)
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
