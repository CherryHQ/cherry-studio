import { dataApiService } from '@data/DataApiService'
import type { ApiKeyEntry, Provider } from '@shared/data/types/provider'
import { CodeCli } from '@shared/types/codeCli'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CliConfigFileDraft, CliConfigTarget } from '../index'
import { extractConfigFromCliConfigDraft, extractConnectionFromCliConfigDraft, readCliConfigDraft } from '../index'

/** Per-path DataApi.get mock (longest-prefix wins so `/api-keys` is not shadowed). */
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

const anthropicProvider = {
  id: 'anthropic',
  name: 'Anthropic',
  endpointConfigs: { 'anthropic-messages': { baseUrl: 'https://api.anthropic.com' } }
} as unknown as Provider
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
const geminiProvider = {
  id: 'gemini',
  name: 'Gemini',
  endpointConfigs: { 'google-generate-content': { baseUrl: 'https://generativelanguage.googleapis.com' } }
} as unknown as Provider

beforeEach(() => {
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      resolvePath: vi.fn(async (p: string) => `/resolved${p}`),
      file: { readExternal: vi.fn(async () => ''), write: vi.fn(async () => {}) }
    }
  })
})

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

describe('extractConnectionFromCliConfigDraft', () => {
  // Round-trip: what readCliConfigDraft writes, the parser must read back. This
  // pins the write path and the read-back path to the same on-disk shape.
  const cases: Array<[string, CodeCli, Provider, string, string]> = [
    ['claude', CodeCli.CLAUDE_CODE, anthropicProvider, 'claude-sonnet-4-5', 'https://api.anthropic.com'],
    ['codex', CodeCli.OPENAI_CODEX, responsesProvider, 'gpt-5', 'https://api.deepseek.com/v1'],
    ['opencode', CodeCli.OPEN_CODE, chatProvider, 'deepseek-chat', 'https://api.deepseek.com/v1'],
    ['gemini', CodeCli.GEMINI_CLI, geminiProvider, 'gemini-2.5-pro', 'https://generativelanguage.googleapis.com'],
    ['qwen', CodeCli.QWEN_CODE, chatProvider, 'qwen3-max', 'https://api.deepseek.com/v1'],
    ['kimi', CodeCli.KIMI_CODE, chatProvider, 'kimi-k2', 'https://api.deepseek.com/v1']
  ]

  it.each(cases)('round-trips baseUrl/apiKey/model for %s', async (_name, cliTool, provider, model, baseUrl) => {
    const files = await buildDraft(cliTool, provider, model)
    expect(extractConnectionFromCliConfigDraft(cliTool, files)).toEqual({ baseUrl, apiKey: 'sk-secret', model })
  })

  it('returns null for an unknown tool', () => {
    expect(extractConnectionFromCliConfigDraft('nope', [])).toBeNull()
  })

  it('returns null when a draft file is malformed', () => {
    const badClaude: CliConfigFileDraft = {
      target: 'claude-settings' as CliConfigTarget,
      label: '',
      path: '',
      language: 'json',
      content: '{ this is not json'
    }
    expect(extractConnectionFromCliConfigDraft(CodeCli.CLAUDE_CODE, [badClaude])).toBeNull()
  })
})

describe('extractConfigFromCliConfigDraft', () => {
  it('round-trips only supported codex managed settings from the config blob', async () => {
    const blob = {
      goalMode: true,
      disableResponseStorage: true,
      permissionMode: 'fullAccess',
      reasoningEffort: 'high'
    }
    const files = await buildDraft(CodeCli.OPENAI_CODEX, responsesProvider, 'gpt-5', blob)
    expect(extractConfigFromCliConfigDraft(CodeCli.OPENAI_CODEX, files)).toEqual({
      goalMode: true,
      disableResponseStorage: true,
      permissionMode: 'fullAccess',
      reasoningEffort: 'high'
    })
  })

  it('round-trips supported Claude managed settings from the config blob', async () => {
    const blob = {
      effortLevel: 'xhigh',
      permissions: { defaultMode: 'auto', allow: ['Bash(ls)'] }
    }
    const files = await buildDraft(CodeCli.CLAUDE_CODE, anthropicProvider, 'claude-sonnet-4-5', blob)
    expect(extractConfigFromCliConfigDraft(CodeCli.CLAUDE_CODE, files)).toEqual({
      effortLevel: 'xhigh',
      permissions: { defaultMode: 'auto' }
    })
  })

  it('round-trips gemini managed settings from the config blob', async () => {
    const blob = { general: { vimMode: true, defaultApprovalMode: 'plan' }, ui: { hideBanner: true } }
    const files = await buildDraft(CodeCli.GEMINI_CLI, geminiProvider, 'gemini-2.5-pro', blob)
    expect(extractConfigFromCliConfigDraft(CodeCli.GEMINI_CLI, files)).toEqual(blob)
  })

  it('returns null when a draft file is malformed', () => {
    const badKimi: CliConfigFileDraft = {
      target: 'kimi-config' as CliConfigTarget,
      label: '',
      path: '',
      language: 'toml',
      content: '= = ='
    }
    expect(extractConfigFromCliConfigDraft(CodeCli.KIMI_CODE, [badKimi])).toBeNull()
  })
})
