import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { QwenProviderConfig } from '@shared/types/codeCli'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
  }
}))

vi.mock('@main/core/platform', () => ({ isMac: true, isWin: false }))

const getPathMock = vi.fn()
vi.mock('@application', () => ({ application: { getPath: (...args: unknown[]) => getPathMock(...args) } }))

import { buildQwenEnvFile, buildQwenSettings, writeQwenConfig } from '../qwenConfig'

const config: QwenProviderConfig = {
  apiKey: 'sk-qwen',
  baseUrl: 'https://dashscope.example.com/v1',
  model: 'qwen3-coder'
}

describe('buildQwenEnvFile', () => {
  it('serializes the provider config as OPENAI_* lines', () => {
    expect(buildQwenEnvFile(config)).toBe(
      ['OPENAI_API_KEY=sk-qwen', 'OPENAI_BASE_URL=https://dashscope.example.com/v1', 'OPENAI_MODEL=qwen3-coder'].join(
        '\n'
      ) + '\n'
    )
  })

  it('returns null when required fields are missing', () => {
    expect(buildQwenEnvFile({ apiKey: '', baseUrl: '', model: '' })).toBeNull()
  })
})

describe('buildQwenSettings', () => {
  it('selects OpenAI auth while preserving other keys', () => {
    expect(buildQwenSettings({ theme: 'dark', security: { other: true } })).toEqual({
      theme: 'dark',
      security: { other: true, auth: { selectedType: 'openai' } }
    })
  })
})

describe('writeQwenConfig', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-qwen-'))
    getPathMock.mockImplementation((_key: string, filename?: string) =>
      filename ? path.join(tmpDir, filename) : tmpDir
    )
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('writes .env and merges settings.json at 0600', async () => {
    const settingsFile = path.join(tmpDir, 'settings.json')
    fs.writeFileSync(settingsFile, JSON.stringify({ ui: { theme: 'x' } }))

    await writeQwenConfig(config)

    expect(fs.readFileSync(path.join(tmpDir, '.env'), 'utf8')).toContain('OPENAI_API_KEY=sk-qwen')
    const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'))
    expect(settings.ui).toEqual({ theme: 'x' })
    expect(settings.security.auth.selectedType).toBe('openai')
    expect(fs.statSync(settingsFile).mode & 0o777).toBe(0o600)
  })

  it('throws and writes nothing when required fields are missing', async () => {
    await expect(writeQwenConfig({ apiKey: '', baseUrl: '', model: '' })).rejects.toThrow()
    expect(fs.existsSync(path.join(tmpDir, '.env'))).toBe(false)
  })
})
