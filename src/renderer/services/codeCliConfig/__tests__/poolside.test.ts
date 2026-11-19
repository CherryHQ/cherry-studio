import { afterEach, expect, it, vi } from 'vitest'
import { parse, stringify } from 'yaml'

import { ipcApi } from '@renderer/ipc'
import type { Provider } from '@shared/data/types/provider'

import { poolsideAdapter } from '../poolside'

afterEach(() => vi.restoreAllMocks())

it('switches Poolside gateway profiles without replacing native credentials, defaults or user settings', async () => {
  const files = [
    {
      target: 'poolside-settings' as const,
      label: 'Poolside',
      path: '/test/settings.yaml',
      language: 'yaml' as const,
      content:
        '# keep\npool:\n  api_url: https://native.test/v1\nagent_servers:\n  Poolside:\n    command: pool\n    args: [acp]\n    default_config_options:\n      model: poolside/laguna-s-2.1\n'
    }
  ]
  const context = {
    provider: { endpointConfigs: { 'openai-chat-completions': { baseUrl: 'http://127.0.0.1:1234/v1' } } } as Provider,
    apiKey: 'gateway-key',
    model: 'provider:test-model',
    modelRecord: null,
    configBlob: {}
  }
  const args = { cliTool: 'poolside', modelId: 'provider::test-model' as const, files }
  const draft = await poolsideAdapter.buildDraft(args, context)
  expect(poolsideAdapter.extractConnection(draft)).toEqual({
    baseUrl: 'http://127.0.0.1:1234/v1',
    apiKey: 'gateway-key',
    model: 'provider:test-model'
  })
  const saved = parse(draft[0].content)
  expect(saved.pool).toEqual({ api_url: 'https://native.test/v1', default_agent_server: 'cherry-poolside' })
  expect(saved.agent_servers.Poolside.default_config_options.model).toBe('poolside/laguna-s-2.1')
  expect(saved.agent_servers['cherry-poolside'].env.POOLSIDE_STANDALONE_MODEL).toBe('provider:test-model')
  expect(draft[0].content).toContain('# keep')
  expect(
    poolsideAdapter.extractConnection([
      {
        ...draft[0],
        content: stringify({ ...saved, pool: { ...saved.pool, default_agent_server: 'Poolside' } })
      }
    ])
  ).toBeNull()
  vi.spyOn(ipcApi, 'request').mockResolvedValue({
    files: [{ target: 'poolside-settings', path: '/test/settings.yaml', content: draft[0].content }]
  })
  const cleared = await poolsideAdapter.buildClearFiles()
  const native = parse(cleared[0].content!)
  expect(native.pool).toEqual({ api_url: 'https://native.test/v1' })
  expect(native.agent_servers.Poolside).toEqual(saved.agent_servers.Poolside)
  expect(native.agent_servers).not.toHaveProperty('cherry-poolside')
  expect(cleared[0].content).not.toContain('gateway-key')
})
