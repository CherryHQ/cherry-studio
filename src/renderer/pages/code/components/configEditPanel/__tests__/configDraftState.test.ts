import { dataApiService } from '@data/DataApiService'
import type { CliConfigFileDraft } from '@renderer/pages/code/cliConfig'
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

const { loadInitialConfigDraft } = await import('../configDraftState')

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
})
