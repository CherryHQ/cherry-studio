import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { GeminiProviderConfig } from '@shared/types/codeCli'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
  }
}))

vi.mock('@main/core/platform', () => ({ isMac: true, isWin: false }))

const getPathMock = vi.fn()
vi.mock('@application', () => ({ application: { getPath: (...args: unknown[]) => getPathMock(...args) } }))

import { buildGeminiEnvFile, buildGeminiSettings, writeGeminiConfig } from '../geminiConfig'

const config: GeminiProviderConfig = {
  apiKey: 'g-key',
  baseUrl: 'https://gemini.example.com',
  model: 'gemini-2.0'
}

describe('buildGeminiEnvFile', () => {
  it('serializes the provider config as KEY=VALUE lines', () => {
    expect(buildGeminiEnvFile(config)).toBe(
      [
        'GEMINI_API_KEY=g-key',
        'GEMINI_BASE_URL=https://gemini.example.com',
        'GOOGLE_GEMINI_BASE_URL=https://gemini.example.com',
        'GEMINI_MODEL=gemini-2.0'
      ].join('\n') + '\n'
    )
  })

  it('returns null when required fields are missing', () => {
    expect(buildGeminiEnvFile({ apiKey: '', baseUrl: '', model: '' })).toBeNull()
  })
})

describe('buildGeminiSettings', () => {
  it('sets api-key auth while preserving other keys', () => {
    expect(buildGeminiSettings({ mcpServers: { a: 1 }, security: { other: true } })).toEqual({
      mcpServers: { a: 1 },
      security: { other: true, auth: { selectedType: 'gemini-api-key' } }
    })
  })
})

describe('writeGeminiConfig', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-gemini-'))
    getPathMock.mockImplementation((_key: string, filename?: string) =>
      filename ? path.join(tmpDir, filename) : tmpDir
    )
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('writes .env and merges settings.json, preserving mcpServers, at 0600', async () => {
    const settingsFile = path.join(tmpDir, 'settings.json')
    fs.writeFileSync(settingsFile, JSON.stringify({ mcpServers: { x: { url: 'u' } } }))

    await writeGeminiConfig(config)

    const envContent = fs.readFileSync(path.join(tmpDir, '.env'), 'utf8')
    expect(envContent).toContain('GEMINI_API_KEY=g-key')
    expect(envContent).toContain('GEMINI_MODEL=gemini-2.0')

    const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'))
    expect(settings.mcpServers).toEqual({ x: { url: 'u' } })
    expect(settings.security.auth.selectedType).toBe('gemini-api-key')
    expect(fs.statSync(settingsFile).mode & 0o777).toBe(0o600)
  })

  it('throws and writes nothing when required fields are missing', async () => {
    await expect(writeGeminiConfig({ apiKey: '', baseUrl: '', model: '' })).rejects.toThrow()
    expect(fs.existsSync(path.join(tmpDir, '.env'))).toBe(false)
  })
})
