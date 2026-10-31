import { parse as parseToml, stringify as stringifyToml } from 'smol-toml'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { dataApiService } from '@data/DataApiService'
import type { ApiKeyEntry, Provider } from '@shared/data/types/provider'
import { CodeCli } from '@shared/types/codeCli'
import { CLI_CONFIG_FILE_SPECS } from '@shared/utils/cliConfig'

import type { CliConfigFileDraft, CliConfigTarget } from '../index'
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
    config.content = stringifyToml({ ...parseToml(config.content), ...native })
    const selected = await readCliConfigDraft({
      cliTool: CodeCli.OPENAI_CODEX,
      modelId: 'deepseek::new-model',
      files,
      configBlob: extractConfigFromCliConfigDraft(CodeCli.OPENAI_CODEX, files) ?? {}
    })
    expect(parseToml(selected.find((file) => file.target === 'codex-config')!.content)).toMatchObject({
      ...native,
      model: 'new-model'
    })
    const updated = updateCliConfigDraftConfig(CodeCli.OPENAI_CODEX, selected, { reasoningEffort: 'high' })
    expect(parseToml(updated.find((file) => file.target === 'codex-config')!.content)).toMatchObject({
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
    expect(config.provider['cherry-DeepSeek'].options).toEqual({
      apiKey: 'sk-secret',
      baseURL: 'https://api.deepseek.com/v1',
      headers: { 'HTTP-Referer': 'https://cherry-ai.com' }
    })
  })

  it('preserves OpenCode model limits during a config-only update', async () => {
    const files = await buildDraft(CodeCli.OPEN_CODE, chatProvider, 'deepseek-chat')
    const config = JSON.parse(files[0].content)
    config.provider['cherry-DeepSeek'].models['deepseek-chat'].limit = { context: 65536, output: 8192 }
    files[0].content = JSON.stringify(config)

    const updated = updateCliConfigDraftConfig(CodeCli.OPEN_CODE, files, { autoCompact: true })

    expect(JSON.parse(updated[0].content).provider['cherry-DeepSeek'].models['deepseek-chat'].limit).toEqual({
      context: 65536,
      output: 8192
    })
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
          provider: {
            'cherry-gateway': {
              npm: '@ai-sdk/anthropic',
              options: { apiKey: 'cs-sk', baseURL: 'http://127.0.0.1:23333/v1' },
              models: { 'deepseek:deepseek-chat': { name: 'DeepSeek Chat' } }
            }
          }
        })
      }
    ]

    const updated = updateCliConfigDraftConfig(CodeCli.OPEN_CODE, files, { autoCompact: true })

    const parsed = JSON.parse(updated.find((f) => f.target === 'opencode-config')!.content)
    expect(parsed.compaction.auto).toBe(true)
    expect(parsed.provider['cherry-gateway'].models['deepseek:deepseek-chat'].name).toBe('DeepSeek Chat')
    expect(parsed.model).toBe('cherry-gateway/deepseek:deepseek-chat')
  })
})
