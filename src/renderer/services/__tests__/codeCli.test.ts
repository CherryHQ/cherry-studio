import { dataApiService } from '@data/DataApiService'
import type { ApiKeyEntry, Provider } from '@shared/data/types/provider'
import { CodeCli } from '@shared/types/codeCli'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { injectCliConfig } from '../codeCli'

/** Per-path DataApi.get mock returning provider / api-keys / model payloads.
 * Prefixes are matched longest-first so `/providers/:id/api-keys` is not
 * shadowed by the `/providers/:id` entry. */
function mockGet(handlers: Record<string, () => unknown>) {
  const prefixes = Object.keys(handlers).sort((a, b) => b.length - a.length)
  vi.mocked(dataApiService.get).mockImplementation(async (path: string) => {
    for (const prefix of prefixes) {
      if (path.startsWith(prefix)) return handlers[prefix]()
    }
    return undefined
  })
}

const anthropicProvider = {
  id: 'anthropic',
  name: 'Anthropic',
  endpointConfigs: { 'anthropic-messages': { baseUrl: 'https://api.anthropic.com' } },
  defaultChatEndpoint: 'anthropic-messages'
} as unknown as Provider

const openaiCompatProvider = {
  id: 'deepseek',
  name: 'DeepSeek',
  endpointConfigs: {
    'openai-chat-completions': { baseUrl: 'https://api.deepseek.com/v1' }
  },
  defaultChatEndpoint: 'openai-chat-completions'
} as unknown as Provider

const enabledKey: ApiKeyEntry = { id: 'k1', key: 'sk-secret', isEnabled: true }

describe('injectCliConfig', () => {
  let written: { path: string; content: string } | null
  let writes: { path: string; content: string }[]
  let existing: Record<string, string>

  beforeEach(() => {
    written = null
    writes = []
    existing = {}
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        resolvePath: vi.fn(async (p: string) => `/resolved${p}`),
        file: {
          readExternal: vi.fn(async (absPath: string) => existing[absPath] ?? ''),
          write: vi.fn(async (absPath: string, content: string) => {
            written = { path: absPath, content }
            writes.push({ path: absPath, content })
          })
        }
      }
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('is a no-op for hermes / openclaw (still injected in main run())', async () => {
    mockGet({})
    await injectCliConfig({ cliTool: CodeCli.HERMES, modelId: 'p::m' })
    await injectCliConfig({ cliTool: CodeCli.OPENCLAW, modelId: 'p::m' })
    expect(written).toBeNull()
    expect(dataApiService.get).not.toHaveBeenCalled()
  })

  it('throws when the provider cannot be resolved', async () => {
    mockGet({ '/providers/ghost': () => undefined })
    await expect(injectCliConfig({ cliTool: CodeCli.CLAUDE_CODE, modelId: 'ghost::claude-4' })).rejects.toThrow(
      /Provider not found/
    )
  })

  describe('claude-code (~/.claude/settings.json)', () => {
    it('injects ANTHROPIC_AUTH_TOKEN/BASE_URL/MODEL into the env block', async () => {
      mockGet({
        '/providers/anthropic': () => anthropicProvider,
        '/providers/anthropic/api-keys': () => ({ keys: [enabledKey] }),
        '/models/': () => null
      })

      await injectCliConfig({
        cliTool: CodeCli.CLAUDE_CODE,
        modelId: 'anthropic::claude-sonnet-4-5'
      })

      expect(written).not.toBeNull()
      const parsed = JSON.parse(written!.content)
      expect(parsed.env).toEqual({
        ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
        ANTHROPIC_AUTH_TOKEN: 'sk-secret',
        ANTHROPIC_MODEL: 'claude-sonnet-4-5'
      })
    })

    it('deep-merges, preserving unrelated keys (mcpServers/theme) and clearing stale managed env keys', async () => {
      existing['/resolved~/.claude/settings.json'] = JSON.stringify({
        mcpServers: { fs: { command: 'npx' } },
        theme: 'dark',
        env: { ANTHROPIC_AUTH_TOKEN: 'sk-stale', KEEP: '1' }
      })
      mockGet({
        '/providers/anthropic': () => anthropicProvider,
        '/providers/anthropic/api-keys': () => ({ keys: [enabledKey] }),
        '/models/': () => null
      })

      await injectCliConfig({
        cliTool: CodeCli.CLAUDE_CODE,
        modelId: 'anthropic::claude-sonnet-4-5'
      })

      const parsed = JSON.parse(written!.content)
      expect(parsed.mcpServers).toEqual({ fs: { command: 'npx' } })
      expect(parsed.theme).toBe('dark')
      expect(parsed.env.KEEP).toBe('1')
      // stale token dropped, new token injected
      expect(parsed.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-secret')
    })

    it('drops previous config quick-options / model-roles / attribution on switch', async () => {
      // Simulate a native file written by a previous config that had every
      // Cherry-managed field set. The new config asserts none of them, so all
      // Cherry-managed keys must be cleared (each config is independent).
      existing['/resolved~/.claude/settings.json'] = JSON.stringify({
        theme: 'dark',
        attribution: { commit: '', pr: '' },
        env: {
          KEEP: '1',
          ANTHROPIC_DEFAULT_SONNET_MODEL: 'old-sonnet',
          ANTHROPIC_DEFAULT_SONNET_MODEL_NAME: 'old-sonnet',
          ANTHROPIC_DEFAULT_FABLE_MODEL: 'old-fable',
          ANTHROPIC_DEFAULT_FABLE_MODEL_NAME: 'old-fable',
          ENABLE_TOOL_SEARCH: 'true',
          CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1',
          CLAUDE_CODE_EFFORT_LEVEL: 'max',
          DISABLE_AUTOUPDATER: '1'
        }
      })
      mockGet({
        '/providers/anthropic': () => anthropicProvider,
        '/providers/anthropic/api-keys': () => ({ keys: [enabledKey] }),
        '/models/': () => null
      })

      await injectCliConfig({
        cliTool: CodeCli.CLAUDE_CODE,
        modelId: 'anthropic::claude-sonnet-4-5'
        // no configBlob: nothing re-asserted
      })

      const parsed = JSON.parse(written!.content)
      // unrelated key preserved
      expect(parsed.theme).toBe('dark')
      expect(parsed.env.KEEP).toBe('1')
      // stale managed env keys dropped
      expect(parsed.env).not.toHaveProperty('ANTHROPIC_DEFAULT_SONNET_MODEL')
      expect(parsed.env).not.toHaveProperty('ANTHROPIC_DEFAULT_SONNET_MODEL_NAME')
      expect(parsed.env).not.toHaveProperty('ANTHROPIC_DEFAULT_FABLE_MODEL')
      expect(parsed.env).not.toHaveProperty('ANTHROPIC_DEFAULT_FABLE_MODEL_NAME')
      expect(parsed.env).not.toHaveProperty('ENABLE_TOOL_SEARCH')
      expect(parsed.env).not.toHaveProperty('CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS')
      expect(parsed.env).not.toHaveProperty('CLAUDE_CODE_EFFORT_LEVEL')
      expect(parsed.env).not.toHaveProperty('DISABLE_AUTOUPDATER')
      // stale attribution dropped
      expect(parsed).not.toHaveProperty('attribution')
    })
  })

  describe('codex (~/.codex/config.toml + auth.json)', () => {
    const findWrite = (suffix: string) => writes.find((w) => w.path.endsWith(suffix))

    it('writes both auth.json (OPENAI_API_KEY) and config.toml (requires_openai_auth)', async () => {
      mockGet({
        '/providers/deepseek': () => openaiCompatProvider,
        '/providers/deepseek/api-keys': () => ({ keys: [enabledKey] }),
        '/models/': () => null
      })

      await injectCliConfig({
        cliTool: CodeCli.OPENAI_CODEX,
        modelId: 'deepseek::deepseek-chat'
      })

      const tomlWrite = findWrite('config.toml')
      const authWrite = findWrite('auth.json')
      expect(tomlWrite).toBeTruthy()
      expect(authWrite).toBeTruthy()

      const { parse: parseToml } = await import('smol-toml')
      const parsed = parseToml(tomlWrite!.content) as Record<string, any>
      expect(parsed.model).toBe('deepseek-chat')
      expect(parsed.model_provider).toBe('cherry-DeepSeek')
      expect(parsed.model_providers['cherry-DeepSeek'].base_url).toBe('https://api.deepseek.com/v1')
      expect(parsed.model_providers['cherry-DeepSeek'].requires_openai_auth).toBe(true)
      // chat-completions-only provider → wire_api follows the endpoint
      expect(parsed.model_providers['cherry-DeepSeek'].wire_api).toBe('chat_completions')
      // key lives in auth.json now, not as a bearer token
      expect(parsed.model_providers['cherry-DeepSeek']).not.toHaveProperty('experimental_bearer_token')
      expect(parsed.model_providers['cherry-DeepSeek'].name).toBe('DeepSeek')
      // goal mode is off by default → no features block
      expect(parsed).not.toHaveProperty('features')

      const authParsed = JSON.parse(authWrite!.content)
      expect(authParsed.OPENAI_API_KEY).toBe('sk-secret')
    })

    it('merges OPENAI_API_KEY into auth.json, preserving unrelated OAuth keys', async () => {
      existing['/resolved~/.codex/auth.json'] = JSON.stringify({
        tokens: { id_token: 'oauth-jwt', access_token: 'oauth-access' }
      })
      mockGet({
        '/providers/deepseek': () => openaiCompatProvider,
        '/providers/deepseek/api-keys': () => ({ keys: [enabledKey] }),
        '/models/': () => null
      })

      await injectCliConfig({
        cliTool: CodeCli.OPENAI_CODEX,
        modelId: 'deepseek::deepseek-chat'
      })

      const authParsed = JSON.parse(findWrite('auth.json')!.content)
      expect(authParsed.tokens).toEqual({ id_token: 'oauth-jwt', access_token: 'oauth-access' })
      expect(authParsed.OPENAI_API_KEY).toBe('sk-secret')
    })

    it('applies goal mode + remote compaction from the config blob', async () => {
      mockGet({
        '/providers/deepseek': () => openaiCompatProvider,
        '/providers/deepseek/api-keys': () => ({ keys: [enabledKey] }),
        '/models/': () => null
      })

      await injectCliConfig({
        cliTool: CodeCli.OPENAI_CODEX,
        modelId: 'deepseek::deepseek-chat',
        configBlob: { goalMode: true, remoteCompaction: true }
      })

      const { parse: parseToml } = await import('smol-toml')
      const parsed = parseToml(findWrite('config.toml')!.content) as Record<string, any>
      expect(parsed.features).toEqual({ goals: true })
      expect(parsed.model_providers['cherry-DeepSeek'].name).toBe('OpenAI')
    })

    it('clears stale goal-mode / OpenAI name from a previous config when toggles are off', async () => {
      // Previous config had goal mode + remote compaction on; the new config
      // asserts neither, so both must be cleared (configs are independent).
      existing['/resolved~/.codex/config.toml'] = [
        'model = "deepseek-chat"',
        'model_provider = "cherry-DeepSeek"',
        '',
        '[features]',
        'goals = true',
        '',
        '[model_providers.cherry-DeepSeek]',
        'name = "OpenAI"',
        'base_url = "https://api.deepseek.com/v1"',
        'wire_api = "responses"',
        'requires_openai_auth = true',
        ''
      ].join('\n')
      mockGet({
        '/providers/deepseek': () => openaiCompatProvider,
        '/providers/deepseek/api-keys': () => ({ keys: [enabledKey] }),
        '/models/': () => null
      })

      await injectCliConfig({
        cliTool: CodeCli.OPENAI_CODEX,
        modelId: 'deepseek::deepseek-chat'
        // no goalMode / remoteCompaction in the blob
      })

      const { parse: parseToml } = await import('smol-toml')
      const parsed = parseToml(findWrite('config.toml')!.content) as Record<string, any>
      expect(parsed).not.toHaveProperty('features')
      expect(parsed.model_providers['cherry-DeepSeek'].name).toBe('DeepSeek')
    })

    it('prefers the responses endpoint and sets wire_api = responses when available', async () => {
      const responsesProvider = {
        ...openaiCompatProvider,
        endpointConfigs: {
          'openai-chat-completions': { baseUrl: 'https://chat.example.com' },
          'openai-responses': { baseUrl: 'https://api.deepseek.com/v1' }
        }
      } as unknown as Provider
      mockGet({
        '/providers/deepseek': () => responsesProvider,
        '/providers/deepseek/api-keys': () => ({ keys: [enabledKey] }),
        '/models/': () => null
      })

      await injectCliConfig({ cliTool: CodeCli.OPENAI_CODEX, modelId: 'deepseek::deepseek-chat' })

      const { parse: parseToml } = await import('smol-toml')
      const parsed = parseToml(findWrite('config.toml')!.content) as Record<string, any>
      expect(parsed.model_providers['cherry-DeepSeek'].base_url).toBe('https://api.deepseek.com/v1')
      expect(parsed.model_providers['cherry-DeepSeek'].wire_api).toBe('responses')
    })

    it('throws when the provider has no OpenAI endpoint base URL', async () => {
      const noUrl = { ...openaiCompatProvider, endpointConfigs: {} } as unknown as Provider
      mockGet({
        '/providers/deepseek': () => noUrl,
        '/providers/deepseek/api-keys': () => ({ keys: [enabledKey] }),
        '/models/': () => null
      })
      await expect(
        injectCliConfig({ cliTool: CodeCli.OPENAI_CODEX, modelId: 'deepseek::deepseek-chat' })
      ).rejects.toThrow(/OpenAI endpoint base URL/)
    })
  })

  describe('opencode (~/.config/opencode/opencode.json)', () => {
    const opencodeWrite = () => writes.find((w) => w.path.endsWith('opencode.json'))!

    const reasoningModel = {
      id: 'deepseek-chat',
      reasoning: { supportedEfforts: ['low', 'medium', 'high'] }
    } as unknown

    it('writes a Cherry-* provider with the model and no reasoning by default', async () => {
      mockGet({
        '/providers/deepseek': () => openaiCompatProvider,
        '/providers/deepseek/api-keys': () => ({ keys: [enabledKey] }),
        '/models/': () => null
      })

      await injectCliConfig({
        cliTool: CodeCli.OPEN_CODE,
        modelId: 'deepseek::deepseek-chat'
      })

      const parsed = JSON.parse(opencodeWrite().content)
      const provider = parsed.provider['cherry-DeepSeek']
      expect(provider.npm).toBe('@ai-sdk/openai-compatible')
      expect(provider.options.apiKey).toBe('sk-secret')
      expect(provider.options.baseURL).toBe('https://api.deepseek.com/v1')
      const model = provider.models['deepseek-chat']
      expect(model.name).toBe('deepseek-chat')
      expect(model).not.toHaveProperty('reasoning')
      expect(model).not.toHaveProperty('limit')
    })

    it('enables anthropic thinking when reasoning is on', async () => {
      mockGet({
        '/providers/anthropic': () => anthropicProvider,
        '/providers/anthropic/api-keys': () => ({ keys: [enabledKey] }),
        '/models/': () => null
      })

      await injectCliConfig({
        cliTool: CodeCli.OPEN_CODE,
        modelId: 'anthropic::claude-sonnet-4-5',
        configBlob: { env: { OPENCODE_REASONING: 'true' } }
      })

      const parsed = JSON.parse(opencodeWrite().content)
      const model = parsed.provider['cherry-Anthropic'].models['claude-sonnet-4-5']
      expect(model.reasoning).toBe(true)
      expect(model.options.thinking).toEqual({ budgetTokens: 10000, type: 'enabled' })
    })

    it('uses reasoningEffort for openai-compatible models that support it', async () => {
      mockGet({
        '/providers/deepseek': () => openaiCompatProvider,
        '/providers/deepseek/api-keys': () => ({ keys: [enabledKey] }),
        '/models/': () => reasoningModel
      })

      await injectCliConfig({
        cliTool: CodeCli.OPEN_CODE,
        modelId: 'deepseek::deepseek-chat',
        configBlob: { env: { OPENCODE_REASONING: 'true' } }
      })

      const parsed = JSON.parse(opencodeWrite().content)
      const model = parsed.provider['cherry-DeepSeek'].models['deepseek-chat']
      expect(model.reasoning).toBe(true)
      expect(model.options.reasoningEffort).toBe('medium')
    })
  })
})
