import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { HermesProviderConfig } from '@shared/types/codeCli'
import YAML from 'js-yaml'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
  }
}))

vi.mock('@main/core/platform', () => ({ isMac: true, isWin: false }))

const getPathMock = vi.fn()
vi.mock('@application', () => ({ application: { getPath: (...args: unknown[]) => getPathMock(...args) } }))

import { buildHermesConfig, writeHermesConfig } from '../hermesConfig'

const config: HermesProviderConfig = {
  apiKey: 'sk-hermes',
  baseUrl: 'https://api.example.com/v1',
  apiMode: 'chat_completions',
  model: 'hermes-1',
  modelName: 'Hermes 1',
  providerName: 'MyProvider'
}

describe('buildHermesConfig', () => {
  it('builds the custom_providers entry with model config', () => {
    expect(buildHermesConfig({}, config)).toEqual({
      custom_providers: [
        {
          name: 'MyProvider',
          base_url: 'https://api.example.com/v1',
          api_key: 'sk-hermes',
          api_mode: 'chat_completions',
          model: 'hermes-1',
          models: { 'hermes-1': { name: 'Hermes 1' } }
        }
      ]
    })
  })

  it('writes context_length/max_tokens into the model config when provided', () => {
    const result = buildHermesConfig({}, { ...config, contextLength: 200000, maxTokens: 8192 })
    expect(result?.custom_providers[0].models['hermes-1']).toEqual({
      name: 'Hermes 1',
      context_length: 200000,
      max_tokens: 8192
    })
  })

  it('upserts by name: replaces an existing entry, preserving non-managed fields', () => {
    const existing = {
      agent: { max_turns: 50 },
      custom_providers: [
        {
          name: 'MyProvider',
          base_url: 'https://old',
          api_key: 'old-key',
          api_mode: 'old',
          model: 'old-model',
          models: { 'old-model': {} },
          request_timeout_seconds: 30
        }
      ]
    }
    const result = buildHermesConfig(existing, config)
    expect(result?.agent).toEqual({ max_turns: 50 })
    expect(result?.custom_providers).toHaveLength(1)
    expect(result?.custom_providers[0]).toEqual({
      request_timeout_seconds: 30,
      name: 'MyProvider',
      base_url: 'https://api.example.com/v1',
      api_key: 'sk-hermes',
      api_mode: 'chat_completions',
      model: 'hermes-1',
      models: { 'hermes-1': { name: 'Hermes 1' } }
    })
  })

  it('appends when no existing entry matches the provider name', () => {
    const existing = { custom_providers: [{ name: 'Other', base_url: 'https://other' }] }
    const result = buildHermesConfig(existing, config)
    expect(result?.custom_providers).toHaveLength(2)
    expect(result?.custom_providers[1].name).toBe('MyProvider')
  })

  it('returns null when required fields are missing', () => {
    expect(buildHermesConfig({}, { ...config, apiKey: '', baseUrl: '', model: '' })).toBeNull()
  })
})

describe('writeHermesConfig', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-hermes-'))
    getPathMock.mockImplementation((_key: string, filename?: string) =>
      filename ? path.join(tmpDir, filename) : tmpDir
    )
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('writes config.yaml, merging with existing content, at 0600', async () => {
    const file = path.join(tmpDir, 'config.yaml')
    fs.writeFileSync(file, YAML.dump({ agent: { max_turns: 50 } }))

    await writeHermesConfig(config)

    const parsed = YAML.load(fs.readFileSync(file, 'utf8')) as any
    expect(parsed.agent).toEqual({ max_turns: 50 })
    expect(parsed.custom_providers[0].name).toBe('MyProvider')
    expect(fs.statSync(file).mode & 0o777).toBe(0o600)
  })

  it('throws and writes nothing when required fields are missing', async () => {
    await expect(writeHermesConfig({ ...config, apiKey: '', baseUrl: '', model: '' })).rejects.toThrow()
    expect(fs.existsSync(path.join(tmpDir, 'config.yaml'))).toBe(false)
  })
})
