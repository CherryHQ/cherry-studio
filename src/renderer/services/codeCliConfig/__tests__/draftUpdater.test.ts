import { parse, stringify } from 'smol-toml'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { dataApiService } from '@data/DataApiService'
import type { ApiKeyEntry, Provider } from '@shared/data/types/provider'
import { CodeCli } from '@shared/types/codeCli'
import { CLI_CONFIG_FILE_SPECS } from '@shared/utils/cliConfig'
import type { CliConfigFileDraft, CliConfigTarget } from '@shared/utils/cliConfig'

import {
  extractConfigFromCliConfigDraft,
  extractConnectionFromCliConfigDraft,
  formatCliConfigDraftFile,
  readCliConfigDraft,
  updateCliConfigDraftConfig
} from '../index'

const mocks = vi.hoisted(() => ({ request: vi.fn() }))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: mocks.request }
}))

function mockGet(handlers: Record<string, () => unknown>) {
  const prefixes = Object.keys(handlers).sort((a, b) => b.length - a.length)
  vi.mocked(dataApiService.get).mockImplementation(async (path: string) => {
    for (const prefix of prefixes) {
      if (path.startsWith(prefix)) return handlers[prefix]()
    }
    return undefined
  })
}

const enabledKey: ApiKeyEntry = { id: 'k1', key: 'sk-secret', isEnabled: true }
const responsesProvider = {
  id: 'deepseek',
  name: 'DeepSeek',
  endpointConfigs: { 'openai-responses': { baseUrl: 'https://api.deepseek.com/v1' } }
} as unknown as Provider
const chatProvider = {
  id: 'deepseek',
  name: 'DeepSeek',
  endpointConfigs: { 'openai-chat-completions': { baseUrl: 'https://api.deepseek.com/v1' } }
} as unknown as Provider

/** Build a managed draft via readCliConfigDraft (same builders the write path uses). */
async function buildDraft(
  cliTool: CodeCli,
  provider: Provider,
  model: string,
  configBlob: Record<string, unknown> = {}
): Promise<CliConfigFileDraft[]> {
  mockGet({
    [`/providers/${provider.id}/api-keys`]: () => ({ keys: [enabledKey] }),
    [`/providers/${provider.id}`]: () => provider,
    '/models/': () => null
  })
  return readCliConfigDraft({ cliTool, modelId: `${provider.id}::${model}`, configBlob })
}

beforeEach(() => {
  // On-disk configs read as empty through code_cli.read_config (old readExternal → '').
  mocks.request.mockImplementation(async (_route: string, input: { targets: CliConfigTarget[] }) => ({
    files: input.targets.map((target) => ({
      target,
      path: `/resolved${CLI_CONFIG_FILE_SPECS[target].path}`,
      content: ''
    }))
  }))
})

async function buildCodexDraft(configBlob: Record<string, unknown> = {}): Promise<CliConfigFileDraft[]> {
  mockGet({
    '/providers/deepseek/api-keys': () => ({ keys: [enabledKey] }),
    '/providers/deepseek': () => responsesProvider,
    '/models/': () => null
  })
  return readCliConfigDraft({ cliTool: CodeCli.OPENAI_CODEX, modelId: 'deepseek::gpt-5', configBlob })
}

describe('formatCliConfigDraftFile', () => {
  it('pretty-prints JSON drafts (2-space indent, trailing newline)', () => {
    const file: CliConfigFileDraft = {
      target: 'claude-settings',
      label: '',
      path: '',
      language: 'json',
      content: '{"b":2,"a":1}'
    }
    expect(formatCliConfigDraftFile(file).content).toBe('{\n  "b": 2,\n  "a": 1\n}\n')
  })

  it('retains JSONC comments and trailing commas when formatting a user-owned config', () => {
    const file: CliConfigFileDraft = {
      target: 'opencode-config',
      label: '',
      path: '',
      language: 'json',
      content: '{// Model choice\n"model":"provider/model",/* retained */}'
    }
    const formatted = formatCliConfigDraftFile(file).content
    expect(formatted).toContain('// Model choice')
    expect(formatted).toContain('/* retained */')
    expect(formatted).toContain('"model": "provider/model",')
  })

  it('leaves non-JSON (toml/dotenv) drafts untouched', () => {
    const file: CliConfigFileDraft = {
      target: 'kimi-config',
      label: '',
      path: '',
      language: 'toml',
      content: 'default_model="x"'
    }
    expect(formatCliConfigDraftFile(file)).toBe(file)
  })
})

describe('updateCliConfigDraftConfig', () => {
  it('applies a new config blob while preserving the connection', async () => {
    const files = await buildCodexDraft()
    const before = extractConnectionFromCliConfigDraft(CodeCli.OPENAI_CODEX, files)

    const updated = updateCliConfigDraftConfig(CodeCli.OPENAI_CODEX, files, {
      goalMode: true,
      reasoningEffort: 'high',
      disableResponseStorage: true,
      permissionMode: 'workspace'
    })

    expect(extractConfigFromCliConfigDraft(CodeCli.OPENAI_CODEX, updated)).toEqual({
      goalMode: true,
      disableResponseStorage: true,
      permissionMode: 'workspace',
      reasoningEffort: 'high'
    })
    // baseUrl / apiKey / model are untouched by a config-only edit.
    expect(extractConnectionFromCliConfigDraft(CodeCli.OPENAI_CODEX, updated)).toEqual(before)
  })

  it('preserves Codex token limits and connection during a config-only update', async () => {
    const files = await buildCodexDraft()
    const configFile = files.find((file) => file.target === 'codex-config')!
    const config = parse(configFile.content)
    config.model_context_window = 900000
    config.model_auto_compact_token_limit = 900000
    configFile.content = stringify(config)
    const updated = updateCliConfigDraftConfig(CodeCli.OPENAI_CODEX, files, { reasoningEffort: 'high' })
    const result = parse(updated.find((file) => file.target === 'codex-config')!.content) as Record<string, any>
    expect(result.model_context_window).toBe(900000)
    expect(result.model_auto_compact_token_limit).toBe(900000)
    expect(result.model_reasoning_effort).toBe('high')
    expect(result.model).toBe('gpt-5')
    expect(result.model_provider).toBe('cherry-DeepSeek')
    expect(result.model_providers['cherry-DeepSeek'].base_url).toBe('https://api.deepseek.com/v1')
    expect(JSON.parse(updated.find((file) => file.target === 'codex-auth')!.content).OPENAI_API_KEY).toBe('sk-secret')
  })

  it('clears a managed flag when it is dropped from the blob', async () => {
    const files = await buildCodexDraft({ goalMode: true, reasoningEffort: 'high' })
    expect(extractConfigFromCliConfigDraft(CodeCli.OPENAI_CODEX, files)).toEqual({
      goalMode: true,
      reasoningEffort: 'high'
    })

    const updated = updateCliConfigDraftConfig(CodeCli.OPENAI_CODEX, files, {})
    expect(extractConfigFromCliConfigDraft(CodeCli.OPENAI_CODEX, updated)).toEqual({})
    const preview = await readCliConfigDraft({
      cliTool: CodeCli.OPENAI_CODEX,
      modelId: 'deepseek::gpt-5',
      files,
      configBlob: {}
    })
    expect(extractConfigFromCliConfigDraft(CodeCli.OPENAI_CODEX, preview)).toEqual({})
  })

  it('keeps native Codex settings and custom permissions through model selection and an effort edit', async () => {
    const files = await buildCodexDraft()
    const config = files.find((file) => file.target === 'codex-config')!
    const native = {
      personality: 'pragmatic',
      model_verbosity: 'low',
      model_context_window: 100000,
      model_auto_compact_token_limit: 80000,
      review_model: 'review-model',
      approval_policy: 'never',
      sandbox_mode: 'read-only',
      default_permissions: ':read-only'
    }
    config.content = stringify({ ...parse(config.content), ...native })
    const selected = await readCliConfigDraft({
      cliTool: CodeCli.OPENAI_CODEX,
      modelId: 'deepseek::new-model',
      files,
      configBlob: extractConfigFromCliConfigDraft(CodeCli.OPENAI_CODEX, files) ?? {}
    })
    expect(parse(selected.find((file) => file.target === 'codex-config')!.content)).toMatchObject({
      ...native,
      model: 'new-model'
    })
    const updated = updateCliConfigDraftConfig(CodeCli.OPENAI_CODEX, selected, { reasoningEffort: 'high' })
    expect(parse(updated.find((file) => file.target === 'codex-config')!.content)).toMatchObject({
      ...native,
      model_reasoning_effort: 'high'
    })
  })

  it('keeps OpenCode permission rules and disabled compaction when selecting a model or editing another option', async () => {
    const files = await buildDraft(CodeCli.OPEN_CODE, chatProvider, 'old-model')
    const permission = { bash: { 'rm *': 'deny' }, edit: 'deny' }
    files[0].content = JSON.stringify({
      ...JSON.parse(files[0].content),
      permission,
      compaction: { auto: false, prune: false }
    })
    const selected = await readCliConfigDraft({
      cliTool: CodeCli.OPEN_CODE,
      modelId: 'deepseek::new-model',
      files,
      configBlob: extractConfigFromCliConfigDraft(CodeCli.OPEN_CODE, files) ?? {}
    })
    expect(JSON.parse(selected[0].content)).toMatchObject({
      permission,
      compaction: { auto: false, prune: false },
      model: 'cherry-DeepSeek/new-model'
    })
    const updated = updateCliConfigDraftConfig(CodeCli.OPEN_CODE, selected, { autoCompact: true })
    expect(JSON.parse(updated[0].content)).toMatchObject({ permission, compaction: { auto: true, prune: false } })
  })

  it('preserves OpenCode provider headers during a config-only update', async () => {
    const provider = {
      ...chatProvider,
      settings: {
        extraHeaders: { 'HTTP-Referer': 'https://cherry-ai.com' }
      }
    } as Provider
    const files = await buildDraft(CodeCli.OPEN_CODE, provider, 'deepseek-chat')

    const updated = updateCliConfigDraftConfig(CodeCli.OPEN_CODE, files, { autoCompact: true })

    const config = JSON.parse(updated[0].content)
    expect(config.providers['cherry-DeepSeek'].settings).toEqual({
      apiKey: 'sk-secret',
      baseURL: 'https://api.deepseek.com/v1',
      headers: { 'HTTP-Referer': 'https://cherry-ai.com' }
    })
  })

  it('preserves OpenCode model limits during a config-only update', async () => {
    const files = await buildDraft(CodeCli.OPEN_CODE, chatProvider, 'deepseek-chat')
    const config = JSON.parse(files[0].content)
    config.providers['cherry-DeepSeek'].models['deepseek-chat'].limit = { context: 65536, output: 8192 }
    files[0].content = JSON.stringify(config)

    const updated = updateCliConfigDraftConfig(CodeCli.OPEN_CODE, files, { autoCompact: true })

    expect(JSON.parse(updated[0].content).providers['cherry-DeepSeek'].models['deepseek-chat'].limit).toEqual({
      context: 65536,
      output: 8192
    })
  })

  it('detects the reasoning toggle from native V2 settings and round-trips it through a config-only update', async () => {
    // Anthropic: settings.thinking. Google: settings.thinkingConfig.
    const cases = [
      {
        provider: anthropicProvider,
        model: 'claude-sonnet-4-5',
        providerKey: 'cherry-Anthropic',
        expectedSettings: { thinking: { budgetTokens: 10000, type: 'enabled' } }
      },
      {
        provider: geminiProvider,
        model: 'gemini-2.5-pro',
        providerKey: 'cherry-Gemini',
        expectedSettings: { thinkingConfig: { includeThoughts: true, thinkingBudget: -1 } }
      }
    ]
    for (const { provider, model, providerKey, expectedSettings } of cases) {
      const files = await buildDraft(CodeCli.OPEN_CODE, provider, model, { env: { OPENCODE_REASONING: 'true' } })

      // Detection: the toggle reads back out of the native V2 settings (no boolean reasoning).
      const parsed = JSON.parse(files[0].content)
      const written = parsed.providers[providerKey].models[model]
      expect(written).not.toHaveProperty('reasoning')
      expect(written.settings).toEqual(expectedSettings)
      expect(extractConfigFromCliConfigDraft(CodeCli.OPEN_CODE, files)).toEqual({ env: { OPENCODE_REASONING: 'true' } })

      // Round-trip: a config-only edit carrying the read-back blob keeps reasoning on.
      const updated = updateCliConfigDraftConfig(CodeCli.OPEN_CODE, files, {
        env: { OPENCODE_REASONING: 'true' },
        autoCompact: true
      })
      const reparsed = JSON.parse(updated[0].content)
      expect(reparsed.providers[providerKey].models[model].settings).toEqual(expectedSettings)
      expect(reparsed.compaction.auto).toBe(true)
    }
  })

  it('reads a V1-shaped OpenCode config on a config-only update and re-renders native V2', async () => {
    const files = await buildDraft(CodeCli.OPEN_CODE, chatProvider, 'deepseek-chat')
    const v2 = JSON.parse(files[0].content)
    const cherry = v2.providers['cherry-DeepSeek']
    // Re-shape the draft the way a V1-written opencode.json looks: singular `provider` map,
    // bare AI SDK package under `npm`, request options under `options`.
    const v1: Record<string, any> = { ...v2, provider: {} }
    delete v1.providers
    v1.provider['cherry-DeepSeek'] = {
      npm: '@ai-sdk/openai-compatible',
      name: cherry.name,
      options: { apiKey: 'sk-secret', baseURL: 'https://api.deepseek.com/v1' },
      models: cherry.models
    }
    files[0].content = JSON.stringify(v1)

    // The V1 file also reads back through extractConnection (the dispatcher's first step).
    expect(extractConnectionFromCliConfigDraft(CodeCli.OPEN_CODE, files)).toEqual({
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'sk-secret',
      model: 'deepseek-chat'
    })

    const updated = updateCliConfigDraftConfig(CodeCli.OPEN_CODE, files, { autoCompact: true })

    const config = JSON.parse(updated[0].content)
    expect(config.providers['cherry-DeepSeek'].package).toBe('aisdk:@ai-sdk/openai-compatible')
    expect(config.providers['cherry-DeepSeek'].settings).toEqual({
      apiKey: 'sk-secret',
      baseURL: 'https://api.deepseek.com/v1'
    })
    expect(config.compaction.auto).toBe(true)
  })

  it('preserves OpenCode compaction settings during a config-only update', async () => {
    const files = await buildDraft(CodeCli.OPEN_CODE, chatProvider, 'deepseek-chat')
    const config = JSON.parse(files[0].content)
    config.autoCompact = true
    config.compaction = { auto: false, prune: false, reserved: 10000 }
    files[0].content = JSON.stringify(config)

    const updated = updateCliConfigDraftConfig(CodeCli.OPEN_CODE, files, { autoCompact: true })
    const parsed = JSON.parse(updated[0].content)

    expect(parsed.compaction).toEqual({ auto: true, prune: false, reserved: 10000 })
    expect(parsed).not.toHaveProperty('autoCompact')

    const disabled = updateCliConfigDraftConfig(CodeCli.OPEN_CODE, updated, { autoCompact: false })
    expect(JSON.parse(disabled[0].content).compaction).toEqual({ auto: false, prune: false, reserved: 10000 })
    expect(extractConfigFromCliConfigDraft(CodeCli.OPEN_CODE, disabled)?.autoCompact).toBe(false)
  })

  it('returns the files unchanged when there is no managed connection', () => {
    const files: CliConfigFileDraft[] = [{ target: 'codex-config', label: '', path: '', language: 'toml', content: '' }]
    expect(updateCliConfigDraftConfig('unknown-tool', files, { goalMode: true })).toBe(files)
  })

  // A config-only edit rebuilds opencode.json without a model record, so the display name
  // written for the model key (gateway mode writes a human-readable one) must be carried
  // over from the existing draft, not degraded back to the addressing id.
  it('opencode: keeps the model display name across a config-only update', () => {
    const files: CliConfigFileDraft[] = [
      {
        target: 'opencode-config',
        label: '',
        path: '',
        language: 'json',
        content: JSON.stringify({
          providers: {
            'cherry-gateway': {
              package: '@opencode/ai/providers/anthropic',
              settings: { apiKey: 'cs-sk', baseURL: 'http://127.0.0.1:23333/v1' },
              models: { 'deepseek:deepseek-chat': { name: 'DeepSeek Chat' } }
            }
          }
        })
      }
    ]

    const updated = updateCliConfigDraftConfig(CodeCli.OPEN_CODE, files, { autoCompact: true })

    const parsed = JSON.parse(updated.find((f) => f.target === 'opencode-config')!.content)
    expect(parsed.compaction.auto).toBe(true)
    expect(parsed.providers['cherry-gateway'].models['deepseek:deepseek-chat'].name).toBe('DeepSeek Chat')
    expect(parsed.model).toBe('cherry-gateway/deepseek:deepseek-chat')
  })
})

describe('OpenCode mixed-map and alias round-trip regressions', () => {
  it('keeps anthropic thinking settings across repeated config-only edits of a V1 config', async () => {
    const files = await buildDraft(CodeCli.OPEN_CODE, anthropicProvider, 'claude-sonnet-4-6')
    const v2 = JSON.parse(files[0].content)
    const cherry = v2.providers['cherry-Anthropic']
    // A V1-written reasoning config: singular `provider` map, bare AI SDK package, boolean flag.
    const v1: Record<string, any> = { ...v2, provider: {} }
    delete v1.providers
    v1.provider['cherry-Anthropic'] = {
      npm: '@ai-sdk/anthropic',
      name: cherry.name,
      options: { apiKey: 'sk-secret', baseURL: 'https://api.anthropic.com' },
      models: { 'claude-sonnet-4-6': { ...cherry.models['claude-sonnet-4-6'], reasoning: true } }
    }
    files[0].content = JSON.stringify(v1)

    const reasoning = { env: { OPENCODE_REASONING: 'true' } }
    const first = updateCliConfigDraftConfig(CodeCli.OPEN_CODE, files, reasoning)
    const firstConfig = JSON.parse(first[0].content)
    expect(firstConfig.providers['cherry-Anthropic'].package).toBe('aisdk:@ai-sdk/anthropic')
    expect(firstConfig.providers['cherry-Anthropic'].models['claude-sonnet-4-6'].settings.thinking).toBeDefined()

    // Second edit reads the normalized `aisdk:` package back; providerType must stay anthropic.
    const extracted = extractConfigFromCliConfigDraft(CodeCli.OPEN_CODE, first)
    expect(extracted).not.toBeNull()
    const second = updateCliConfigDraftConfig(CodeCli.OPEN_CODE, first, extracted!)
    const secondConfig = JSON.parse(second[0].content)
    const secondModel = secondConfig.providers['cherry-Anthropic'].models['claude-sonnet-4-6']
    expect(secondConfig.providers['cherry-Anthropic'].package).toBe('aisdk:@ai-sdk/anthropic')
    expect(secondModel.settings.thinking).toBeDefined()
    expect(secondModel.settings.reasoningEffort).toBeUndefined()
  })

  it('finds the Cherry connection when native and legacy provider maps are both present', async () => {
    const files = await buildDraft(CodeCli.OPEN_CODE, chatProvider, 'deepseek-chat')
    const v2 = JSON.parse(files[0].content)
    const cherry = v2.providers['cherry-DeepSeek']
    // Mixed shape: an unrelated native `providers` entry while the Cherry connection lives in
    // the legacy `provider` map — `providers ?? provider` would hide it.
    const mixed: Record<string, any> = { ...v2, provider: {} }
    mixed.providers = { 'user-owned': { npm: '@opencode/ai/providers/openai', name: 'mine', models: {} } }
    mixed.provider['cherry-DeepSeek'] = {
      npm: '@ai-sdk/openai-compatible',
      name: cherry.name,
      options: { apiKey: 'sk-secret', baseURL: 'https://api.deepseek.com/v1' },
      models: cherry.models
    }
    files[0].content = JSON.stringify(mixed)

    expect(extractConnectionFromCliConfigDraft(CodeCli.OPEN_CODE, files)).toEqual({
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'sk-secret',
      model: 'deepseek-chat'
    })

    const updated = updateCliConfigDraftConfig(CodeCli.OPEN_CODE, files, { autoCompact: true })
    const config = JSON.parse(updated[0].content)
    expect(config.providers['cherry-DeepSeek'].package).toBe('aisdk:@ai-sdk/openai-compatible')
    expect(config.compaction.auto).toBe(true)
  })
})
