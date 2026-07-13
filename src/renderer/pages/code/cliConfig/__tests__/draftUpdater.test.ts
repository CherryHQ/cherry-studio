import { dataApiService } from '@data/DataApiService'
import type { ApiKeyEntry, Provider } from '@shared/data/types/provider'
import { CodeCli } from '@shared/types/codeCli'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CliConfigFileDraft, CliConfigTarget } from '../index'
import {
  extractConfigFromCliConfigDraft,
  extractConnectionFromCliConfigDraft,
  formatCliConfigDraftFile,
  readCliConfigDraft,
  updateCliConfigDraftConfig
} from '../index'

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
const anthropicProvider = {
  id: 'anthropic',
  name: 'Anthropic',
  endpointConfigs: { 'anthropic-messages': { baseUrl: 'https://api.anthropic.com' } }
} as unknown as Provider
const chatProvider = {
  id: 'deepseek',
  name: 'DeepSeek',
  endpointConfigs: { 'openai-chat-completions': { baseUrl: 'https://api.deepseek.com/v1' } }
} as unknown as Provider
const geminiProvider = {
  id: 'gemini',
  name: 'Gemini',
  endpointConfigs: { 'google-generate-content': { baseUrl: 'https://generativelanguage.googleapis.com' } }
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
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      resolvePath: vi.fn(async (p: string) => `/resolved${p}`),
      file: { readExternal: vi.fn(async () => ''), write: vi.fn(async () => {}) }
    }
  })
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
      target: 'claude-settings' as CliConfigTarget,
      label: '',
      path: '',
      language: 'json',
      content: '{"b":2,"a":1}'
    }
    expect(formatCliConfigDraftFile(file).content).toBe('{\n  "b": 2,\n  "a": 1\n}\n')
  })

  it('leaves non-JSON (toml/dotenv) drafts untouched', () => {
    const file: CliConfigFileDraft = {
      target: 'kimi-config' as CliConfigTarget,
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
  })

  it('returns the files unchanged when there is no managed connection', () => {
    const files: CliConfigFileDraft[] = [
      { target: 'codex-config' as CliConfigTarget, label: '', path: '', language: 'toml', content: '' }
    ]
    expect(updateCliConfigDraftConfig('unknown-tool', files, { goalMode: true })).toBe(files)
  })

  // Parity across every file-based CLI (the previous cases only covered Codex): a config-only
  // update must (1) leave the connection untouched and (2) land the same managed config the write
  // path would have produced for that blob. Comparing against a freshly built draft avoids
  // hard-coding each tool's managed shape while still catching a mis-extracted adapter branch.
  const parityCases: Array<[string, CodeCli, Provider, string, Record<string, unknown>]> = [
    [
      'claude',
      CodeCli.CLAUDE_CODE,
      anthropicProvider,
      'claude-sonnet-4-5',
      { effortLevel: 'high', permissions: { defaultMode: 'plan' } }
    ],
    ['codex', CodeCli.OPENAI_CODEX, responsesProvider, 'gpt-5', { goalMode: true, permissionMode: 'workspace' }],
    ['opencode', CodeCli.OPEN_CODE, chatProvider, 'deepseek-chat', { autoCompact: true, permissionMode: 'ask' }],
    ['gemini', CodeCli.GEMINI_CLI, geminiProvider, 'gemini-2.5-pro', { general: { defaultApprovalMode: 'plan' } }],
    ['qwen', CodeCli.QWEN_CODE, chatProvider, 'qwen3-max', { tools: { approvalMode: 'plan' } }],
    ['kimi', CodeCli.KIMI_CODE, chatProvider, 'kimi-k2', { default_permission_mode: 'auto' }]
  ]

  it.each(parityCases)(
    'preserves the connection and applies config for %s',
    async (_n, tool, provider, model, blob) => {
      const files = await buildDraft(tool, provider, model)
      const before = extractConnectionFromCliConfigDraft(tool, files)

      const updated = updateCliConfigDraftConfig(tool, files, blob)

      expect(extractConnectionFromCliConfigDraft(tool, updated)).toEqual(before)
      const freshlyBuilt = await buildDraft(tool, provider, model, blob)
      expect(extractConfigFromCliConfigDraft(tool, updated)).toEqual(
        extractConfigFromCliConfigDraft(tool, freshlyBuilt)
      )
    }
  )

  // A config-only edit rebuilds opencode.json without a model record, so the display name
  // written for the model key (gateway mode writes a human-readable one) must be carried
  // over from the existing draft, not degraded back to the addressing id.
  it('opencode: keeps the model display name across a config-only update', () => {
    const files: CliConfigFileDraft[] = [
      {
        target: 'opencode-config' as CliConfigTarget,
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
    expect(parsed.autoCompact).toBe(true)
    expect(parsed.provider['cherry-gateway'].models['deepseek:deepseek-chat'].name).toBe('DeepSeek Chat')
    expect(parsed.model).toBe('cherry-gateway/deepseek:deepseek-chat')
  })
})
