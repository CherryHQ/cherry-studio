import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { app } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { bundledCatalog } from '@cherrystudio/provider-registry/data'
import { REGISTRY_FILES, REGISTRY_SCHEMA_VERSION } from '@cherrystudio/provider-registry/node'
import { PresetProviderSeeder } from '@data/db/seeding/seeders/presetProviderSeeder'
import { providerRegistryService } from '@data/services/ProviderRegistryService'
import type * as Platform from '@main/core/platform'
import { ScreenCaptureError } from '@main/services/screenshot'
import { UpgradeChannel } from '@shared/data/preference/preferenceTypes'

const services = vi.hoisted(() => ({
  queryUpdateAvailability: vi.fn(),
  loadNativeCaptureBackend: vi.fn()
}))
const platform = vi.hoisted(() => ({ isPortable: false }))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    AppUpdaterService: { queryUpdateAvailability: services.queryUpdateAvailability }
  } as never)
})
vi.mock('@main/services/screenshot/nativeCaptureBackend', () => ({
  loadNativeCaptureBackend: services.loadNativeCaptureBackend
}))
vi.mock('@main/core/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof Platform>()),
  get isPortable() {
    return platform.isPortable
  }
}))

const {
  installArchitectureMatch,
  installNativeModules,
  installUpdateAvailable,
  installVersionChannel,
  providerRegistryReadable
} = await import('../install')

const setTranslated = (value: boolean | undefined) => {
  ;(app as { runningUnderARM64Translation?: boolean }).runningUnderARM64Translation = value
}
const signal = new AbortController().signal
const ctx = { signal, share: <T>(_key: string, factory: (signal: AbortSignal) => Promise<T>) => factory(signal) }

beforeEach(() => {
  vi.clearAllMocks()
  MockMainPreferenceServiceUtils.resetMocks()
  vi.mocked(app.getVersion).mockReturnValue('2.0.0')
  services.queryUpdateAvailability.mockResolvedValue({ status: 'current', currentVersion: '2.0.0' })
  services.loadNativeCaptureBackend.mockReturnValue({})
  setTranslated(false)
})

describe('install-architecture-match', () => {
  it('passes on a build that matches the machine', async () => {
    await expect(installArchitectureMatch.run(ctx)).resolves.toEqual({ status: 'pass' })
  })

  // linux has no translator, so Electron does not define the property at all.
  it('passes where the platform exposes no translation flag', async () => {
    setTranslated(undefined)
    await expect(installArchitectureMatch.run(ctx)).resolves.toEqual({ status: 'pass' })
  })

  it('warns when an x64 build runs under ARM64 translation', async () => {
    setTranslated(true)
    await expect(installArchitectureMatch.run(ctx)).resolves.toMatchObject({
      status: 'warn',
      attribution: 'user-fixable',
      detail: { variant: 'translated', params: { arch: process.arch } },
      evidence: expect.arrayContaining([{ key: 'translated', value: true, dataClass: 'public' }])
    })
  })
})

describe('install-version-channel', () => {
  it('passes when the test plan is disabled', async () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('app.dist.test_plan.channel', UpgradeChannel.BETA)
    await expect(installVersionChannel.run(ctx)).resolves.toEqual({ status: 'pass' })
  })

  it('does not report stable builds when a test channel is selected', async () => {
    MockMainPreferenceServiceUtils.setMultiplePreferenceValues({
      'app.dist.test_plan.enabled': true,
      'app.dist.test_plan.channel': UpgradeChannel.BETA
    })
    await expect(installVersionChannel.run(ctx)).resolves.toEqual({ status: 'pass' })
  })

  it('passes when the running prerelease matches the selected channel', async () => {
    vi.mocked(app.getVersion).mockReturnValue('2.1.0-rc.3')
    MockMainPreferenceServiceUtils.setMultiplePreferenceValues({
      'app.dist.test_plan.enabled': true,
      'app.dist.test_plan.channel': UpgradeChannel.RC
    })
    await expect(installVersionChannel.run(ctx)).resolves.toEqual({ status: 'pass' })
  })

  it('warns and links to About when the prerelease and selected channels differ', async () => {
    vi.mocked(app.getVersion).mockReturnValue('2.1.0-beta.2')
    MockMainPreferenceServiceUtils.setMultiplePreferenceValues({
      'app.dist.test_plan.enabled': true,
      'app.dist.test_plan.channel': UpgradeChannel.RC
    })

    await expect(installVersionChannel.run(ctx)).resolves.toMatchObject({
      status: 'warn',
      attribution: 'user-fixable',
      detail: { variant: 'mismatch', params: { runningChannel: 'beta', selectedChannel: 'rc' } },
      actions: [{ kind: 'navigate', target: '/settings/about' }]
    })
  })
})

describe('install-update-available', () => {
  it('distinguishes unsupported updates from an up-to-date app', async () => {
    services.queryUpdateAvailability.mockResolvedValue({ status: 'unsupported' })
    await expect(installUpdateAvailable.run(ctx)).resolves.toMatchObject({
      status: 'warn',
      detail: { variant: 'unsupported' },
      actions: [{ kind: 'navigate', target: '/settings/about' }]
    })
  })

  it('propagates query failure for the engine to report an error', async () => {
    services.queryUpdateAvailability.mockRejectedValue(new Error('query failed'))
    await expect(installUpdateAvailable.run(ctx)).rejects.toThrow('query failed')
  })

  it('passes when the updater reports no newer release', async () => {
    await expect(installUpdateAvailable.run(ctx)).resolves.toEqual({ status: 'pass' })
  })

  it('warns with the available version and an About settings action', async () => {
    services.queryUpdateAvailability.mockResolvedValue({
      currentVersion: '2.0.0',
      status: 'available',
      version: '2.1.0'
    })

    await expect(installUpdateAvailable.run(ctx)).resolves.toMatchObject({
      status: 'warn',
      attribution: 'user-fixable',
      detail: { variant: 'available', params: { currentVersion: '2.0.0', availableVersion: '2.1.0' } },
      actions: [{ kind: 'navigate', target: '/settings/about' }]
    })
  })
})

describe('install-native-modules', () => {
  it('passes when the native capture backend loads', async () => {
    await expect(installNativeModules.run(ctx)).resolves.toEqual({ status: 'pass' })
  })

  it('reports a missing or unloadable native backend as an app bug', async () => {
    services.loadNativeCaptureBackend.mockImplementation(() => {
      throw new ScreenCaptureError('Screen capture backend is unavailable', { cause: new Error('dlopen failed') })
    })

    await expect(installNativeModules.run(ctx)).resolves.toMatchObject({
      status: 'fail',
      attribution: 'app-bug',
      detail: { variant: 'unavailable' },
      actions: [{ kind: 'report' }],
      evidence: [
        { key: 'module', value: 'node-screenshots', dataClass: 'public' },
        { key: 'error', value: 'Screen capture backend is unavailable', dataClass: 'consent_required' },
        { key: 'cause', value: 'dlopen failed', dataClass: 'consent_required' }
      ]
    })
  })
})

describe('install-provider-registry-readable', () => {
  let fixtureRoot: string
  let bundledRoot: string
  let overrideRoot: string
  const modelFiles = ['models.json', 'provider-models.json'] as const
  const overrideFiles = {
    'models.json': { version: 'models', models: [] },
    'provider-models.json': { version: 'provider-models', overrides: [] }
  }

  function writeOverride() {
    mkdirSync(overrideRoot, { recursive: true })
    for (const file of modelFiles) {
      writeFileSync(path.join(overrideRoot, file), JSON.stringify(overrideFiles[file]))
    }
    writeFileSync(
      path.join(overrideRoot, 'manifest.json'),
      JSON.stringify({
        minAppVersion: app.getVersion(),
        sourceAppVersion: app.getVersion(),
        revision: 1,
        schemaVersion: REGISTRY_SCHEMA_VERSION,
        files: { 'models.json': 'models', 'provider-models.json': 'provider-models' }
      })
    )
  }

  beforeEach(() => {
    platform.isPortable = false
    fixtureRoot = mkdtempSync(path.join(os.tmpdir(), 'doctor-provider-registry-'))
    bundledRoot = path.join(fixtureRoot, 'provider-registry')
    overrideRoot = path.join(fixtureRoot, 'override')
    mkdirSync(bundledRoot)
    for (const file of REGISTRY_FILES) {
      copyFileSync(path.resolve('packages/provider-registry/data', file), path.join(bundledRoot, file))
    }
    vi.spyOn(application, 'getPath').mockImplementation((key, filename = '') =>
      path.join(key === 'feature.provider_registry.override' ? overrideRoot : bundledRoot, filename)
    )
  })

  afterEach(() => {
    providerRegistryService.clearCache()
    vi.useRealTimers()
    vi.restoreAllMocks()
    rmSync(fixtureRoot, { recursive: true })
  })

  it('passes without evidence or actions when all three bundled files are valid', async () => {
    await expect(providerRegistryReadable.run(ctx)).resolves.toEqual({ status: 'pass' })
  })

  it('reports the missing provider file before an invalid models file and offers recovery actions', async () => {
    const providers = path.join(bundledRoot, 'providers.json')
    unlinkSync(providers)
    writeFileSync(path.join(bundledRoot, 'models.json'), '{}')

    expect(providerRegistryService.isRegistryProvider('openai')).toBe(true)
    expect(providerRegistryService.getRegistryFallbacks()).toEqual([
      {
        file: 'providers.json',
        path: providers,
        namespace: 'bundled',
        message: `Failed to load registry file: ${providers}`,
        cause: 'ENOENT'
      }
    ])

    await expect(providerRegistryReadable.run(ctx)).resolves.toMatchObject({
      status: 'warn',
      attribution: 'user-fixable',
      detail: { variant: 'unreadable', params: { file: 'providers.json' } },
      actions: [{ kind: 'navigate', target: '/settings/about' }, { kind: 'report' }],
      evidence: expect.arrayContaining([
        { key: 'file', value: 'providers.json', dataClass: 'public' },
        { key: 'namespace', value: 'bundled', dataClass: 'public' },
        { key: 'path', value: providers, dataClass: 'local_only' },
        { key: 'bundledRoot', value: bundledRoot, dataClass: 'local_only' },
        { key: 'usingBundledFallback', value: true, dataClass: 'public' },
        { key: 'resourcesUnderTempDir', value: true, dataClass: 'public' },
        { key: 'portable', value: false, dataClass: 'public' },
        { key: 'cause', value: expect.stringContaining('ENOENT'), dataClass: 'consent_required' }
      ])
    })
  })

  it('reports malformed provider JSON with the original parse error', async () => {
    writeFileSync(path.join(bundledRoot, 'providers.json'), '{')

    await expect(providerRegistryReadable.run(ctx)).resolves.toMatchObject({
      status: 'warn',
      detail: { variant: 'unreadable', params: { file: 'providers.json' } },
      devMessage: 'Using the in-bundle provider registry for providers.json (namespace: bundled)',
      evidence: expect.arrayContaining([
        { key: 'cause', value: expect.stringMatching(/\S/), dataClass: 'consent_required' }
      ])
    })
  })

  it('warns for a syntactically valid models file with an invalid schema', async () => {
    writeFileSync(path.join(bundledRoot, 'models.json'), '{"version":"test","models":{}}')

    await expect(providerRegistryReadable.run(ctx)).resolves.toMatchObject({
      status: 'warn',
      detail: { variant: 'unreadable', params: { file: 'models.json' } }
    })
  })

  it('reports an incomplete cold-start override snapshot before any override loader runs', async () => {
    writeOverride()
    const providerModels = path.join(overrideRoot, 'provider-models.json')
    unlinkSync(providerModels)

    expect(providerRegistryService.getRegistryFallbacks()).toEqual([])

    await expect(providerRegistryReadable.run(ctx)).resolves.toMatchObject({
      status: 'warn',
      attribution: 'user-fixable',
      detail: { variant: 'unreadable_override', params: { file: 'provider-models.json' } },
      actions: [{ kind: 'navigate', target: '/settings/about' }, { kind: 'report' }],
      evidence: expect.arrayContaining([
        { key: 'file', value: 'provider-models.json', dataClass: 'public' },
        { key: 'namespace', value: 'override', dataClass: 'public' },
        { key: 'path', value: providerModels, dataClass: 'local_only' },
        { key: 'cause', value: 'missing', dataClass: 'consent_required' }
      ])
    })
  })

  it('reports a corrupt cold-start override file before any override loader runs', async () => {
    writeOverride()
    const providerModels = path.join(overrideRoot, 'provider-models.json')
    writeFileSync(providerModels, '{')

    expect(providerRegistryService.getRegistryFallbacks()).toEqual([])

    await expect(providerRegistryReadable.run(ctx)).resolves.toMatchObject({
      status: 'warn',
      attribution: 'user-fixable',
      detail: { variant: 'unreadable_override', params: { file: 'provider-models.json' } },
      evidence: expect.arrayContaining([
        { key: 'file', value: 'provider-models.json', dataClass: 'public' },
        { key: 'namespace', value: 'override', dataClass: 'public' },
        { key: 'path', value: providerModels, dataClass: 'local_only' },
        { key: 'cause', value: 'unparsable', dataClass: 'consent_required' }
      ])
    })
  })

  it('passes when a complete compatible override snapshot is present', async () => {
    writeOverride()
    await expect(providerRegistryReadable.run(ctx)).resolves.toEqual({ status: 'pass' })
  })

  it('attributes invalid provider-model metadata to the active override', async () => {
    writeOverride()
    const providerModels = path.join(overrideRoot, 'provider-models.json')
    writeFileSync(providerModels, '{"version":"provider-models","overrides":{}}')

    await expect(providerRegistryReadable.run(ctx)).resolves.toMatchObject({
      status: 'warn',
      detail: { variant: 'unreadable_override', params: { file: 'provider-models.json' } },
      evidence: expect.arrayContaining([
        { key: 'namespace', value: 'override', dataClass: 'public' },
        { key: 'path', value: providerModels, dataClass: 'local_only' }
      ])
    })
  })

  it.each(modelFiles)('uses bundled model versions together when the downloaded %s fails validation', (file) => {
    vi.useFakeTimers()
    writeOverride()
    expect(providerRegistryService.getCatalogVersion('models.json')).toBe('models')
    expect(providerRegistryService.getCatalogVersion('provider-models.json')).toBe('provider-models')

    const invalid = file === 'models.json' ? { models: {} } : { overrides: {} }
    const filePath = path.join(overrideRoot, file)
    writeFileSync(filePath, JSON.stringify({ ...overrideFiles[file], ...invalid }))
    vi.advanceTimersByTime(30_000)

    const other = file === 'models.json' ? 'provider-models.json' : 'models.json'
    const bundledVersions = {
      'models.json': bundledCatalog.models.version,
      'provider-models.json': bundledCatalog.providerModels.version
    }
    expect(providerRegistryService.getCatalogVersion(other)).toBe(bundledVersions[other])
    expect(providerRegistryService.getCatalogVersion(file)).toBe(bundledVersions[file])
    expect(providerRegistryService.getRegistryFallbacks()).toEqual([
      {
        file,
        path: filePath,
        namespace: 'override',
        message: `Failed to load registry file: ${filePath}`,
        cause: 'ZodError'
      }
    ])
  })

  it('reports a downloaded file that breaks after selection and clears the warning after repair', async () => {
    vi.useFakeTimers()
    writeOverride()
    expect(providerRegistryService.getCatalogVersion('models.json')).toBe('models')
    const file = 'provider-models.json'
    const filePath = path.join(overrideRoot, file)
    unlinkSync(filePath)
    vi.advanceTimersByTime(30_000)
    expect(providerRegistryService.getCatalogVersion(file)).toBe(bundledCatalog.providerModels.version)

    await expect(providerRegistryReadable.run(ctx)).resolves.toMatchObject({
      status: 'warn',
      detail: { variant: 'unreadable_override', params: { file } },
      evidence: expect.arrayContaining([{ key: 'cause', value: 'ENOENT', dataClass: 'consent_required' }])
    })

    writeFileSync(filePath, JSON.stringify(overrideFiles[file]))
    await expect(providerRegistryReadable.run(ctx)).resolves.toMatchObject({ status: 'warn' })
    vi.advanceTimersByTime(30_000)
    await expect(providerRegistryReadable.run(ctx)).resolves.toEqual({ status: 'pass' })
    expect(providerRegistryService.getRegistryFallbacks()).toEqual([])
    expect(providerRegistryService.getCatalogVersion('models.json')).toBe('models')
    expect(providerRegistryService.getCatalogVersion(file)).toBe('provider-models')
  })

  it('waits for the downloaded pair to match its manifest before switching back', () => {
    vi.useFakeTimers()
    writeOverride()
    expect(providerRegistryService.getCatalogVersion('models.json')).toBe('models')
    const file = 'provider-models.json'
    const filePath = path.join(overrideRoot, file)
    unlinkSync(filePath)
    vi.advanceTimersByTime(30_000)
    expect(providerRegistryService.getCatalogVersion(file)).toBe(bundledCatalog.providerModels.version)

    writeFileSync(filePath, JSON.stringify({ ...overrideFiles[file], version: 'another-snapshot' }))
    vi.advanceTimersByTime(30_000)
    expect(providerRegistryService.getCatalogVersion('models.json')).toBe(bundledCatalog.models.version)
    expect(providerRegistryService.getCatalogVersion(file)).toBe(bundledCatalog.providerModels.version)
  })

  it('clears a bundled-file warning after the cached fallback expires and the repaired file loads', async () => {
    vi.useFakeTimers()
    const providersPath = path.join(bundledRoot, 'providers.json')
    unlinkSync(providersPath)
    expect(providerRegistryService.isRegistryProvider('openai')).toBe(true)

    copyFileSync(path.resolve('packages/provider-registry/data/providers.json'), providersPath)
    await expect(providerRegistryReadable.run(ctx)).resolves.toMatchObject({ status: 'warn' })
    vi.advanceTimersByTime(30_000)
    await expect(providerRegistryReadable.run(ctx)).resolves.toEqual({ status: 'pass' })
    expect(providerRegistryService.getRegistryFallbacks()).toEqual([])
  })

  it('logs a structured fallback at most once per file in ten minutes, including across cache clears', () => {
    vi.useFakeTimers()
    vi.setSystemTime(Date.now() + 20 * 60_000)
    const providersPath = path.join(bundledRoot, 'providers.json')
    unlinkSync(providersPath)
    expect(providerRegistryService.getCatalogVersion('providers.json')).toBe(bundledCatalog.providers.version)
    expect(mockMainLoggerService.warn).toHaveBeenCalledExactlyOnceWith('Using the in-bundle provider registry', {
      file: 'providers.json',
      path: providersPath,
      namespace: 'bundled',
      message: `Failed to load registry file: ${providersPath}`,
      cause: 'ENOENT'
    })

    providerRegistryService.clearCache()
    vi.advanceTimersByTime(10 * 60_000 - 1)
    expect(providerRegistryService.getCatalogVersion('providers.json')).toBe(bundledCatalog.providers.version)
    expect(mockMainLoggerService.warn).toHaveBeenCalledTimes(1)
    providerRegistryService.clearCache()
    vi.advanceTimersByTime(1)
    expect(providerRegistryService.getCatalogVersion('providers.json')).toBe(bundledCatalog.providers.version)
    expect(mockMainLoggerService.warn).toHaveBeenCalledTimes(2)
  })

  it('logs the structured cause when the seeder falls back to in-bundle providers', () => {
    vi.useFakeTimers()
    const providersPath = path.join(bundledRoot, 'providers.json')
    writeFileSync(providersPath, '{')
    expect(new PresetProviderSeeder().version).toBe(`${bundledCatalog.providers.version}:1`)
    expect(mockMainLoggerService.warn).toHaveBeenCalledExactlyOnceWith('Using the in-bundle provider registry', {
      file: 'providers.json',
      path: providersPath,
      message: `Failed to load registry file: ${providersPath}`,
      cause: 'SyntaxError'
    })
  })

  it('passes a healthy portable build in temp and records portable and temp evidence in the warning', async () => {
    platform.isPortable = true
    await expect(providerRegistryReadable.run(ctx)).resolves.toEqual({ status: 'pass' })

    unlinkSync(path.join(bundledRoot, 'providers.json'))

    await expect(providerRegistryReadable.run(ctx)).resolves.toMatchObject({
      status: 'warn',
      evidence: expect.arrayContaining([
        { key: 'resourcesUnderTempDir', value: true, dataClass: 'public' },
        { key: 'portable', value: true, dataClass: 'public' }
      ])
    })
  })

  it('recognizes a temporary directory reached through an alias', async () => {
    const tempAlias = path.join(fixtureRoot, 'temp-alias')
    symlinkSync(fixtureRoot, tempAlias, 'junction')
    vi.spyOn(os, 'tmpdir').mockReturnValue(tempAlias)
    unlinkSync(path.join(bundledRoot, 'providers.json'))

    await expect(providerRegistryReadable.run(ctx)).resolves.toMatchObject({
      evidence: expect.arrayContaining([{ key: 'resourcesUnderTempDir', value: true, dataClass: 'public' }])
    })
  })

  it('does not match a sibling of the temporary directory with the same prefix', async () => {
    const tempRoot = path.join(fixtureRoot, 'provider')
    mkdirSync(tempRoot)
    vi.spyOn(os, 'tmpdir').mockReturnValue(tempRoot)
    unlinkSync(path.join(bundledRoot, 'providers.json'))

    await expect(providerRegistryReadable.run(ctx)).resolves.toMatchObject({
      evidence: expect.arrayContaining([{ key: 'resourcesUnderTempDir', value: false, dataClass: 'public' }])
    })
  })
})
