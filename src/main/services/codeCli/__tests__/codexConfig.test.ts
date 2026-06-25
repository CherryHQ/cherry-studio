import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { CodexProviderConfig } from '@shared/types/codeCli'
import { parse as parseToml } from 'smol-toml'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
  }
}))

vi.mock('@main/core/platform', () => ({ isMac: true, isWin: false }))

const getPathMock = vi.fn()
vi.mock('@application', () => ({ application: { getPath: (...args: unknown[]) => getPathMock(...args) } }))

import { buildCodexConfig, writeCodexConfig } from '../codexConfig'

const config: CodexProviderConfig = {
  apiKey: 'sk-codex',
  baseUrl: 'https://api.example.com/v1/',
  providerName: 'My.Provider',
  model: 'gpt-x'
}

describe('buildCodexConfig', () => {
  it('builds the Cherry provider block with inlined bearer token and dots→dashes key', () => {
    expect(buildCodexConfig({}, config)).toEqual({
      model: 'gpt-x',
      model_provider: 'Cherry-My-Provider',
      model_reasoning_effort: 'high',
      disable_response_storage: true,
      model_providers: {
        'Cherry-My-Provider': {
          name: 'My.Provider',
          base_url: 'https://api.example.com/v1',
          wire_api: 'responses',
          experimental_bearer_token: 'sk-codex'
        }
      }
    })
  })

  it('preserves existing top-level keys and other model_providers', () => {
    const result = buildCodexConfig(
      { model_providers: { other: { base_url: 'https://other' } }, approval_policy: 'on-request' },
      config
    )
    expect(result?.approval_policy).toBe('on-request')
    expect(result?.model_providers.other).toEqual({ base_url: 'https://other' })
    expect(result?.model_providers['Cherry-My-Provider']).toBeTruthy()
  })

  it('returns null when required fields are missing', () => {
    expect(buildCodexConfig({}, { apiKey: '', baseUrl: '', providerName: '', model: 'gpt-x' })).toBeNull()
  })
})

describe('writeCodexConfig', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-codex-'))
    getPathMock.mockImplementation((_key: string, filename?: string) =>
      filename ? path.join(tmpDir, filename) : tmpDir
    )
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('writes config.toml, merging with existing content, at 0600', async () => {
    const file = path.join(tmpDir, 'config.toml')
    fs.writeFileSync(file, 'approval_policy = "on-request"\n\n[model_providers.other]\nbase_url = "https://other"\n')

    await writeCodexConfig(config)

    const parsed = parseToml(fs.readFileSync(file, 'utf8')) as any
    expect(parsed.approval_policy).toBe('on-request')
    expect(parsed.model).toBe('gpt-x')
    expect(parsed.model_provider).toBe('Cherry-My-Provider')
    expect(parsed.model_providers.other.base_url).toBe('https://other')
    expect(parsed.model_providers['Cherry-My-Provider'].experimental_bearer_token).toBe('sk-codex')
    expect(fs.statSync(file).mode & 0o777).toBe(0o600)
  })

  it('throws and writes nothing when required fields are missing', async () => {
    await expect(writeCodexConfig({ apiKey: '', baseUrl: '', providerName: '', model: 'gpt-x' })).rejects.toThrow()
    expect(fs.existsSync(path.join(tmpDir, 'config.toml'))).toBe(false)
  })
})
