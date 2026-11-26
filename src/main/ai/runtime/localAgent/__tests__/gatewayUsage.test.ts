import { setupTestDatabase } from '@test-helpers/db'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { LocalAgentConfigurationSchema, type LocalAgentConfiguration } from '@shared/ai/localAgent'
import type { CliConfigTarget } from '@shared/utils/cliConfig'

import { prepareAcpChatLaunch } from '../acpLaunch'
import { bindLocalGatewayUsage } from '../gatewayUsage'

const mocks = vi.hoisted(() => ({ read: vi.fn(), create: vi.fn() }))
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const services = {
    CodeCliService: { readConfigFiles: mocks.read },
    ApiGatewayService: {
      getCurrentConfig: () => ({ host: '0.0.0.0', port: 23333, apiKey: 'public' }),
      createScopedCredential: mocks.create
    }
  }
  return mockApplicationFactory(services)
})

describe('connection-local gateway attribution', () => {
  const dbh = setupTestDatabase()
  const saved = JSON.stringify({
    model: 'cherry/provider:model',
    provider: {
      cherry: { npm: '@ai-sdk/openai-compatible', options: { baseURL: 'http://127.0.0.1:23333/v1', apiKey: 'public' } }
    }
  })
  beforeEach(() => {
    mocks.read.mockReset().mockResolvedValue([
      { target: 'opencode-config', content: saved },
      { target: 'kilo-config', content: saved }
    ])
    mocks.create.mockReset().mockImplementation(async ({ agentSessionId }) => ({
      baseUrl: 'http://127.0.0.1:12345',
      apiKey: agentSessionId,
      dispose: () => {}
    }))
    dbh.db
      .insert(userProviderTable)
      .values({ providerId: 'provider', name: 'Provider', orderKey: 'a0', isEnabled: true })
      .run()
    dbh.db
      .insert(userModelTable)
      .values({
        id: 'provider::model',
        providerId: 'provider',
        modelId: 'model',
        name: 'Model',
        capabilities: [],
        supportsStreaming: true,
        orderKey: 'a0'
      })
      .run()
  })
  const config = (presetId = 'opencode') =>
    LocalAgentConfigurationSchema.parse({
      presetId,
      protocol: 'acp',
      enabled: true,
      nativeModel: 'cherry/provider:model',
      sourceModelId: 'provider::model',
      sourceModelViaGateway: true
    })

  async function bind(config: LocalAgentConfiguration, sessionId: string, env: NodeJS.ProcessEnv) {
    const files: { target: CliConfigTarget; content: string | null }[] = await mocks.read()
    return bindLocalGatewayUsage(
      config,
      sessionId,
      env,
      Object.fromEntries(files.map(({ target, content }) => [target, content]))
    )
  }

  it('uses the same config read for ACP environment and gateway attribution', async () => {
    const credentials = {
      cherry_managed: true,
      model: 'provider:model',
      base_url: 'http://127.0.0.1:23333',
      z_ai_api_key: 'public'
    }
    mocks.read
      .mockResolvedValueOnce([{ target: 'glm-credentials', content: JSON.stringify(credentials) }])
      .mockResolvedValueOnce([
        {
          target: 'glm-credentials',
          content: JSON.stringify({ ...credentials, model: 'another-model' })
        }
      ])

    const { launch, gateway } = await prepareAcpChatLaunch(
      { ...config('glm-acp-agent'), nativeModel: 'provider:model', executableOverride: process.execPath },
      'session-glm',
      new AbortController().signal
    )

    expect(launch.env.ACP_GLM_MODEL).toBe('provider:model')
    expect(gateway).toBeDefined()
    expect(mocks.read).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['opencode', 'OPENCODE_CONFIG_CONTENT'],
    ['kilo', 'KILO_CONFIG_CONTENT']
  ])('overlays only %s child configuration and keeps native global defaults unchanged', async (presetId, key) => {
    const env = { [key]: JSON.stringify({ theme: 'dark', provider: { other: { name: 'Other' } } }) }
    const second: NodeJS.ProcessEnv = {}
    await bind(config(presetId), 'session-1', env)
    await bind(config(presetId), 'session-2', second)
    expect(JSON.parse(env[key])).toMatchObject({
      theme: 'dark',
      provider: {
        other: { name: 'Other' },
        cherry: { options: { apiKey: 'session-1', baseURL: 'http://127.0.0.1:12345/v1' } }
      }
    })
    expect(JSON.parse(second[key]!)).toMatchObject({ provider: { cherry: { options: { apiKey: 'session-2' } } } })
    expect(mocks.create.mock.calls.map(([scope]) => scope)).toEqual(
      ['session-1', 'session-2'].map((agentSessionId) => ({
        path: '/v1/chat/completions',
        model: 'provider:model',
        agentSessionId
      }))
    )
  })

  it.each([
    { presetId: 'pi', env: {} },
    { presetId: 'opencode', env: { OPENCODE_CONFIG_CONTENT: '{invalid' } },
    { presetId: 'opencode', env: { OPENCODE_CONFIG_CONTENT: '{"model":"other/model"}' } },
    {
      presetId: 'opencode',
      env: { OPENCODE_CONFIG_CONTENT: '{"provider":{"cherry":{"options":{"apiKey":"user-key"}}}}' }
    }
  ])('leaves unsupported or overridden routes uncorrelated: $presetId $env', async ({ presetId, env }) => {
    const before = { ...env }
    expect(await bind(config(presetId), 'session', env)).toBeUndefined()
    expect(env).toEqual(before)
    expect(mocks.create.mock.calls).toEqual([])
  })

  it.each([
    { lastUsedProvider: 'anthropic', env: {} },
    { lastUsedProvider: 'openai-compatible', env: { CLINE_DATA_DIR: '/custom/data' } },
    { lastUsedProvider: 'openai-compatible', env: { CLINE_API_KEY: 'user-key' } }
  ])(
    'does not attribute Cline through an inactive route ($lastUsedProvider, $env)',
    async ({ lastUsedProvider, env }) => {
      mocks.read.mockResolvedValueOnce([
        {
          target: 'cline-providers',
          content: JSON.stringify({
            lastUsedProvider,
            providers: {
              'openai-compatible': {
                cherryManaged: true,
                settings: { model: 'provider:model', baseUrl: 'http://127.0.0.1:23333', apiKey: 'public' }
              },
              anthropic: { settings: { model: 'provider:model' } },
              'cherry-legacy': { model: 'provider:model', baseUrl: 'http://127.0.0.1:23333', apiKey: 'public' }
            }
          })
        }
      ])
      const clineConfig = { ...config('cline'), nativeModel: 'provider:model' }

      expect(await bind(clineConfig, 'session-cline', env)).toBeUndefined()
      expect(mocks.create).not.toHaveBeenCalled()
    }
  )

  it('binds grok-build, pi-acp, poolside, and cline gateway routes to the session', async () => {
    mocks.read.mockResolvedValueOnce([
      {
        target: 'grok-config',
        content: [
          '[models]',
          'default = "cherry-gateway"',
          '',
          '[model.cherry-gateway]',
          'model = "provider:model"',
          'base_url = "http://127.0.0.1:23333/v1"',
          'api_key = "public"',
          'api_backend = "responses"'
        ].join('\n')
      }
    ])
    const grokConfig = LocalAgentConfigurationSchema.parse({
      presetId: 'grok-build',
      protocol: 'acp',
      enabled: true,
      nativeModel: 'cherry-gateway',
      sourceModelId: 'provider::model',
      sourceModelViaGateway: true
    })
    expect(await bind(grokConfig, 'session-grok', {})).toBeDefined()

    mocks.read.mockResolvedValueOnce([
      {
        target: 'pi-models',
        content: JSON.stringify({
          providers: {
            'cherry-gateway': {
              baseUrl: 'http://127.0.0.1:23333',
              api: 'anthropic-messages',
              apiKey: 'public',
              models: [{ id: 'provider:model' }]
            }
          }
        })
      },
      {
        target: 'pi-settings',
        content: JSON.stringify({ defaultProvider: 'cherry-gateway', defaultModel: 'provider:model' })
      }
    ])
    const piConfig = LocalAgentConfigurationSchema.parse({
      presetId: 'pi-acp',
      protocol: 'acp',
      enabled: true,
      nativeModel: 'cherry-gateway/provider:model',
      sourceModelId: 'provider::model',
      sourceModelViaGateway: true
    })
    expect(await bind(piConfig, 'session-pi', {})).toBeDefined()

    mocks.read.mockResolvedValueOnce([
      {
        target: 'poolside-settings',
        content: [
          'pool:',
          '  default_agent_server: cherry-poolside',
          'agent_servers:',
          '  cherry-poolside:',
          '    env:',
          '      POOLSIDE_API_KEY: public',
          '      POOLSIDE_STANDALONE_BASE_URL: http://127.0.0.1:23333/v1',
          '      POOLSIDE_STANDALONE_MODEL: provider:model',
          '    default_config_options:',
          '      model: provider:model'
        ].join('\n')
      }
    ])
    const poolsideConfig = LocalAgentConfigurationSchema.parse({
      presetId: 'poolside',
      protocol: 'acp',
      enabled: true,
      nativeModel: 'provider:model',
      sourceModelId: 'provider::model',
      sourceModelViaGateway: true
    })
    const poolsideEnv: NodeJS.ProcessEnv = {
      POOLSIDE_API_KEY: 'public',
      POOLSIDE_STANDALONE_BASE_URL: 'http://127.0.0.1:23333/v1',
      POOLSIDE_STANDALONE_MODEL: 'provider:model'
    }
    expect(await bind(poolsideConfig, 'session-poolside', poolsideEnv)).toBeDefined()
    expect(poolsideEnv).toMatchObject({
      POOLSIDE_API_KEY: 'session-poolside',
      POOLSIDE_STANDALONE_BASE_URL: 'http://127.0.0.1:12345/v1'
    })

    mocks.read.mockResolvedValueOnce([
      {
        target: 'cline-providers',
        content: JSON.stringify({
          version: 1,
          lastUsedProvider: 'openai-compatible',
          providers: {
            'openai-compatible': {
              cherryManaged: true,
              settings: {
                provider: 'openai-compatible',
                baseUrl: 'http://127.0.0.1:23333',
                apiKey: 'public',
                model: 'provider:model'
              }
            }
          }
        })
      }
    ])
    const clineConfig = LocalAgentConfigurationSchema.parse({
      presetId: 'cline',
      protocol: 'acp',
      enabled: true,
      nativeModel: 'provider:model',
      sourceModelId: 'provider::model',
      sourceModelViaGateway: true
    })
    expect(await bind(clineConfig, 'session-cline', {})).toBeDefined()

    mocks.read.mockResolvedValueOnce([
      {
        target: 'glm-credentials',
        content: JSON.stringify({
          z_ai_api_key: 'public',
          base_url: 'http://127.0.0.1:23333',
          model: 'provider:model',
          cherry_managed: true
        })
      }
    ])
    const glmConfig = LocalAgentConfigurationSchema.parse({
      presetId: 'glm-acp-agent',
      protocol: 'acp',
      enabled: true,
      nativeModel: 'provider:model',
      sourceModelId: 'provider::model',
      sourceModelViaGateway: true
    })
    expect(await bind(glmConfig, 'session-glm', {})).toBeDefined()

    mocks.read.mockResolvedValueOnce([
      {
        target: 'snow-config',
        content: JSON.stringify({
          cherryManaged: true,
          snowcfg: {
            baseUrl: 'http://127.0.0.1:23333',
            apiKey: 'public',
            requestMethod: 'anthropic',
            advancedModel: 'provider:model'
          }
        })
      }
    ])
    const snowConfig = LocalAgentConfigurationSchema.parse({
      presetId: 'snow',
      protocol: 'acp',
      enabled: true,
      nativeModel: 'provider:model',
      sourceModelId: 'provider::model',
      sourceModelViaGateway: true
    })
    expect(await bind(snowConfig, 'session-snow', {})).toBeDefined()

    mocks.read.mockResolvedValueOnce([
      {
        target: 'zcode-config',
        content: JSON.stringify({
          provider: {
            'cherry-gateway': {
              kind: 'openai-compatible',
              options: { baseURL: 'http://127.0.0.1:23333', apiKey: 'public' },
              models: { 'provider:model': { name: 'Model' } }
            }
          }
        })
      }
    ])
    const zcodeConfig = LocalAgentConfigurationSchema.parse({
      presetId: 'zcode',
      protocol: 'acp',
      enabled: true,
      nativeModel: 'cherry-gateway\\provider:model',
      sourceModelId: 'provider::model',
      sourceModelViaGateway: true
    })
    expect(await bind(zcodeConfig, 'session-zcode', {})).toBeDefined()

    expect(mocks.create.mock.calls.map(([scope]) => scope)).toEqual([
      { path: '/v1/responses', model: 'provider:model', agentSessionId: 'session-grok', allowPublicCorrelation: true },
      { path: '/v1/messages', model: 'provider:model', agentSessionId: 'session-pi', allowPublicCorrelation: true },
      { path: '/v1/chat/completions', model: 'provider:model', agentSessionId: 'session-poolside' },
      {
        path: '/v1/chat/completions',
        model: 'provider:model',
        agentSessionId: 'session-cline',
        allowPublicCorrelation: true
      },
      {
        path: '/v1/chat/completions',
        model: 'provider:model',
        agentSessionId: 'session-glm',
        allowPublicCorrelation: true
      },
      { path: '/v1/messages', model: 'provider:model', agentSessionId: 'session-snow', allowPublicCorrelation: true },
      {
        path: '/v1/chat/completions',
        model: 'provider:model',
        agentSessionId: 'session-zcode',
        allowPublicCorrelation: true
      }
    ])

    mocks.create.mockClear()
    mocks.read.mockResolvedValueOnce([
      {
        target: 'grok-config',
        content:
          '[models]\ndefault = "custom"\n[model.custom]\nmodel = "x"\nbase_url = "https://example.com"\napi_key = "other"\n'
      }
    ])
    expect(await bind(grokConfig, 'session-unmatched', {})).toBeUndefined()
    expect(mocks.create).not.toHaveBeenCalled()
  })
})
