import { dataApiService } from '@data/DataApiService'
import type { ApiKeyEntry, Provider } from '@shared/data/types/provider'
import { CodeCli } from '@shared/types/codeCli'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { clearCliConfig, writeCliConfigDraft } from '../index'

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

/** Gemini-CLI-allow-listed aggregator (CLI_TOOL_PROVIDER_MAP) with no dedicated
 * google-generate-content endpoint and no GEMINI_AGGREGATOR_BASE_URLS entry. */
const cherryinProvider = {
  id: 'cherryin',
  name: 'CherryIN',
  defaultChatEndpoint: 'openai-chat-completions',
  endpointConfigs: {
    'anthropic-messages': { baseUrl: 'https://open.cherryin.net' },
    'openai-chat-completions': { baseUrl: 'https://open.cherryin.net' }
  }
} as unknown as Provider

const ollamaProvider = {
  id: 'ollama',
  name: 'Ollama',
  endpointConfigs: { 'anthropic-messages': { baseUrl: 'http://localhost:11434' } },
  defaultChatEndpoint: 'ollama-chat'
} as unknown as Provider

const openaiCompatProvider = {
  id: 'deepseek',
  name: 'DeepSeek',
  endpointConfigs: {
    'openai-chat-completions': { baseUrl: 'https://api.deepseek.com/v1' }
  },
  defaultChatEndpoint: 'openai-chat-completions'
} as unknown as Provider

const geminiProvider = {
  id: 'gemini',
  name: 'Gemini',
  endpointConfigs: {
    'google-generate-content': { baseUrl: 'https://generativelanguage.googleapis.com' }
  },
  defaultChatEndpoint: 'google-generate-content'
} as unknown as Provider

/** Responses-capable provider — the only kind Codex can target (its binary
 * rejects `wire_api = "chat"`). */
const codexProvider = {
  ...openaiCompatProvider,
  endpointConfigs: { 'openai-responses': { baseUrl: 'https://api.deepseek.com/v1' } }
} as unknown as Provider

const enabledKey: ApiKeyEntry = { id: 'k1', key: 'sk-secret', isEnabled: true }

describe('writeCliConfigDraft', () => {
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
          readExternal: vi.fn(async (absPath: string) => {
            if (absPath in existing) return existing[absPath]
            throw new Error(`File does not exist: ${absPath}`)
          }),
          mkdir: vi.fn(async () => undefined),
          write: vi.fn(async (absPath: string, content: string) => {
            written = { path: absPath, content }
            writes.push({ path: absPath, content })
          }),
          deleteExternalFile: vi.fn(async () => undefined)
        }
      }
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('is a no-op for openclaw (handled by OpenClawService)', async () => {
    mockGet({})
    await writeCliConfigDraft({ cliTool: CodeCli.OPENCLAW, modelId: 'p::m' })
    expect(written).toBeNull()
    expect(dataApiService.get).not.toHaveBeenCalled()
  })

  it('throws when the provider cannot be resolved', async () => {
    mockGet({ '/providers/ghost': () => undefined })
    await expect(writeCliConfigDraft({ cliTool: CodeCli.CLAUDE_CODE, modelId: 'ghost::claude-4' })).rejects.toThrow(
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

      await writeCliConfigDraft({
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

    it('injects a placeholder auth token for Ollama, which needs no real API key', async () => {
      mockGet({
        '/providers/ollama': () => ollamaProvider,
        '/providers/ollama/api-keys': () => ({ keys: [] }),
        '/models/': () => null
      })

      await writeCliConfigDraft({
        cliTool: CodeCli.CLAUDE_CODE,
        modelId: 'ollama::llama3'
      })

      expect(written).not.toBeNull()
      const parsed = JSON.parse(written!.content)
      expect(parsed.env).toEqual({
        ANTHROPIC_BASE_URL: 'http://localhost:11434',
        ANTHROPIC_AUTH_TOKEN: 'ollama',
        ANTHROPIC_MODEL: 'llama3'
      })
    })

    it('omits ANTHROPIC_MODEL for detailed Claude model config', async () => {
      existing['/resolved~/.claude/settings.json'] = JSON.stringify({
        env: {
          KEEP: '1',
          ANTHROPIC_MODEL: 'old-common'
        }
      })
      mockGet({
        '/providers/anthropic': () => anthropicProvider,
        '/providers/anthropic/api-keys': () => ({ keys: [enabledKey] }),
        '/models/': () => null
      })

      await writeCliConfigDraft({
        cliTool: CodeCli.CLAUDE_CODE,
        modelId: 'anthropic::claude-sonnet-4-5',
        configBlob: {
          env: {
            ANTHROPIC_DEFAULT_FABLE_MODEL: 'claude-sonnet-4-5',
            ANTHROPIC_DEFAULT_FABLE_MODEL_NAME: 'claude-sonnet-4-5'
          }
        },
        writePrimaryModel: false
      })

      const parsed = JSON.parse(written!.content)
      expect(parsed.env.KEEP).toBe('1')
      expect(parsed.env.ANTHROPIC_BASE_URL).toBe('https://api.anthropic.com')
      expect(parsed.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-secret')
      expect(parsed.env).not.toHaveProperty('ANTHROPIC_MODEL')
      expect(parsed.env.ANTHROPIC_DEFAULT_FABLE_MODEL).toBe('claude-sonnet-4-5')
      expect(parsed.env.ANTHROPIC_DEFAULT_FABLE_MODEL_NAME).toBe('claude-sonnet-4-5')
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

      await writeCliConfigDraft({
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

    it('drops previous config quick-options / model-roles / attribution / reasoning effort on switch', async () => {
      // Simulate a CLI config file written by a previous config that had every
      // Cherry-managed field set. The new config asserts none of them, so all
      // Cherry-managed keys must be cleared (each config is independent).
      existing['/resolved~/.claude/settings.json'] = JSON.stringify({
        theme: 'dark',
        attribution: { commit: '', pr: '' },
        effortLevel: 'xhigh',
        permissions: { defaultMode: 'bypassPermissions', allow: ['Bash(ls)'] },
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

      await writeCliConfigDraft({
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
      // stale reasoning effort dropped
      expect(parsed).not.toHaveProperty('effortLevel')
      // stale managed permission mode dropped, user-owned permission rules preserved
      expect(parsed.permissions).toEqual({ allow: ['Bash(ls)'] })
    })

    it('writes only the managed Claude permission mode under permissions', async () => {
      existing['/resolved~/.claude/settings.json'] = JSON.stringify({
        permissions: { allow: ['Bash(ls)'] }
      })
      mockGet({
        '/providers/anthropic': () => anthropicProvider,
        '/providers/anthropic/api-keys': () => ({ keys: [enabledKey] }),
        '/models/': () => null
      })

      await writeCliConfigDraft({
        cliTool: CodeCli.CLAUDE_CODE,
        modelId: 'anthropic::claude-sonnet-4-5',
        configBlob: { permissions: { defaultMode: 'acceptEdits', deny: ['Bash(rm -rf *)'] } }
      })

      const parsed = JSON.parse(written!.content)
      expect(parsed.permissions).toEqual({
        allow: ['Bash(ls)'],
        defaultMode: 'acceptEdits'
      })
    })

    it('writes the managed Claude reasoning effort', async () => {
      existing['/resolved~/.claude/settings.json'] = JSON.stringify({ theme: 'dark' })
      mockGet({
        '/providers/anthropic': () => anthropicProvider,
        '/providers/anthropic/api-keys': () => ({ keys: [enabledKey] }),
        '/models/': () => null
      })

      await writeCliConfigDraft({
        cliTool: CodeCli.CLAUDE_CODE,
        modelId: 'anthropic::claude-sonnet-4-5',
        configBlob: { effortLevel: 'high' }
      })

      const parsed = JSON.parse(written!.content)
      expect(parsed.effortLevel).toBe('high')
      expect(parsed.theme).toBe('dark')
    })
  })

  describe('codex (~/.codex/config.toml + auth.json)', () => {
    const findWrite = (suffix: string) => writes.find((w) => w.path.endsWith(suffix))

    it('writes both auth.json (OPENAI_API_KEY) and config.toml with wire_api = responses', async () => {
      mockGet({
        '/providers/deepseek': () => codexProvider,
        '/providers/deepseek/api-keys': () => ({ keys: [enabledKey] }),
        '/models/': () => null
      })

      await writeCliConfigDraft({
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
      // Codex rejects `wire_api = "chat"`; only the Responses API is supported.
      expect(parsed.model_providers['cherry-DeepSeek'].wire_api).toBe('responses')
      // key lives in auth.json now, not as a bearer token
      expect(parsed.model_providers['cherry-DeepSeek']).not.toHaveProperty('experimental_bearer_token')
      expect(parsed.model_providers['cherry-DeepSeek'].name).toBe('DeepSeek')
      // goal mode is off by default → no features block
      expect(parsed).not.toHaveProperty('features')

      const authParsed = JSON.parse(authWrite!.content)
      expect(authParsed.OPENAI_API_KEY).toBe('sk-secret')
    })

    it('rejects a chat-completions-only provider (Codex no longer supports wire_api = "chat")', async () => {
      mockGet({
        '/providers/deepseek': () => openaiCompatProvider,
        '/providers/deepseek/api-keys': () => ({ keys: [enabledKey] }),
        '/models/': () => null
      })

      await expect(
        writeCliConfigDraft({ cliTool: CodeCli.OPENAI_CODEX, modelId: 'deepseek::deepseek-chat' })
      ).rejects.toThrow(/Responses API endpoint/)
      // No file is touched when the provider cannot back Codex.
      expect(writes).toEqual([])
    })

    it('merges OPENAI_API_KEY into auth.json, preserving unrelated OAuth keys', async () => {
      existing['/resolved~/.codex/auth.json'] = JSON.stringify({
        tokens: { id_token: 'oauth-jwt', access_token: 'oauth-access' }
      })
      mockGet({
        '/providers/deepseek': () => codexProvider,
        '/providers/deepseek/api-keys': () => ({ keys: [enabledKey] }),
        '/models/': () => null
      })

      await writeCliConfigDraft({
        cliTool: CodeCli.OPENAI_CODEX,
        modelId: 'deepseek::deepseek-chat'
      })

      const authParsed = JSON.parse(findWrite('auth.json')!.content)
      expect(authParsed.tokens).toEqual({ id_token: 'oauth-jwt', access_token: 'oauth-access' })
      expect(authParsed.OPENAI_API_KEY).toBe('sk-secret')
    })

    it('applies goal mode + remote compaction + permission mode + reasoning effort from the config blob', async () => {
      mockGet({
        '/providers/deepseek': () => codexProvider,
        '/providers/deepseek/api-keys': () => ({ keys: [enabledKey] }),
        '/models/': () => null
      })

      await writeCliConfigDraft({
        cliTool: CodeCli.OPENAI_CODEX,
        modelId: 'deepseek::deepseek-chat',
        configBlob: { goalMode: true, remoteCompaction: true, permissionMode: 'workspace', reasoningEffort: 'high' }
      })

      const { parse: parseToml } = await import('smol-toml')
      const parsed = parseToml(findWrite('config.toml')!.content) as Record<string, any>
      expect(parsed.features).toEqual({ goals: true })
      expect(parsed.model_providers['cherry-DeepSeek'].name).toBe('OpenAI')
      expect(parsed.approval_policy).toBe('on-request')
      expect(parsed.sandbox_mode).toBe('workspace-write')
      expect(parsed.model_reasoning_effort).toBe('high')
      expect(parsed).not.toHaveProperty('default_permissions')
    })

    it('clears stale goal-mode / OpenAI name from a previous config when toggles are off', async () => {
      // Previous config had goal mode + remote compaction on; the new config
      // asserts neither, so both must be cleared (configs are independent).
      existing['/resolved~/.codex/config.toml'] = [
        'model = "deepseek-chat"',
        'model_provider = "cherry-DeepSeek"',
        'approval_policy = "never"',
        'sandbox_mode = "danger-full-access"',
        'default_permissions = ":danger-full-access"',
        'model_reasoning_effort = "high"',
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
        '/providers/deepseek': () => codexProvider,
        '/providers/deepseek/api-keys': () => ({ keys: [enabledKey] }),
        '/models/': () => null
      })

      await writeCliConfigDraft({
        cliTool: CodeCli.OPENAI_CODEX,
        modelId: 'deepseek::deepseek-chat'
        // no goalMode / remoteCompaction in the blob
      })

      const { parse: parseToml } = await import('smol-toml')
      const parsed = parseToml(findWrite('config.toml')!.content) as Record<string, any>
      expect(parsed).not.toHaveProperty('features')
      expect(parsed).not.toHaveProperty('approval_policy')
      expect(parsed).not.toHaveProperty('sandbox_mode')
      expect(parsed).not.toHaveProperty('default_permissions')
      expect(parsed).not.toHaveProperty('model_reasoning_effort')
      expect(parsed.model_providers['cherry-DeepSeek'].name).toBe('DeepSeek')
    })

    // Regression: Codex treats a model_providers[...].name of exactly "OpenAI" as a signal
    // that remote compaction is on, regardless of the actual toggle — so a provider whose
    // display name really is "OpenAI" must never be written verbatim unless that mode is on.
    it('avoids the "OpenAI" name collision when the provider is actually named OpenAI (remote compaction off)', async () => {
      const openaiNamedProvider = { ...codexProvider, name: 'OpenAI' } as unknown as Provider
      mockGet({
        '/providers/deepseek': () => openaiNamedProvider,
        '/providers/deepseek/api-keys': () => ({ keys: [enabledKey] }),
        '/models/': () => null
      })

      await writeCliConfigDraft({ cliTool: CodeCli.OPENAI_CODEX, modelId: 'deepseek::deepseek-chat' })

      const { parse: parseToml } = await import('smol-toml')
      const parsed = parseToml(findWrite('config.toml')!.content) as Record<string, any>
      expect(parsed.model_providers['cherry-OpenAI'].name).toBe('OpenAI (Cherry)')
    })

    it('writes the literal "OpenAI" name when remote compaction is actually on', async () => {
      const openaiNamedProvider = { ...codexProvider, name: 'OpenAI' } as unknown as Provider
      mockGet({
        '/providers/deepseek': () => openaiNamedProvider,
        '/providers/deepseek/api-keys': () => ({ keys: [enabledKey] }),
        '/models/': () => null
      })

      await writeCliConfigDraft({
        cliTool: CodeCli.OPENAI_CODEX,
        modelId: 'deepseek::deepseek-chat',
        configBlob: { remoteCompaction: true }
      })

      const { parse: parseToml } = await import('smol-toml')
      const parsed = parseToml(findWrite('config.toml')!.content) as Record<string, any>
      expect(parsed.model_providers['cherry-OpenAI'].name).toBe('OpenAI')
    })

    it('uses the responses endpoint even when a chat-completions endpoint is also present', async () => {
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

      await writeCliConfigDraft({ cliTool: CodeCli.OPENAI_CODEX, modelId: 'deepseek::deepseek-chat' })

      const { parse: parseToml } = await import('smol-toml')
      const parsed = parseToml(findWrite('config.toml')!.content) as Record<string, any>
      expect(parsed.model_providers['cherry-DeepSeek'].base_url).toBe('https://api.deepseek.com/v1')
      expect(parsed.model_providers['cherry-DeepSeek'].wire_api).toBe('responses')
    })

    it('throws when the provider has no Responses API endpoint', async () => {
      const noResponses = { ...openaiCompatProvider, endpointConfigs: {} } as unknown as Provider
      mockGet({
        '/providers/deepseek': () => noResponses,
        '/providers/deepseek/api-keys': () => ({ keys: [enabledKey] }),
        '/models/': () => null
      })
      await expect(
        writeCliConfigDraft({ cliTool: CodeCli.OPENAI_CODEX, modelId: 'deepseek::deepseek-chat' })
      ).rejects.toThrow(/Responses API endpoint/)
    })

    it('appends /v1 to a responses base_url missing the version segment', async () => {
      const noVersionProvider = {
        ...openaiCompatProvider,
        endpointConfigs: { 'openai-responses': { baseUrl: 'https://api.deepseek.com' } }
      } as unknown as Provider
      mockGet({
        '/providers/deepseek': () => noVersionProvider,
        '/providers/deepseek/api-keys': () => ({ keys: [enabledKey] }),
        '/models/': () => null
      })

      await writeCliConfigDraft({ cliTool: CodeCli.OPENAI_CODEX, modelId: 'deepseek::deepseek-chat' })

      const { parse: parseToml } = await import('smol-toml')
      const parsed = parseToml(findWrite('config.toml')!.content) as Record<string, any>
      expect(parsed.model_providers['cherry-DeepSeek'].base_url).toBe('https://api.deepseek.com/v1')
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

      await writeCliConfigDraft({
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

      await writeCliConfigDraft({
        cliTool: CodeCli.OPEN_CODE,
        modelId: 'anthropic::claude-sonnet-4-5',
        configBlob: { env: { OPENCODE_REASONING: 'true' } }
      })

      const parsed = JSON.parse(opencodeWrite().content)
      const provider = parsed.provider['cherry-Anthropic']
      expect(provider.options.baseURL).toBe('https://api.anthropic.com/v1')
      const model = provider.models['claude-sonnet-4-5']
      expect(model.reasoning).toBe(true)
      expect(model.options.thinking).toEqual({ budgetTokens: 10000, type: 'enabled' })
    })

    it('injects a placeholder auth token for Ollama, which needs no real API key', async () => {
      mockGet({
        '/providers/ollama': () => ollamaProvider,
        '/providers/ollama/api-keys': () => ({ keys: [] }),
        '/models/': () => null
      })

      await writeCliConfigDraft({
        cliTool: CodeCli.OPEN_CODE,
        modelId: 'ollama::llama3'
      })

      const parsed = JSON.parse(opencodeWrite().content)
      const provider = parsed.provider['cherry-Ollama']
      expect(provider.npm).toBe('@ai-sdk/anthropic')
      expect(provider.options.apiKey).toBe('ollama')
      expect(provider.options.baseURL).toBe('http://localhost:11434/v1')
    })

    it('uses reasoningEffort for openai-compatible models that support it', async () => {
      mockGet({
        '/providers/deepseek': () => openaiCompatProvider,
        '/providers/deepseek/api-keys': () => ({ keys: [enabledKey] }),
        '/models/': () => reasoningModel
      })

      await writeCliConfigDraft({
        cliTool: CodeCli.OPEN_CODE,
        modelId: 'deepseek::deepseek-chat',
        configBlob: { env: { OPENCODE_REASONING: 'true' } }
      })

      const parsed = JSON.parse(opencodeWrite().content)
      const model = parsed.provider['cherry-DeepSeek'].models['deepseek-chat']
      expect(model.reasoning).toBe(true)
      expect(model.options.reasoningEffort).toBe('medium')
    })

    // Regression: catalog seeds deepseek/dmxapi without `/v1`. @ai-sdk/openai-compatible
    // appends `/chat/completions` directly to baseURL, so a bare host produced
    // `https://api.deepseek.com/chat/completions` → 404.
    it('appends /v1 to an OpenAI-compatible baseURL missing the version', async () => {
      const noVersionProvider = {
        ...openaiCompatProvider,
        endpointConfigs: { 'openai-chat-completions': { baseUrl: 'https://api.deepseek.com' } }
      } as unknown as Provider
      mockGet({
        '/providers/deepseek': () => noVersionProvider,
        '/providers/deepseek/api-keys': () => ({ keys: [enabledKey] }),
        '/models/': () => null
      })

      await writeCliConfigDraft({ cliTool: CodeCli.OPEN_CODE, modelId: 'deepseek::deepseek-chat' })

      const parsed = JSON.parse(opencodeWrite().content)
      expect(parsed.provider['cherry-DeepSeek'].options.baseURL).toBe('https://api.deepseek.com/v1')
    })

    it('uses the model endpoint type and matching baseURL for mixed providers', async () => {
      const mixedProvider = {
        id: 'mixed',
        name: 'Mixed',
        endpointConfigs: {
          'anthropic-messages': { baseUrl: 'https://anthropic.example.com' },
          'openai-chat-completions': { baseUrl: 'https://chat.example.com/v1' }
        },
        defaultChatEndpoint: 'anthropic-messages'
      } as unknown as Provider

      mockGet({
        '/providers/mixed': () => mixedProvider,
        '/providers/mixed/api-keys': () => ({ keys: [enabledKey] }),
        '/models/': () => ({ id: 'gpt-compatible', endpointTypes: ['openai-chat-completions'] })
      })

      await writeCliConfigDraft({ cliTool: CodeCli.OPEN_CODE, modelId: 'mixed::gpt-compatible' })

      const provider = JSON.parse(opencodeWrite().content).provider['cherry-Mixed']
      expect(provider.npm).toBe('@ai-sdk/openai-compatible')
      expect(provider.options.baseURL).toBe('https://chat.example.com/v1')
    })

    it('writes the global OpenCode permission mode', async () => {
      mockGet({
        '/providers/deepseek': () => openaiCompatProvider,
        '/providers/deepseek/api-keys': () => ({ keys: [enabledKey] }),
        '/models/': () => null
      })

      await writeCliConfigDraft({
        cliTool: CodeCli.OPEN_CODE,
        modelId: 'deepseek::deepseek-chat',
        configBlob: { permissionMode: 'ask' }
      })

      const parsed = JSON.parse(opencodeWrite().content)
      expect(parsed.permission).toBe('ask')
    })
  })

  describe('gemini-cli (~/.gemini/.env + settings.json)', () => {
    const findWrite = (suffix: string) => writes.find((w) => w.path.endsWith(suffix))!

    it('applies supported settings from the config blob and drops removed settings', async () => {
      mockGet({
        '/providers/gemini': () => geminiProvider,
        '/providers/gemini/api-keys': () => ({ keys: [enabledKey] }),
        '/models/': () => null
      })

      await writeCliConfigDraft({
        cliTool: CodeCli.GEMINI_CLI,
        modelId: 'gemini::gemini-2.5-pro',
        configBlob: {
          general: { vimMode: true, defaultApprovalMode: 'auto_edit' },
          ui: { hideBanner: true },
          privacy: { usageStatisticsEnabled: false },
          model: { maxSessionTurns: 10 },
          context: { fileName: ['GEMINI.md', 'AGENTS.md'], includeDirectories: ['../shared'] },
          tools: { exclude: ['write_file'] },
          advanced: { excludedEnvVars: ['DEBUG'] }
        }
      })

      expect(findWrite('.env').content).toContain('GEMINI_API_KEY=sk-secret')
      const settings = JSON.parse(findWrite('settings.json').content)
      expect(settings.general).toEqual({ vimMode: true, defaultApprovalMode: 'auto_edit' })
      expect(settings.ui.hideBanner).toBe(true)
      expect(settings.privacy.usageStatisticsEnabled).toBe(false)
      expect(settings.model).toEqual({ name: 'gemini-2.5-pro' })
      expect(settings.security).toEqual({ auth: { selectedType: 'gemini-api-key' } })
      expect(settings.context).toBeUndefined()
      expect(settings.tools).toBeUndefined()
      expect(settings.advanced).toBeUndefined()
    })

    it('resolves a CherryIN-style aggregator base URL from its default chat endpoint', async () => {
      mockGet({
        '/providers/cherryin': () => cherryinProvider,
        '/providers/cherryin/api-keys': () => ({ keys: [enabledKey] }),
        '/models/': () => null
      })

      await writeCliConfigDraft({
        cliTool: CodeCli.GEMINI_CLI,
        modelId: 'cherryin::agent/deepseek-v4-flash'
      })

      expect(findWrite('.env').content).toContain('GOOGLE_GEMINI_BASE_URL=https://open.cherryin.net')
      const settings = JSON.parse(findWrite('settings.json').content)
      expect(settings.model).toEqual({ name: 'agent/deepseek-v4-flash' })
    })

    it('preserves a field Cherry has no UI for instead of silently deleting it', async () => {
      // `general.preferredEditor` is MANAGED (clear.ts wipes it) but not WRITABLE
      // (no UI control writes it), so a save must leave it untouched.
      existing['/resolved~/.gemini/settings.json'] = JSON.stringify({ general: { preferredEditor: 'vim' } })
      mockGet({
        '/providers/gemini': () => geminiProvider,
        '/providers/gemini/api-keys': () => ({ keys: [enabledKey] }),
        '/models/': () => null
      })

      await writeCliConfigDraft({
        cliTool: CodeCli.GEMINI_CLI,
        modelId: 'gemini::gemini-2.5-pro',
        configBlob: { general: { vimMode: true } }
      })

      const settings = JSON.parse(findWrite('settings.json').content)
      expect(settings.general).toEqual({ vimMode: true, preferredEditor: 'vim' })
    })
  })

  describe('qwen-code (~/.qwen/settings.json)', () => {
    it('applies supported settings from the config blob and drops removed settings', async () => {
      mockGet({
        '/providers/deepseek': () => openaiCompatProvider,
        '/providers/deepseek/api-keys': () => ({ keys: [enabledKey] }),
        '/models/': () => ({ id: 'deepseek-chat', name: 'DeepSeek Chat' })
      })

      await writeCliConfigDraft({
        cliTool: CodeCli.QWEN_CODE,
        modelId: 'deepseek::deepseek-chat',
        configBlob: {
          general: { vimMode: true, enableAutoUpdate: false, outputLanguage: 'zh-CN', cleanupPeriodDays: 7 },
          ui: { hideBanner: true },
          privacy: { usageStatisticsEnabled: false },
          tools: { approvalMode: 'auto' },
          context: { fileName: ['QWEN.md', 'AGENTS.md'] },
          permissions: {
            autoMode: {
              classifyAllShell: true,
              hints: { allow: ['Run local tests'], softDeny: ['Touch production DB'] }
            }
          }
        }
      })

      const parsed = JSON.parse(written!.content)
      const mkdirMock = vi.mocked(window.api.file.mkdir)
      const writeMock = vi.mocked(window.api.file.write)
      expect(mkdirMock).toHaveBeenCalledWith('/resolved~/.qwen')
      expect(mkdirMock.mock.invocationCallOrder[0]).toBeLessThan(writeMock.mock.invocationCallOrder[0])
      expect(parsed.general).toMatchObject({
        vimMode: true,
        enableAutoUpdate: false
      })
      expect(parsed.ui.hideBanner).toBe(true)
      expect(parsed.privacy.usageStatisticsEnabled).toBe(false)
      expect(parsed.tools).toEqual({ approvalMode: 'auto' })
      expect(parsed.context).toBeUndefined()
      expect(parsed.permissions.autoMode).toEqual({
        classifyAllShell: true
      })
      expect(parsed.modelProviders.openai[0]).toMatchObject({
        id: 'deepseek-chat',
        name: 'DeepSeek Chat',
        baseUrl: 'https://api.deepseek.com/v1',
        envKey: 'CHERRY_QWEN_API_KEY'
      })
    })

    it('preserves a field Cherry has no UI for instead of silently deleting it', async () => {
      // `context.fileName` is MANAGED (clear.ts wipes it) but not WRITABLE
      // (no UI control writes it), so a save must leave it untouched.
      existing['/resolved~/.qwen/settings.json'] = JSON.stringify({ context: { fileName: ['QWEN.md'] } })
      mockGet({
        '/providers/deepseek': () => openaiCompatProvider,
        '/providers/deepseek/api-keys': () => ({ keys: [enabledKey] }),
        '/models/': () => ({ id: 'deepseek-chat', name: 'DeepSeek Chat' })
      })

      await writeCliConfigDraft({
        cliTool: CodeCli.QWEN_CODE,
        modelId: 'deepseek::deepseek-chat',
        configBlob: { general: { vimMode: true } }
      })

      const parsed = JSON.parse(written!.content)
      expect(parsed.context).toEqual({ fileName: ['QWEN.md'] })
    })
  })

  describe('kimi-code (~/.kimi-code/config.toml)', () => {
    it('applies supported settings from the config blob and drops removed settings', async () => {
      mockGet({
        '/providers/deepseek': () => openaiCompatProvider,
        '/providers/deepseek/api-keys': () => ({ keys: [enabledKey] }),
        '/models/': () => ({ id: 'deepseek-chat', contextWindow: 65536 })
      })

      await writeCliConfigDraft({
        cliTool: CodeCli.KIMI_CODE,
        modelId: 'deepseek::deepseek-chat',
        configBlob: {
          default_permission_mode: 'auto',
          default_plan_mode: true,
          telemetry: false,
          thinking: { enabled: true, effort: 'high' },
          loop_control: { max_steps_per_turn: 12, max_retries_per_step: 2, reserved_context_size: 50000 },
          background: { max_running_tasks: 4, keep_alive_on_exit: true },
          experimental: { micro_compaction: true }
        }
      })

      const { parse: parseToml } = await import('smol-toml')
      const parsed = parseToml(written!.content) as Record<string, any>
      const mkdirMock = vi.mocked(window.api.file.mkdir)
      const writeMock = vi.mocked(window.api.file.write)
      expect(mkdirMock).toHaveBeenCalledWith('/resolved~/.kimi-code')
      expect(mkdirMock.mock.invocationCallOrder[0]).toBeLessThan(writeMock.mock.invocationCallOrder[0])
      expect(parsed.default_model).toBe('cherry-DeepSeek')
      expect(parsed.default_permission_mode).toBe('auto')
      expect(parsed.default_plan_mode).toBe(true)
      expect(parsed.telemetry).toBe(false)
      expect(parsed.thinking).toEqual({ enabled: true })
      expect(parsed.loop_control).toBeUndefined()
      expect(parsed.background).toEqual({ keep_alive_on_exit: true })
      expect(parsed.experimental).toEqual({ micro_compaction: true })
      expect(parsed.models['cherry-DeepSeek'].max_context_size).toBe(65536)
    })

    it('preserves a field Cherry has no UI for instead of silently deleting it', async () => {
      // `loop_control.*` is MANAGED (clear.ts wipes it) but not WRITABLE
      // (no UI control writes it), so a save must leave it untouched.
      existing['/resolved~/.kimi-code/config.toml'] = 'loop_control = { max_steps_per_turn = 12 }'
      mockGet({
        '/providers/deepseek': () => openaiCompatProvider,
        '/providers/deepseek/api-keys': () => ({ keys: [enabledKey] }),
        '/models/': () => ({ id: 'deepseek-chat', contextWindow: 65536 })
      })

      await writeCliConfigDraft({
        cliTool: CodeCli.KIMI_CODE,
        modelId: 'deepseek::deepseek-chat',
        configBlob: { thinking: { enabled: true } }
      })

      const { parse: parseToml } = await import('smol-toml')
      const parsed = parseToml(written!.content) as Record<string, any>
      expect(parsed.loop_control).toEqual({ max_steps_per_turn: 12 })
    })

    it('does not write when parent directory creation fails', async () => {
      mockGet({
        '/providers/deepseek': () => openaiCompatProvider,
        '/providers/deepseek/api-keys': () => ({ keys: [enabledKey] }),
        '/models/': () => ({ id: 'deepseek-chat', contextWindow: 65536 })
      })
      vi.mocked(window.api.file.mkdir).mockRejectedValueOnce(new Error('mkdir failed'))

      await expect(
        writeCliConfigDraft({
          cliTool: CodeCli.KIMI_CODE,
          modelId: 'deepseek::deepseek-chat'
        })
      ).rejects.toThrow('mkdir failed')
      expect(window.api.file.write).not.toHaveBeenCalled()
    })
  })

  describe('clear on disable deletes Cherry-managed keys', () => {
    it('removes managed env keys and top-level keys from claude settings', async () => {
      existing['/resolved~/.claude/settings.json'] = JSON.stringify({
        theme: 'dark',
        env: { ANTHROPIC_AUTH_TOKEN: 'sk-injected', KEEP: '1' }
      })
      await clearCliConfig({ cliTool: CodeCli.CLAUDE_CODE })

      const afterClear = JSON.parse(writes.at(-1)!.content)
      expect(afterClear.theme).toBe('dark')
      expect(afterClear.env.KEEP).toBe('1')
      expect(afterClear.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
    })
  })

  describe('parse-failure safety (never overwrite a malformed CLI config file)', () => {
    it('aborts the codex write instead of clobbering a malformed config.toml', async () => {
      existing['/resolved~/.codex/config.toml'] = 'this is = = not valid toml [[['
      mockGet({
        '/providers/openai': () => codexProvider,
        '/providers/openai/api-keys': () => ({ keys: [enabledKey] }),
        '/models/': () => null
      })

      await expect(writeCliConfigDraft({ cliTool: CodeCli.OPENAI_CODEX, modelId: 'openai::gpt-4o' })).rejects.toThrow(
        /Failed to parse/
      )
      // Crucially, nothing was written — the malformed file is left intact.
      expect(writes).toEqual([])
    })

    it('aborts the opencode write instead of clobbering a malformed opencode.json', async () => {
      existing['/resolved~/.config/opencode/opencode.json'] = '{ not json ]]]'
      mockGet({
        '/providers/deepseek': () => openaiCompatProvider,
        '/providers/deepseek/api-keys': () => ({ keys: [enabledKey] }),
        '/models/': () => null
      })

      await expect(
        writeCliConfigDraft({ cliTool: CodeCli.OPEN_CODE, modelId: 'deepseek::deepseek-chat' })
      ).rejects.toThrow(/Failed to parse/)
      expect(writes).toEqual([])
    })
  })

  describe('assertCliConfigCredentials via writeCliConfigDraft (never write an unauthenticated config)', () => {
    it('rejects claude-code with no API key and writes nothing', async () => {
      mockGet({
        '/providers/anthropic': () => anthropicProvider,
        '/providers/anthropic/api-keys': () => ({ keys: [] }),
        '/models/': () => null
      })
      await expect(
        writeCliConfigDraft({ cliTool: CodeCli.CLAUDE_CODE, modelId: 'anthropic::claude-sonnet-4-5' })
      ).rejects.toThrow(/missing the API key/)
      expect(writes).toEqual([])
    })

    it('rejects explicit managed files with no API key and writes nothing', async () => {
      mockGet({
        '/providers/anthropic': () => anthropicProvider,
        '/providers/anthropic/api-keys': () => ({ keys: [] }),
        '/models/': () => null
      })

      await expect(
        writeCliConfigDraft({
          cliTool: CodeCli.CLAUDE_CODE,
          modelId: 'anthropic::claude-sonnet-4-5',
          files: [
            {
              target: 'claude-settings',
              label: 'Claude settings',
              path: '/resolved~/.claude/settings.json',
              language: 'json',
              content: '{}'
            }
          ]
        })
      ).rejects.toThrow(/missing the API key/)
      expect(writes).toEqual([])
    })

    it('rejects codex with no API key and writes nothing', async () => {
      mockGet({
        '/providers/deepseek': () => codexProvider,
        '/providers/deepseek/api-keys': () => ({ keys: [] }),
        '/models/': () => null
      })
      await expect(
        writeCliConfigDraft({ cliTool: CodeCli.OPENAI_CODEX, modelId: 'deepseek::deepseek-chat' })
      ).rejects.toThrow(/missing the API key/)
      expect(writes).toEqual([])
    })

    it('rejects opencode with no API key and writes nothing', async () => {
      mockGet({
        '/providers/deepseek': () => openaiCompatProvider,
        '/providers/deepseek/api-keys': () => ({ keys: [] }),
        '/models/': () => ({ id: 'deepseek-chat', contextWindow: 65536 })
      })
      await expect(
        writeCliConfigDraft({ cliTool: CodeCli.OPEN_CODE, modelId: 'deepseek::deepseek-chat' })
      ).rejects.toThrow(/missing required fields/)
      expect(writes).toEqual([])
    })

    it('rejects gemini-cli with no API key and writes nothing', async () => {
      mockGet({
        '/providers/gemini': () => geminiProvider,
        '/providers/gemini/api-keys': () => ({ keys: [] }),
        '/models/': () => null
      })
      await expect(
        writeCliConfigDraft({ cliTool: CodeCli.GEMINI_CLI, modelId: 'gemini::gemini-2.5-pro' })
      ).rejects.toThrow(/missing the API key/)
      expect(writes).toEqual([])
    })

    it('rejects qwen-code with no API key and writes nothing', async () => {
      mockGet({
        '/providers/deepseek': () => openaiCompatProvider,
        '/providers/deepseek/api-keys': () => ({ keys: [] }),
        '/models/': () => ({ id: 'deepseek-chat', name: 'DeepSeek Chat' })
      })
      await expect(
        writeCliConfigDraft({ cliTool: CodeCli.QWEN_CODE, modelId: 'deepseek::deepseek-chat' })
      ).rejects.toThrow(/missing the API key/)
      expect(writes).toEqual([])
    })

    it('rejects kimi-code with no API key and writes nothing', async () => {
      mockGet({
        '/providers/deepseek': () => openaiCompatProvider,
        '/providers/deepseek/api-keys': () => ({ keys: [] }),
        '/models/': () => ({ id: 'deepseek-chat', contextWindow: 65536 })
      })
      await expect(
        writeCliConfigDraft({ cliTool: CodeCli.KIMI_CODE, modelId: 'deepseek::deepseek-chat' })
      ).rejects.toThrow(/missing the API key/)
      expect(writes).toEqual([])
    })

    it('rejects opencode with an API key but no resolvable endpoint base URL, and writes nothing', async () => {
      const noEndpointProvider = { id: 'noendpoint', name: 'NoEndpoint', endpointConfigs: {} } as unknown as Provider
      mockGet({
        '/providers/noendpoint': () => noEndpointProvider,
        '/providers/noendpoint/api-keys': () => ({ keys: [enabledKey] }),
        '/models/': () => ({ id: 'some-model', contextWindow: 65536 })
      })
      await expect(
        writeCliConfigDraft({ cliTool: CodeCli.OPEN_CODE, modelId: 'noendpoint::some-model' })
      ).rejects.toThrow(/missing required fields/)
      expect(writes).toEqual([])
    })

    it('rejects qwen-code with an API key but no OpenAI-compatible endpoint base URL, and writes nothing', async () => {
      mockGet({
        '/providers/anthropic': () => anthropicProvider,
        '/providers/anthropic/api-keys': () => ({ keys: [enabledKey] }),
        '/models/': () => ({ id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5' })
      })
      await expect(
        writeCliConfigDraft({ cliTool: CodeCli.QWEN_CODE, modelId: 'anthropic::claude-sonnet-4-5' })
      ).rejects.toThrow(/missing the OpenAI endpoint base URL/)
      expect(writes).toEqual([])
    })

    it('rejects kimi-code with an API key but no OpenAI-compatible endpoint base URL, and writes nothing', async () => {
      mockGet({
        '/providers/anthropic': () => anthropicProvider,
        '/providers/anthropic/api-keys': () => ({ keys: [enabledKey] }),
        '/models/': () => ({ id: 'claude-sonnet-4-5', contextWindow: 200000 })
      })
      await expect(
        writeCliConfigDraft({ cliTool: CodeCli.KIMI_CODE, modelId: 'anthropic::claude-sonnet-4-5' })
      ).rejects.toThrow(/missing the OpenAI endpoint base URL/)
      expect(writes).toEqual([])
    })
  })

  describe('read-error safety (a real read failure must not be treated as "file missing")', () => {
    it('aborts instead of treating a permission-denied read as an empty/new file', async () => {
      // The file exists, but reading it fails transiently (e.g. EACCES/EBUSY).
      // Before the fix this was swallowed and treated as "file doesn't exist
      // yet", which would silently wipe every unmanaged key from the real file.
      existing['/resolved~/.claude/settings.json'] = JSON.stringify({ hooks: { foo: 'bar' } })
      vi.mocked(window.api.file.readExternal).mockImplementationOnce(async () => {
        throw new Error('EACCES: permission denied')
      })
      mockGet({
        '/providers/anthropic': () => anthropicProvider,
        '/providers/anthropic/api-keys': () => ({ keys: [enabledKey] }),
        '/models/': () => null
      })

      await expect(
        writeCliConfigDraft({ cliTool: CodeCli.CLAUDE_CODE, modelId: 'anthropic::claude-sonnet-4-5' })
      ).rejects.toThrow(/EACCES/)
      // Nothing was written — the real file (and its unmanaged keys) is untouched.
      expect(writes).toEqual([])
    })

    it('does not delete a real config file during rollback when its snapshot read fails', async () => {
      // Drive the write with explicit `files` so the snapshot/rollback path is
      // exercised directly, independent of the build-time read (covered above).
      // codex writes config.toml then auth.json; a real read error while
      // snapshotting config.toml must abort before either file is touched, not
      // be recorded as "didn't exist" and later trash-deleted during rollback.
      const files = [
        {
          target: 'codex-config' as const,
          label: 'Codex config',
          path: '/resolved~/.codex/config.toml',
          language: 'toml' as const,
          content: 'model = "new-model"'
        },
        {
          target: 'codex-auth' as const,
          label: 'Codex auth',
          path: '/resolved~/.codex/auth.json',
          language: 'json' as const,
          content: '{"OPENAI_API_KEY":"sk-secret"}'
        }
      ]
      vi.mocked(window.api.file.readExternal).mockImplementationOnce(async () => {
        throw new Error('EBUSY: resource busy or locked')
      })

      await expect(writeCliConfigDraft({ cliTool: CodeCli.OPENAI_CODEX, files })).rejects.toThrow(/EBUSY/)
      expect(writes).toEqual([])
      expect(window.api.file.deleteExternalFile).not.toHaveBeenCalled()
    })
  })
})
