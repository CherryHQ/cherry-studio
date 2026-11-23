import { parse as parseToml } from 'smol-toml'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ipcApi } from '@renderer/ipc'
import { MODEL_CAPABILITY, type Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { CodeCli } from '@shared/types/codeCli'
import { CLI_CONFIG_FILE_SPECS, type ModelConfiguredCli } from '@shared/utils/cliConfig'

import { getAdapter } from '../adapters'
import { parseDotenv } from '../dotenv'
import { createCliConfigDraftFiles } from '../draftFiles'
import type { CliConfigFileDraft, ResolvedCliConfigContext } from '../types'

const tools: ModelConfiguredCli[] = ['kilo', 'factory-droid', 'mistral-vibe', CodeCli.GITHUB_COPILOT_CLI]
const context: ResolvedCliConfigContext = {
  provider: {
    id: 'test',
    name: 'Test',
    endpointConfigs: { 'openai-chat-completions': { baseUrl: 'https://example.test/v1' } }
  } as Provider,
  model: 'provider:org/test-model',
  modelLabel: 'Test Model',
  apiKey: 'gateway-key',
  modelRecord: {
    apiModelId: 'org/test-model',
    endpointTypes: ['openai-chat-completions'],
    capabilities: [MODEL_CAPABILITY.FUNCTION_CALL],
    supportsStreaming: true,
    contextWindow: 128000,
    maxInputTokens: 120000,
    maxOutputTokens: 8000
  } as Model,
  configBlob: {}
}

function initialFiles(tool: ModelConfiguredCli): CliConfigFileDraft[] {
  const contents: Record<string, string> = {
    'kilo-config': '{"theme":"dark","provider":{"user":{"options":{"apiKey":"user-key"}}}}',
    'factory-settings':
      '{"theme":"dark","customModels":[{"model":"user-model","apiKey":"user-key"}],"sessionDefaultSettings":{"reasoningEffort":"high"}}',
    'copilot-settings': '{"theme":"dark"}',
    'copilot-providers':
      '{"providers":[{"name":"user","apiKey":"user-key"}],"models":[{"id":"user-model","provider":"user"}]}',
    'vibe-config':
      'theme = "dark"\n[[providers]]\nname = "user"\napi_base = "https://user.test"\n[[models]]\nname = "user-model"\nprovider = "user"\n',
    'vibe-env': '# keep my credentials\nUSER_KEY=user-key\n'
  }
  return getAdapter(tool)!.targets.map((target) => ({
    target,
    path: `/test/${target}`,
    label: target,
    language: CLI_CONFIG_FILE_SPECS[target].language,
    content: contents[target] ?? ''
  }))
}

const json = (files: CliConfigFileDraft[], target: string) =>
  JSON.parse(files.find((file) => file.target === target)!.content)

afterEach(() => vi.restoreAllMocks())

describe.each(tools)('%s persistent model configuration', (tool) => {
  it('writes the gateway wire model and preserves user configuration across selections', async () => {
    const adapter = getAdapter(tool)!
    const args = { cliTool: tool, modelId: 'test::model' as const }
    const draft = await adapter.buildDraft({ ...args, files: initialFiles(tool) }, context)
    expect(adapter.extractConnection(draft)).toEqual({
      model: context.model,
      apiKey: 'gateway-key',
      baseUrl: 'https://example.test/v1'
    })
    const next = await adapter.buildDraft({ ...args, files: draft }, { ...context, model: 'provider:next' })
    expect(adapter.extractConnection(next)?.model).toBe('provider:next')
    const text = next.map((file) => file.content).join('\n')
    expect(text).toContain('user-key')
    expect(text).not.toContain('provider:org/test-model')

    if (tool === 'kilo') {
      expect(json(next, 'kilo-config')).toMatchObject({
        theme: 'dark',
        model: 'cherry-Test/provider:next',
        provider: {
          'cherry-Test': {
            npm: '@ai-sdk/openai-compatible',
            models: { 'provider:next': { limit: { context: 128000, output: 8000 } } }
          }
        }
      })
    } else if (tool === 'factory-droid') {
      expect(json(next, 'factory-settings')).toMatchObject({
        theme: 'dark',
        sessionDefaultSettings: { model: 'custom:provider:next', reasoningEffort: 'high' },
        customModels: [
          { model: 'user-model' },
          { model: 'provider:next', provider: 'generic-chat-completion-api', maxContextLimit: 120000 }
        ]
      })
    } else if (tool === 'mistral-vibe') {
      expect(parseToml(next.find((f) => f.target === 'vibe-config')!.content)).toMatchObject({
        active_model: 'cherry-Test',
        theme: 'dark',
        models: [{ name: 'user-model' }, { name: 'provider:next', alias: 'cherry-Test', max_context_length: 128000 }]
      })
    } else {
      expect(json(next, 'copilot-settings')).toEqual({ theme: 'dark', model: 'cherry-Test/provider:next' })
      expect(json(next, 'copilot-providers').models[1]).toMatchObject({
        id: 'provider:next',
        modelId: 'org/test-model',
        capabilities: { supports: { toolCalls: true, streaming: true, vision: false } }
      })
    }
  })

  it('removes managed credentials and defaults without deleting user models', async () => {
    const adapter = getAdapter(tool)!
    const draft = await adapter.buildDraft(
      { cliTool: tool, modelId: 'test::model', files: initialFiles(tool) },
      context
    )
    vi.spyOn(ipcApi, 'request').mockResolvedValue({
      files: adapter.targets.map((target) => ({
        target,
        path: `/test/${target}`,
        content: draft.find((f) => f.target === target)?.content ?? null
      }))
    })
    const cleared = await adapter.buildClearFiles()
    const text = cleared.map((file) => file.content).join('\n')
    expect(text).not.toContain('gateway-key')
    expect(text).not.toContain('provider:org/test-model')
    expect(text).toContain('user-key')
    expect(text).toContain('dark')
    if (tool === 'mistral-vibe') {
      expect(parseDotenv(cleared.find((f) => f.target === 'vibe-env')!.content!)).toEqual(
        new Map([['USER_KEY', 'user-key']])
      )
      expect(text).toContain('# keep my credentials')
    }
    expect(
      adapter.extractConnection(
        createCliConfigDraftFiles(cleared.map((f) => ({ ...f, path: `/test/${f.target}`, content: f.content ?? null })))
      )?.apiKey
    ).toBeUndefined()
  })

  it.each(['anthropic-messages', 'openai-responses'] as const)('selects the %s protocol', async (endpoint) => {
    const adapter = getAdapter(tool)!
    const draft = await adapter.buildDraft(
      { cliTool: tool, modelId: 'test::model', files: initialFiles(tool) },
      {
        ...context,
        provider: { ...context.provider, endpointConfigs: { [endpoint]: { baseUrl: 'https://example.test/v1' } } },
        modelRecord: { ...context.modelRecord!, endpointTypes: [endpoint] }
      }
    )
    expect(adapter.extractConnection(draft)?.baseUrl).toBe(
      endpoint === 'anthropic-messages' && tool !== 'kilo' ? 'https://example.test' : 'https://example.test/v1'
    )
    if (tool === 'kilo') {
      expect(json(draft, 'kilo-config').provider['cherry-Test'].npm).toBe(
        endpoint === 'anthropic-messages' ? '@ai-sdk/anthropic' : '@ai-sdk/openai'
      )
    } else if (tool === 'factory-droid') {
      expect(json(draft, 'factory-settings').customModels.at(-1).provider).toBe(
        endpoint === 'anthropic-messages' ? 'anthropic' : 'openai'
      )
    } else if (tool === 'mistral-vibe') {
      expect(
        (parseToml(draft.find((f) => f.target === 'vibe-config')!.content).providers as { api_style: string }[]).at(-1)
          ?.api_style
      ).toBe(endpoint === 'anthropic-messages' ? 'anthropic' : 'openai-responses')
    } else {
      expect(json(draft, 'copilot-providers').providers.at(-1)).toMatchObject({
        type: endpoint === 'anthropic-messages' ? 'anthropic' : 'openai',
        wireApi: endpoint === 'anthropic-messages' ? 'completions' : 'responses'
      })
    }
  })
})

it('does not overwrite a Droid user model with the same API ID', async () => {
  const files = initialFiles('factory-droid')
  await expect(
    getAdapter('factory-droid')!.buildDraft(
      { cliTool: 'factory-droid', modelId: 'test::model', files },
      { ...context, model: 'user-model' }
    )
  ).rejects.toThrow(/相同 ID|custom model/)
})

it.each([
  ['factory-droid', 'factory-settings', '{"customModels":{}}'],
  ['mistral-vibe', 'vibe-config', 'providers="invalid"'],
  [CodeCli.GITHUB_COPILOT_CLI, 'copilot-providers', '{"models":{}}']
] as const)(
  'rejects malformed %s model lists instead of replacing user configuration',
  async (tool, target, content) => {
    const files = initialFiles(tool).map((file) => (file.target === target ? { ...file, content } : file))
    await expect(
      getAdapter(tool)!.buildDraft({ cliTool: tool, modelId: 'test::model', files }, context)
    ).rejects.toThrow()
  }
)

describe('extra custom-endpoint local agent adapters', () => {
  const extraTools = ['grok-build', 'omp', 'goose', 'cline', 'zcode', 'snow', 'glm-acp-agent'] as const

  function makeInitialFiles(tool: (typeof extraTools)[number]) {
    const adapter = getAdapter(tool)!
    const seedContent: Record<string, string> = {
      'grok-config': 'theme = "dark"\n[model.user-model]\nmodel = "grok-4.6"\napi_key = "user-key"\n',
      'omp-settings': 'theme: dark\ncustom: false\n',
      'omp-models': 'providers:\n  user-provider:\n    apiKey: user-key\n',
      'goose-config': 'theme: dark\nUSER_API_KEY: user-key\n',
      'cline-settings': '{"theme":"dark","userKey":"user-key"}\n',
      'cline-providers': '{"providers":{"user-provider":{"apiKey":"user-key"}}}\n',
      'zcode-config': '{"theme":"dark","userKey":"user-key"}\n',
      'zcode-providers': '{"providers":{"user-provider":{"apiKey":"user-key"}}}\n',
      'snow-config': '{"theme":"dark","providers":{"user-provider":{"apiKey":"user-key"}}}\n',
      'glm-credentials': '{"theme":"dark","providers":{"user-provider":{"apiKey":"user-key"}}}\n'
    }
    return createCliConfigDraftFiles(
      adapter.targets.map((target) => ({
        target,
        path: `/test/${target}`,
        content: seedContent[target] ?? null
      }))
    )
  }

  it.each(extraTools)('%s builds, extracts, preserves user keys, and clears cleanly', async (tool) => {
    const adapter = getAdapter(tool)!
    const files = makeInitialFiles(tool)
    const draft = await adapter.buildDraft({ cliTool: tool, modelId: 'test::model', files }, context)
    const mergedDraft = adapter.targets.map(
      (target) => draft.find((f) => f.target === target) ?? files.find((f) => f.target === target)!
    )
    const draftText = draft.map((f) => f.content).join('\n')
    const mergedDraftText = mergedDraft.map((f) => f.content).join('\n')
    expect(draftText).toContain('gateway-key')
    expect(draftText).toContain('provider:org/test-model')
    expect(mergedDraftText).toContain('user-key')
    expect(mergedDraftText).toContain('dark')

    const connection = adapter.extractConnection(draft)
    expect(connection).toMatchObject({
      apiKey: 'gateway-key',
      model: 'provider:org/test-model'
    })
    expect(connection?.baseUrl).toBeTruthy()

    vi.spyOn(ipcApi, 'request').mockResolvedValue({
      files: adapter.targets.map((target) => ({
        target,
        path: `/test/${target}`,
        content: draft.find((f) => f.target === target)?.content ?? null
      }))
    })
    const cleared = await adapter.buildClearFiles()
    const mergedClearedText = adapter.targets
      .map(
        (target) =>
          cleared.find((f) => f.target === target)?.content ??
          draft.find((f) => f.target === target)?.content ??
          files.find((f) => f.target === target)?.content ??
          ''
      )
      .join('\n')
    expect(cleared.map((f) => f.content).join('\n')).not.toContain('gateway-key')
    expect(mergedClearedText).not.toContain('gateway-key')
    expect(mergedClearedText).not.toContain('provider:org/test-model')
    expect(mergedClearedText).toContain('user-key')
    expect(mergedClearedText).toContain('dark')

    const clearedDraft = createCliConfigDraftFiles(
      adapter.targets.map((target) => ({
        target,
        path: `/test/${target}`,
        content:
          cleared.find((f) => f.target === target)?.content ?? draft.find((f) => f.target === target)?.content ?? null
      }))
    )
    expect(adapter.extractConnection(clearedDraft)).toBeNull()
  })

  it('writes CLI-native schemas for glm-acp-agent, snow, zcode, and cline', async () => {
    const glmDraft = await getAdapter('glm-acp-agent')!.buildDraft(
      { cliTool: 'glm-acp-agent', modelId: 'test::model', files: makeInitialFiles('glm-acp-agent') },
      context
    )
    expect(json(glmDraft, 'glm-credentials')).toMatchObject({
      theme: 'dark',
      z_ai_api_key: 'gateway-key',
      base_url: 'https://example.test/v1',
      model: 'provider:org/test-model',
      cherry_managed: true
    })

    const snowDraft = await getAdapter('snow')!.buildDraft(
      { cliTool: 'snow', modelId: 'test::model', files: makeInitialFiles('snow') },
      context
    )
    expect(json(snowDraft, 'snow-config')).toMatchObject({
      cherryManaged: true,
      snowcfg: {
        baseUrl: 'https://example.test/v1',
        baseUrlMode: 'auto',
        apiKey: 'gateway-key',
        requestMethod: 'chat',
        advancedModel: 'provider:org/test-model',
        basicModel: 'provider:org/test-model'
      }
    })

    const anthropicGatewayProvider = {
      id: 'api-gateway',
      name: 'Gateway',
      endpointConfigs: { 'anthropic-messages': { baseUrl: 'http://127.0.0.1:23334' } }
    } as Provider
    const snowAnthropicAdapter = getAdapter('snow')!
    expect(snowAnthropicAdapter.providerBaseUrls(anthropicGatewayProvider)).toEqual(['http://127.0.0.1:23334/v1'])
    const snowAnthropicDraft = await snowAnthropicAdapter.buildDraft(
      { cliTool: 'snow', modelId: 'gw::claude', files: makeInitialFiles('snow') },
      {
        ...context,
        provider: anthropicGatewayProvider,
        model: 'anthropic/claude-sonnet',
        modelRecord: { ...context.modelRecord!, endpointTypes: ['anthropic-messages'] }
      }
    )
    expect(json(snowAnthropicDraft, 'snow-config')).toMatchObject({
      cherryManaged: true,
      snowcfg: {
        baseUrl: 'http://127.0.0.1:23334/v1',
        baseUrlMode: 'auto',
        requestMethod: 'anthropic'
      }
    })

    const zcodeDraft = await getAdapter('zcode')!.buildDraft(
      { cliTool: 'zcode', modelId: 'test::model', files: makeInitialFiles('zcode') },
      context
    )
    expect(json(zcodeDraft, 'zcode-config')).toMatchObject({
      theme: 'dark',
      userKey: 'user-key',
      provider: {
        'cherry-Test': {
          kind: 'openai-compatible',
          source: 'custom',
          enabled: true,
          options: { baseURL: 'https://example.test/v1', apiKey: 'gateway-key' },
          models: { 'provider:org/test-model': { name: 'Test Model', limit: { context: 128000, output: 8000 } } }
        }
      }
    })

    const clineDraft = await getAdapter('cline')!.buildDraft(
      { cliTool: 'cline', modelId: 'test::model', files: makeInitialFiles('cline') },
      context
    )
    expect(json(clineDraft, 'cline-providers')).toMatchObject({
      version: 1,
      lastUsedProvider: 'openai-compatible',
      providers: {
        'user-provider': { apiKey: 'user-key' },
        'openai-compatible': {
          cherryManaged: true,
          settings: {
            provider: 'openai-compatible',
            apiKey: 'gateway-key',
            baseUrl: 'https://example.test/v1',
            model: 'provider:org/test-model'
          }
        }
      }
    })
  })

  it('keeps unmanaged goose-config and grok-config hidden from connection extraction', () => {
    expect(
      getAdapter('goose')!.extractConnection(
        createCliConfigDraftFiles([{ target: 'goose-config', path: '/test/goose', content: 'GOOSE_MODEL: old\n' }])
      )
    ).toBeNull()
    expect(
      getAdapter('grok-build')!.extractConnection(
        createCliConfigDraftFiles([
          {
            target: 'grok-config',
            path: '/test/grok',
            content: '[models]\ndefault = "grok-4.6"\n[model."grok-4.6"]\nmodel = "grok-4.6"\n'
          }
        ])
      )
    ).toBeNull()
  })

  it('writes api_backend = "responses" for grok-build only on openai-responses', async () => {
    const adapter = getAdapter('grok-build')!
    const responsesDraft = await adapter.buildDraft(
      { cliTool: 'grok-build', modelId: 'test::model', files: makeInitialFiles('grok-build') },
      {
        ...context,
        provider: {
          ...context.provider,
          endpointConfigs: { 'openai-responses': { baseUrl: 'https://example.test/v1' } }
        },
        modelRecord: { ...context.modelRecord!, endpointTypes: ['openai-responses'] }
      }
    )
    expect(responsesDraft[0].content).toContain('api_backend = "responses"')

    const chatDraft = await adapter.buildDraft(
      { cliTool: 'grok-build', modelId: 'test::model', files: makeInitialFiles('grok-build') },
      {
        ...context,
        provider: {
          ...context.provider,
          endpointConfigs: { 'openai-chat-completions': { baseUrl: 'https://example.test/v1' } }
        },
        modelRecord: { ...context.modelRecord!, endpointTypes: ['openai-chat-completions'] }
      }
    )
    expect(chatDraft[0].content).not.toContain('api_backend')
  })

  it.each(['anthropic-messages', 'openai-responses'] as const)(
    'goose selects %s protocol cleanly without a trailing /v1 host suffix',
    async (endpoint) => {
      const adapter = getAdapter('goose')!
      const provider = {
        ...context.provider,
        endpointConfigs: { [endpoint]: { baseUrl: 'https://example.test/v1' } }
      } as Provider
      expect(adapter.providerBaseUrls(provider)).toEqual(['https://example.test'])
      const draft = await adapter.buildDraft(
        { cliTool: 'goose', modelId: 'test::model', files: makeInitialFiles('goose') },
        {
          ...context,
          provider,
          modelRecord: { ...context.modelRecord!, endpointTypes: [endpoint] }
        }
      )
      expect(adapter.extractConnection(draft)).toEqual({
        baseUrl: 'https://example.test',
        apiKey: 'gateway-key',
        model: 'provider:org/test-model'
      })
    }
  )
})
