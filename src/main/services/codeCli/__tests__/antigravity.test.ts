import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { Provider } from '@shared/data/types/provider'
import { CodeCli } from '@shared/types/codeCli'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  root: '',
  getByProviderId: vi.fn(),
  getRotatedApiKey: vi.fn(),
  getMultiple: vi.fn()
}))

vi.mock('@application', () => ({
  application: {
    getPath: vi.fn(() => mocks.root),
    get: vi.fn(() => ({ getMultiple: mocks.getMultiple }))
  }
}))

vi.mock('@data/services/ProviderService', () => ({
  providerService: {
    getByProviderId: mocks.getByProviderId,
    getRotatedApiKey: mocks.getRotatedApiKey
  }
}))

import { prepareAntigravityLaunch } from '../antigravity'

describe('prepareAntigravityLaunch', () => {
  beforeEach(async () => {
    mocks.root = await mkdtemp(path.join(tmpdir(), 'cherry-antigravity-test-'))
    mocks.getByProviderId.mockReset()
    mocks.getRotatedApiKey.mockReset()
    mocks.getMultiple.mockReset()
  })

  afterEach(async () => {
    await chmod(mocks.root, 0o700).catch(() => {})
    await rm(mocks.root, { recursive: true, force: true })
  })

  it('resolves a direct Gemini provider and preserves isolated settings with mode 0600', async () => {
    const settingsDir = path.join(mocks.root, 'antigravity-cli')
    const settingsPath = path.join(settingsDir, 'settings.json')
    await mkdir(settingsDir, { recursive: true })
    await writeFile(settingsPath, JSON.stringify({ theme: 'system', modelProvider: 'google' }), { mode: 0o644 })
    mocks.getByProviderId.mockReturnValue({
      id: 'custom-gemini',
      endpointConfigs: {
        'google-generate-content': { baseUrl: 'https://gemini.example.test' }
      }
    } as Provider)
    mocks.getRotatedApiKey.mockReturnValue('direct-secret')

    const result = await prepareAntigravityLaunch({
      mode: 'normal',
      cliTool: CodeCli.ANTIGRAVITY_CLI,
      providerId: 'custom-gemini',
      model: 'gemini-2.5-pro',
      directory: '/tmp/project'
    })

    expect(result).toEqual({
      env: {
        GEMINI_API_KEY: 'direct-secret',
        GOOGLE_GEMINI_BASE_URL: 'https://gemini.example.test'
      },
      geminiDir: mocks.root,
      model: 'gemini-2.5-pro'
    })
    expect(JSON.parse(await readFile(settingsPath, 'utf8'))).toEqual({ theme: 'system', modelProvider: 'gemini' })
    if (process.platform !== 'win32') expect((await stat(settingsPath)).mode & 0o777).toBe(0o600)
  })

  it('reads gateway credentials in main and uses an Antigravity custom model URL without the Gemini sentinel', async () => {
    mocks.getMultiple.mockReturnValue({ host: '127.0.0.1', port: 24444, apiKey: 'gateway-secret' })

    const result = await prepareAntigravityLaunch({
      mode: 'normal',
      cliTool: CodeCli.ANTIGRAVITY_CLI,
      providerId: 'provider-a',
      model: 'models/gemini-flash',
      gateway: true,
      directory: '/tmp/project'
    })

    expect(result.env).toEqual({
      GEMINI_API_KEY: 'gateway-secret',
      GOOGLE_GEMINI_BASE_URL: 'http://127.0.0.1:24444'
    })
    expect(result.model).toBe('gemini-api://provider-a/models/models/gemini-flash')
    expect(result.model).not.toContain('@cherry')
    expect(mocks.getByProviderId).not.toHaveBeenCalled()
  })

  it('rejects malformed isolated settings instead of overwriting them', async () => {
    const settingsDir = path.join(mocks.root, 'antigravity-cli')
    const settingsPath = path.join(settingsDir, 'settings.json')
    await mkdir(settingsDir, { recursive: true })
    await writeFile(settingsPath, '{ invalid json')
    mocks.getByProviderId.mockReturnValue({ id: 'gemini', endpointConfigs: {} } as Provider)
    mocks.getRotatedApiKey.mockReturnValue('direct-secret')

    await expect(
      prepareAntigravityLaunch({
        mode: 'normal',
        cliTool: CodeCli.ANTIGRAVITY_CLI,
        providerId: 'gemini',
        model: 'gemini-2.5-pro',
        directory: '/tmp/project'
      })
    ).rejects.toThrow('Failed to read Antigravity CLI settings')
    expect(await readFile(settingsPath, 'utf8')).toBe('{ invalid json')
  })
})
