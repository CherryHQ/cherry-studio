import { access, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { LocalAgentConfigurationSchema, type LocalAgentConfiguration } from '@shared/ai/localAgent'
import type { CliConfigTarget } from '@shared/utils/cliConfig'

import { prepareAcpChatLaunch } from '../acp/acpLaunch'
import { acpPreset } from '../acp/acpPresets'
import { bindCliGatewayRoute } from '../agentApiGateway'
import { resolveCliGatewayRoute } from '../cli/cliGatewayRoute'

const mocks = vi.hoisted(() => ({ read: vi.fn(), create: vi.fn() }))
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const services = {
    BinaryManager: {
      getToolSnapshots: async () => ({
        'deepagents-acp': { name: 'deepagents-acp', availability: { source: 'system', path: process.execPath } },
        junie: { name: 'junie', availability: { source: 'system', path: process.execPath } }
      })
    },
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
        contextWindow: 96_000,
        supportsStreaming: true,
        orderKey: 'a0'
      })
      .run()
  })
  const config = (presetId = 'opencode') =>
    LocalAgentConfigurationSchema.parse({
      presetId,
      enabled: true,
      nativeModel: 'cherry/provider:model',
      sourceModelId: 'provider::model',
      sourceModelViaGateway: true
    })

  it('launches DeepAgents against a session credential and the selected Cherry model', async () => {
    const { launch, gateway, contextWindow } = await prepareAcpChatLaunch(
      { ...config('deepagents'), nativeModel: undefined },
      'deepagents-session',
      new AbortController().signal
    )

    expect(launch.args).toContain('openai:provider:model')
    expect(launch.env.OPENAI_BASE_URL).toBe('http://127.0.0.1:12345/v1')
    expect(launch.env.OPENAI_API_KEY).toBe('deepagents-session')
    expect(contextWindow).toBe(96_000)
    expect(mocks.create.mock.calls.map(([scope]) => scope)).toEqual([
      { paths: ['/v1/responses'], model: 'provider:model', agentSessionId: 'deepagents-session' }
    ])
    await gateway?.dispose()
  })

  it('gives Junie an isolated model profile and removes it when the session ends', async () => {
    const getPath = vi.spyOn(application, 'getPath')
    const original = getPath.getMockImplementation()!
    getPath.mockImplementation((key, filename) =>
      key === 'app.temp' ? join(tmpdir(), filename ?? '') : original(key, filename)
    )
    try {
      const { launch, gateway } = await prepareAcpChatLaunch(
        { ...config('junie'), nativeModel: undefined },
        'junie-session',
        new AbortController().signal
      )
      const profileDir = launch.args
        .find((arg) => arg.startsWith('--model-location='))!
        .slice('--model-location='.length)
      const selectedProfile = launch.args
        .find((arg) => arg.startsWith('--model=custom:'))!
        .slice('--model=custom:'.length)
      const filename = join(profileDir, `${selectedProfile}.json`)
      try {
        const profile = JSON.parse(await readFile(filename, 'utf8'))
        expect(profile).toMatchObject({ baseUrl: 'http://127.0.0.1:12345/v1/chat/completions', id: 'provider:model' })
        expect(launch.env[profile.apiKey.slice(2, -1)]).toBe('junie-session')
      } finally {
        await gateway?.dispose()
      }
      await expect(access(filename)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      getPath.mockImplementation(original)
    }
  })

  async function bind(config: LocalAgentConfiguration, sessionId: string, env: Record<string, string>) {
    const files: { target: CliConfigTarget; content: string | null }[] = await mocks.read()
    const preset = acpPreset(config.presetId)
    if (!preset || !config.nativeModel || !config.sourceModelId) throw new Error('Missing test route')
    const route = resolveCliGatewayRoute(
      { nativeModel: config.nativeModel, sourceModelId: config.sourceModelId },
      preset,
      Object.fromEntries(files.map(({ target, content }) => [target, content])),
      env,
      {}
    )
    return bindCliGatewayRoute(sessionId, route)
  }

  it('uses the same file read to configure Poolside and bind the session credential', async () => {
    const content = [
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
    mocks.read
      .mockResolvedValueOnce([{ target: 'poolside-settings', content }])
      .mockResolvedValueOnce([{ target: 'poolside-settings', content: content.replaceAll('provider:model', 'other') }])

    const { launch, gateway, contextWindow } = await prepareAcpChatLaunch(
      { ...config('poolside'), nativeModel: 'provider:model', executableOverride: process.execPath },
      'session-poolside',
      new AbortController().signal
    )
    expect(contextWindow).toBe(96_000)

    expect(launch.env.POOLSIDE_STANDALONE_MODEL).toBe('provider:model')
    expect(launch.env.POOLSIDE_STANDALONE_BASE_URL).toBe('http://127.0.0.1:12345/v1')
    expect(launch.env.POOLSIDE_API_KEY).toBe('session-poolside')
    expect(mocks.read).toHaveBeenCalledTimes(1)
    await gateway?.dispose()
  })

  it.each([
    ['opencode', 'OPENCODE_CONFIG_CONTENT'],
    ['kilo', 'KILO_CONFIG_CONTENT']
  ])('overlays only %s child configuration and keeps native global defaults unchanged', async (presetId, key) => {
    const env = { [key]: JSON.stringify({ theme: 'dark', provider: { other: { name: 'Other' } } }) }
    const second: Record<string, string> = {}
    await bind(config(presetId), 'session-1', env)
    await bind(config(presetId), 'session-2', second)
    expect(JSON.parse(env[key])).toMatchObject({
      theme: 'dark',
      provider: {
        other: { name: 'Other' },
        cherry: { options: { apiKey: 'session-1', baseURL: 'http://127.0.0.1:12345/v1' } }
      }
    })
    expect(JSON.parse(second[key])).toMatchObject({ provider: { cherry: { options: { apiKey: 'session-2' } } } })
    expect(mocks.create.mock.calls.map(([scope]) => scope)).toEqual(
      ['session-1', 'session-2'].map((agentSessionId) => ({
        paths: ['/v1/chat/completions'],
        model: 'provider:model',
        agentSessionId
      }))
    )
  })

  it.each([
    { presetId: 'pi-acp', env: {} },
    { presetId: 'opencode', env: { OPENCODE_CONFIG_CONTENT: '{invalid' } },
    { presetId: 'opencode', env: { OPENCODE_CONFIG_CONTENT: '{"model":"other/model"}' } },
    {
      presetId: 'opencode',
      env: { OPENCODE_CONFIG_CONTENT: '{"provider":{"cherry":{"options":{"apiKey":"user-key"}}}}' }
    }
  ])('leaves unsupported or overridden routes uncorrelated: $presetId $env', async ({ presetId, env }) => {
    const launchEnv: Record<string, string> = env.OPENCODE_CONFIG_CONTENT
      ? { OPENCODE_CONFIG_CONTENT: env.OPENCODE_CONFIG_CONTENT }
      : {}
    expect(await bind(config(presetId), 'session', launchEnv)).toBeUndefined()
    expect(launchEnv).toEqual(env)
    expect(mocks.create.mock.calls).toEqual([])
  })

  it('does not borrow a session credential for an exact route with no native installer', async () => {
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
    expect(await bind({ ...config('grok-build'), nativeModel: 'cherry-gateway' }, 'session-grok', {})).toBeUndefined()
    expect(mocks.create).not.toHaveBeenCalled()
  })
})
