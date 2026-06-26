import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { OpenCodeProviderConfig } from '@shared/types/codeCli'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
  }
}))

vi.mock('@main/core/platform', () => ({ isMac: true, isWin: false }))

const getPathMock = vi.fn()
vi.mock('@application', () => ({ application: { getPath: (...args: unknown[]) => getPathMock(...args) } }))

import { buildOpenCodeConfig, writeOpenCodeConfig } from '../openCodeConfig'

const config: OpenCodeProviderConfig = {
  apiKey: 'sk-oc',
  baseUrl: 'https://api.example.com/v1',
  providerName: 'MyProvider',
  providerType: 'openai',
  endpointType: '',
  model: 'glm-4.6',
  modelName: 'glm-4.6',
  isReasoning: false,
  supportsReasoningEffort: false
}

describe('buildOpenCodeConfig', () => {
  it('builds a Cherry provider with the API key inlined (no env reference)', () => {
    expect(buildOpenCodeConfig({}, config)).toEqual({
      $schema: 'https://opencode.ai/config.json',
      provider: {
        'Cherry-MyProvider': {
          npm: '@ai-sdk/openai-compatible',
          name: 'Cherry-MyProvider',
          options: { apiKey: 'sk-oc', baseURL: 'https://api.example.com/v1' },
          models: { 'glm-4.6': { name: 'glm-4.6' } }
        }
      }
    })
  })

  it('preserves user providers/mcp and strips stale Cherry-* providers', () => {
    const result = buildOpenCodeConfig(
      {
        provider: { 'Cherry-Old': { npm: 'x' }, mine: { npm: 'y' } },
        mcp: { srv: { command: 'c' } }
      },
      config
    )
    expect(result?.provider.mine).toEqual({ npm: 'y' })
    expect(result?.provider['Cherry-Old']).toBeUndefined()
    expect(result?.provider['Cherry-MyProvider']).toBeTruthy()
    expect(result?.mcp).toEqual({ srv: { command: 'c' } })
  })

  it('adds anthropic thinking options for a reasoning anthropic model', () => {
    const result = buildOpenCodeConfig(
      {},
      { ...config, providerType: 'anthropic', model: 'claude', isReasoning: true, budgetTokens: 2048 }
    )
    expect(result?.provider['Cherry-MyProvider'].npm).toBe('@ai-sdk/anthropic')
    expect(result?.provider['Cherry-MyProvider'].models.claude).toEqual({
      name: 'glm-4.6',
      reasoning: true,
      options: { thinking: { budgetTokens: 2048, type: 'enabled' } }
    })
  })

  it('returns null when required fields are missing', () => {
    expect(
      buildOpenCodeConfig(
        {},
        {
          apiKey: '',
          baseUrl: '',
          providerName: '',
          providerType: '',
          endpointType: '',
          model: '',
          modelName: '',
          isReasoning: false,
          supportsReasoningEffort: false
        }
      )
    ).toBeNull()
  })
})

describe('writeOpenCodeConfig', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-opencode-'))
    getPathMock.mockImplementation((_key: string, filename?: string) =>
      filename ? path.join(tmpDir, filename) : tmpDir
    )
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('writes opencode.json, merging with existing content, at 0600', async () => {
    const file = path.join(tmpDir, 'opencode.json')
    fs.writeFileSync(file, JSON.stringify({ provider: { mine: { npm: 'y' } }, plugin: ['p'] }))

    await writeOpenCodeConfig(config)

    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    expect(parsed.plugin).toEqual(['p'])
    expect(parsed.provider.mine).toEqual({ npm: 'y' })
    expect(parsed.provider['Cherry-MyProvider'].options).toEqual({
      apiKey: 'sk-oc',
      baseURL: 'https://api.example.com/v1'
    })
    expect(fs.statSync(file).mode & 0o777).toBe(0o600)
  })

  it('throws and writes nothing when required fields are missing', async () => {
    await expect(
      writeOpenCodeConfig({
        apiKey: '',
        baseUrl: '',
        providerName: '',
        providerType: '',
        endpointType: '',
        model: '',
        modelName: '',
        isReasoning: false,
        supportsReasoningEffort: false
      })
    ).rejects.toThrow()
    expect(fs.existsSync(path.join(tmpDir, 'opencode.json'))).toBe(false)
  })
})
