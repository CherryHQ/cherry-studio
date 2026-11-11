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
