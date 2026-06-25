import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { KimiProviderConfig } from '@shared/types/codeCli'
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

import { buildKimiConfig, writeKimiConfig } from '../kimiConfig'

const config: KimiProviderConfig = {
  apiKey: 'sk-kimi',
  model: 'kimi-for-coding',
  baseUrl: 'https://api.kimi.example.com/v1',
  providerType: 'openai'
}

describe('buildKimiConfig', () => {
  it('builds namespaced provider + model alias and sets default_model', () => {
    expect(buildKimiConfig({}, config)).toEqual({
      default_model: 'cherry/kimi-for-coding',
      providers: {
        cherry: { type: 'openai', api_key: 'sk-kimi', base_url: 'https://api.kimi.example.com/v1' }
      },
      models: {
        'cherry/kimi-for-coding': { provider: 'cherry', model: 'kimi-for-coding' }
      }
    })
  })

  it('preserves the user other providers/models', () => {
    const result = buildKimiConfig(
      { providers: { mine: { type: 'kimi' } }, models: { 'mine/x': { provider: 'mine', model: 'x' } } },
      config
    )
    expect(result?.providers.mine).toEqual({ type: 'kimi' })
    expect(result?.models['mine/x']).toEqual({ provider: 'mine', model: 'x' })
    expect(result?.providers.cherry).toBeTruthy()
  })

  it('returns null when required fields are missing', () => {
    expect(buildKimiConfig({}, { apiKey: '', model: '' })).toBeNull()
  })
})

describe('writeKimiConfig', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-kimi-'))
    getPathMock.mockImplementation((_key: string, filename?: string) =>
      filename ? path.join(tmpDir, filename) : tmpDir
    )
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('writes config.toml, merging with existing content, at 0600', async () => {
    const file = path.join(tmpDir, 'config.toml')
    fs.writeFileSync(file, 'auto_update = false\n\n[providers.mine]\ntype = "kimi"\n')

    await writeKimiConfig(config)

    const parsed = parseToml(fs.readFileSync(file, 'utf8')) as any
    expect(parsed.auto_update).toBe(false)
    expect(parsed.default_model).toBe('cherry/kimi-for-coding')
    expect(parsed.providers.mine).toEqual({ type: 'kimi' })
    expect(parsed.providers.cherry).toEqual({
      type: 'openai',
      api_key: 'sk-kimi',
      base_url: 'https://api.kimi.example.com/v1'
    })
    expect(parsed.models['cherry/kimi-for-coding']).toEqual({ provider: 'cherry', model: 'kimi-for-coding' })
    expect(fs.statSync(file).mode & 0o777).toBe(0o600)
  })

  it('throws and writes nothing when required fields are missing', async () => {
    await expect(writeKimiConfig({ apiKey: '', model: '' })).rejects.toThrow()
    expect(fs.existsSync(path.join(tmpDir, 'config.toml'))).toBe(false)
  })
})
