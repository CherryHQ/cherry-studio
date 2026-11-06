import { setupTestDatabase } from '@test-helpers/db'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { LocalAgentConfigurationSchema } from '@shared/ai/localAgent'

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
    mocks.read.mockResolvedValue([{ content: saved }])
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

  it.each([
    ['opencode', 'OPENCODE_CONFIG_CONTENT'],
    ['kilo', 'KILO_CONFIG_CONTENT']
  ])('overlays only %s child configuration and keeps native global defaults unchanged', async (presetId, key) => {
    const env = { [key]: JSON.stringify({ theme: 'dark', provider: { other: { name: 'Other' } } }) }
    const second: NodeJS.ProcessEnv = {}
    await bindLocalGatewayUsage(config(presetId), 'session-1', env)
    await bindLocalGatewayUsage(config(presetId), 'session-2', second)
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
    expect(await bindLocalGatewayUsage(config(presetId), 'session', env)).toBeUndefined()
    expect(env).toEqual(before)
    expect(mocks.create.mock.calls).toEqual([])
  })
})
