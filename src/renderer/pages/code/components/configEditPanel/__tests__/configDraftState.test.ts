import { dataApiService } from '@data/DataApiService'
import type { CliConfigFileDraft } from '@renderer/pages/code/cliConfig'
import type { Model, UniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { CLI_API_GATEWAY_PROVIDER_ID, CodeCli } from '@shared/types/codeCli'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ConfigDraft } from '../types'

const mocks = vi.hoisted(() => ({ readCliConfigFiles: vi.fn() }))

vi.mock('@renderer/pages/code/cliConfig', async (importOriginal) => {
  // oxlint-disable-next-line consistent-type-imports
  const actual = await importOriginal<typeof import('@renderer/pages/code/cliConfig')>()
  return { ...actual, readCliConfigFiles: mocks.readCliConfigFiles }
})

const { createManagedConfigDraft, loadInitialConfigDraft } = await import('../configDraftState')
const { extractConfigFromCliConfigDraft } = await import('@renderer/pages/code/cliConfig')

const GATEWAY_BASE_URL = 'http://127.0.0.1:23333'

const gatewayProvider = {
  id: CLI_API_GATEWAY_PROVIDER_ID,
  name: '统一网关',
  endpointConfigs: {
    'anthropic-messages': { baseUrl: GATEWAY_BASE_URL },
    'openai-chat-completions': { baseUrl: GATEWAY_BASE_URL },
    'openai-responses': { baseUrl: GATEWAY_BASE_URL }
  },
  defaultChatEndpoint: 'anthropic-messages'
} as unknown as Provider

const gateway = { provider: gatewayProvider, apiKey: 'cs-sk-gateway' }

// The settings file a previous gateway save left on disk: gateway URL + gateway
// key + gateway-addressed model, never the real provider key.
const gatewayWrittenFiles: CliConfigFileDraft[] = [
  {
    target: 'claude-settings',
    label: 'Claude settings.json',
    path: '/home/.claude/settings.json',
    language: 'json',
    content: JSON.stringify({
      env: {
        ANTHROPIC_BASE_URL: GATEWAY_BASE_URL,
        ANTHROPIC_AUTH_TOKEN: 'cs-sk-gateway',
        ANTHROPIC_MODEL: 'deepseek:deepseek-chat'
      }
    })
  }
]

const initialDraftSeed: ConfigDraft = {
  modelId: 'deepseek::deepseek-chat',
  config: {},
  files: [],
  connection: null,
  mode: 'managed',
  error: ''
}

describe('loadInitialConfigDraft (cherry gateway)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // The managed rebuild resolves spec paths renderer-side (makeDraftFile); the
    // on-disk fixture itself arrives through the mocked readCliConfigFiles.
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { resolvePath: vi.fn(async (p: string) => `/resolved${p}`) }
    })
    mocks.readCliConfigFiles.mockResolvedValue(gatewayWrittenFiles)
    // Expose the real provider key through DataApi: if the initial load ever
    // resolves the real provider, the leak shows up in the assertions below.
    vi.mocked(dataApiService.get).mockImplementation(async (path: string) => {
      if (path === '/models/deepseek::deepseek-chat') return { id: 'deepseek-chat', apiModelId: 'deepseek-chat' }
      if (path === '/providers/deepseek/api-keys') return { keys: [{ id: 'k1', key: 'sk-REAL', isEnabled: true }] }
      if (path === '/providers/deepseek') return { id: 'deepseek', name: 'DeepSeek' }
      return undefined
    })
  })

  it('rebuilds the initial preview through the gateway without reading the real provider api-key', async () => {
    const draft = await loadInitialConfigDraft({
      cliTool: CodeCli.CLAUDE_CODE,
      providerId: CLI_API_GATEWAY_PROVIDER_ID,
      isCurrentProvider: true,
      initialModelId: 'deepseek::deepseek-chat',
      initialConfig: {},
      initialClaudeModelMode: 'common',
      initialDraftSeed,
      connectionMatchesProvider: () => true,
      gateway
    })

    expect(dataApiService.get).not.toHaveBeenCalledWith('/providers/deepseek')
    expect(dataApiService.get).not.toHaveBeenCalledWith('/providers/deepseek/api-keys')

    expect(draft.mode).toBe('managed')
    expect(draft.error).toBe('')
    const settings = draft.files.find((file) => file.target === 'claude-settings')
    const env = JSON.parse(settings!.content).env
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('cs-sk-gateway')
    expect(env.ANTHROPIC_MODEL).toBe('deepseek:deepseek-chat')
    expect(settings!.content).not.toContain('sk-REAL')
  })

  it('rebuilds detailed Claude role models through gateway addresses', async () => {
    const model = {
      id: 'deepseek::deepseek-chat',
      providerId: 'deepseek',
      apiModelId: 'deepseek-chat'
    } as unknown as Model
    const detailedConfig = {
      env: {
        ANTHROPIC_DEFAULT_FABLE_MODEL: 'deepseek:deepseek-chat',
        ANTHROPIC_DEFAULT_FABLE_MODEL_NAME: 'deepseek:deepseek-chat'
      }
    }

    const draft = await loadInitialConfigDraft({
      cliTool: CodeCli.CLAUDE_CODE,
      providerId: CLI_API_GATEWAY_PROVIDER_ID,
      isCurrentProvider: false,
      initialModelId: undefined,
      initialConfig: detailedConfig,
      initialClaudeModelMode: 'detailed',
      initialDraftSeed: { ...initialDraftSeed, modelId: undefined, config: detailedConfig },
      connectionMatchesProvider: () => true,
      gateway,
      gatewayModels: new Map<UniqueModelId, Model>([[model.id, model]])
    })

    expect(draft.error).toBe('')
    const settings = draft.files.find((file) => file.target === 'claude-settings')
    const env = JSON.parse(settings!.content).env
    expect(env.ANTHROPIC_DEFAULT_FABLE_MODEL).toBe('deepseek:deepseek-chat')
    expect(env.ANTHROPIC_MODEL).toBeUndefined()
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('cs-sk-gateway')
  })
})

describe('createManagedConfigDraft (config-only preview)', () => {
  it('updates the existing Codex preview without a selected model', async () => {
    const files: CliConfigFileDraft[] = [
      {
        target: 'codex-config',
        label: 'Codex config.toml',
        path: '/home/.codex/config.toml',
        language: 'toml',
        content: [
          'model = "existing-model"',
          'model_provider = "cherry-existing"',
          '[model_providers.cherry-existing]',
          'base_url = "https://example.com/v1"',
          'wire_api = "responses"'
        ].join('\n')
      },
      {
        target: 'codex-auth',
        label: 'Codex auth.json',
        path: '/home/.codex/auth.json',
        language: 'json',
        content: JSON.stringify({ OPENAI_API_KEY: 'test-key' })
      }
    ]

    const draft = await createManagedConfigDraft({
      cliTool: CodeCli.OPENAI_CODEX,
      modelId: undefined,
      config: { goalMode: true },
      files
    })

    expect(extractConfigFromCliConfigDraft(CodeCli.OPENAI_CODEX, draft.files)).toEqual({ goalMode: true })
  })

  it('updates the existing OpenCode preview without a selected model', async () => {
    const files: CliConfigFileDraft[] = [
      {
        target: 'opencode-config',
        label: 'OpenCode opencode.json',
        path: '/home/.config/opencode/opencode.json',
        language: 'json',
        content: JSON.stringify({
          provider: {
            'cherry-existing': {
              npm: '@ai-sdk/openai-compatible',
              options: { apiKey: 'test-key', baseURL: 'https://example.com/v1' },
              models: { 'existing-model': { name: 'Existing Model' } }
            }
          }
        })
      }
    ]

    const draft = await createManagedConfigDraft({
      cliTool: CodeCli.OPEN_CODE,
      modelId: undefined,
      config: { autoCompact: true },
      files
    })

    const config = JSON.parse(draft.files[0].content)
    expect(config.compaction.auto).toBe(true)
    expect(config).not.toHaveProperty('autoCompact')

    const disabledDraft = await createManagedConfigDraft({
      cliTool: CodeCli.OPEN_CODE,
      modelId: undefined,
      config: {},
      files: draft.files
    })

    expect(disabledDraft.error).toBe('')
    const disabledConfig = JSON.parse(disabledDraft.files[0].content)
    expect(disabledConfig).not.toHaveProperty('compaction')
  })
})
