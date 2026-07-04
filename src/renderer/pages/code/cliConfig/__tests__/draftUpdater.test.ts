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
      modelReasoningEffort: 'high',
      disableResponseStorage: true,
      permissionMode: 'workspace'
    })

    expect(extractConfigFromCliConfigDraft(CodeCli.OPENAI_CODEX, updated)).toEqual({
      goalMode: true,
      disableResponseStorage: true,
      permissionMode: 'workspace'
    })
    // baseUrl / apiKey / model are untouched by a config-only edit.
    expect(extractConnectionFromCliConfigDraft(CodeCli.OPENAI_CODEX, updated)).toEqual(before)
  })

  it('clears a managed flag when it is dropped from the blob', async () => {
    const files = await buildCodexDraft({ goalMode: true })
    expect(extractConfigFromCliConfigDraft(CodeCli.OPENAI_CODEX, files)).toEqual({ goalMode: true })

    const updated = updateCliConfigDraftConfig(CodeCli.OPENAI_CODEX, files, {})
    expect(extractConfigFromCliConfigDraft(CodeCli.OPENAI_CODEX, updated)).toEqual({})
  })

  it('returns the files unchanged when there is no managed connection', () => {
    const files: CliConfigFileDraft[] = [
      { target: 'codex-config' as CliConfigTarget, label: '', path: '', language: 'toml', content: '' }
    ]
    expect(updateCliConfigDraftConfig('unknown-tool', files, { goalMode: true })).toBe(files)
  })
})
