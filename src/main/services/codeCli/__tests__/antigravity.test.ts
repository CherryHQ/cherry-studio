import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CodeCli } from '@shared/types/codeCli'

const mocks = vi.hoisted(() => ({
  root: '',
  getByProviderId: vi.fn(),
  getByKey: vi.fn(),
  list: vi.fn(),
  resolveApiKey: vi.fn(),
  getMultiple: vi.fn()
}))

vi.mock('@application', async () => {
  const { mkdirSync } = await import('node:fs')
  const nodePath = await import('node:path')
  return {
    application: {
      // Mirrors Application.getPath: a `…file` key auto-creates its parent directory.
      getPath: vi.fn((key: string) => {
        if (key !== 'feature.cli.antigravity.settings.file') return mocks.root
        const settingsPath = nodePath.join(mocks.root, 'antigravity-cli', 'settings.json')
        mkdirSync(nodePath.dirname(settingsPath), { recursive: true })
        return settingsPath
      }),
      get: vi.fn(() => ({ getMultiple: mocks.getMultiple }))
    }
  }
})

vi.mock('@data/services/ModelService', () => ({
  modelService: {
    getByKey: mocks.getByKey,
    list: mocks.list
  }
}))

vi.mock('@data/services/ProviderService', () => ({
  providerService: {
    getByProviderId: mocks.getByProviderId,
    resolveApiKey: mocks.resolveApiKey
  }
}))

import { prepareAntigravityLaunch } from '../antigravity'

describe('prepareAntigravityLaunch', () => {
  beforeEach(async () => {
    mocks.root = await mkdtemp(path.join(tmpdir(), 'cherry-antigravity-test-'))
    mocks.getByProviderId.mockReset()
    mocks.getByKey.mockReset()
    mocks.list.mockReset()
    mocks.resolveApiKey.mockReset()
    mocks.getMultiple.mockReset()
    mocks.list.mockReturnValue([])
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
    })
    mocks.list.mockReturnValue([{ id: 'custom-gemini::gemini-2.5-pro', apiKeyId: 'key-a' }])
    mocks.resolveApiKey.mockReturnValue({ value: 'direct-secret' })

    const result = await prepareAntigravityLaunch({
      mode: 'normal',
      cliTool: CodeCli.ANTIGRAVITY_CLI,
      providerId: 'custom-gemini',
      model: 'gemini-2.5-pro',
      directory: '/tmp/project'
    })

    expect(mocks.getByKey).not.toHaveBeenCalled()
    expect(mocks.resolveApiKey).toHaveBeenCalledWith('custom-gemini', undefined, 'key-a')
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

  it('resolves api key bindings by provider-facing apiModelId when the internal id differs', async () => {
    mocks.getByProviderId.mockReturnValue({ id: 'custom-gemini', endpointConfigs: {} })
    mocks.list.mockReturnValue([
      {
        id: 'custom-gemini::my-alias',
        apiModelId: 'gemini-2.5-pro',
        apiKeyId: 'key-bound'
      }
    ])
    mocks.resolveApiKey.mockReturnValue({ value: 'alias-secret' })

    await prepareAntigravityLaunch({
      mode: 'normal',
      cliTool: CodeCli.ANTIGRAVITY_CLI,
      providerId: 'custom-gemini',
      model: 'gemini-2.5-pro',
      directory: '/tmp/project'
    })

    expect(mocks.getByKey).not.toHaveBeenCalled()
    expect(mocks.resolveApiKey).toHaveBeenCalledWith('custom-gemini', undefined, 'key-bound')
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

  it('rejects a gateway launch whose provider id carries the path separator', async () => {
    // The route splits on the FIRST separator, so "team/models/west" would address provider
    // "team". Only this path form is ambiguous, which is why the guard lives here.
    mocks.getMultiple.mockReturnValue({ host: '127.0.0.1', port: 24444, apiKey: 'gateway-secret' })

    await expect(
      prepareAntigravityLaunch({
        mode: 'normal',
        cliTool: CodeCli.ANTIGRAVITY_CLI,
        providerId: 'team/models/west',
        model: 'gemini-2.5-pro',
        gateway: true,
        directory: '/tmp/project'
      })
    ).rejects.toThrow(/cannot be addressed by antigravity-cli/)
  })

  it('rejects an unsafe model id without touching the isolated settings', async () => {
    const settingsPath = path.join(mocks.root, 'antigravity-cli', 'settings.json')
    mocks.getByProviderId.mockReturnValue({ id: 'gemini', endpointConfigs: {} })
    mocks.list.mockReturnValue([{ id: 'gemini::gemini; open /Applications/Calculator.app' }])
    mocks.resolveApiKey.mockReturnValue({ value: 'direct-secret' })

    await expect(
      prepareAntigravityLaunch({
        mode: 'normal',
        cliTool: CodeCli.ANTIGRAVITY_CLI,
        providerId: 'gemini',
        model: 'gemini; open /Applications/Calculator.app',
        directory: '/tmp/project'
      })
    ).rejects.toThrow('Unsupported model id')
    await expect(readFile(settingsPath, 'utf8')).rejects.toThrow(/ENOENT/)
  })

  it('rejects malformed isolated settings instead of overwriting them', async () => {
    const settingsDir = path.join(mocks.root, 'antigravity-cli')
    const settingsPath = path.join(settingsDir, 'settings.json')
    await mkdir(settingsDir, { recursive: true })
    await writeFile(settingsPath, '{ invalid json')
    mocks.getByProviderId.mockReturnValue({ id: 'gemini', endpointConfigs: {} })
    mocks.list.mockReturnValue([{ id: 'gemini::gemini-2.5-pro' }])
    mocks.resolveApiKey.mockReturnValue({ value: 'direct-secret' })

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
