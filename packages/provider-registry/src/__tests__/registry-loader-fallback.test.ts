import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { bundledCatalog } from '../bundled-catalog'
import { RegistryLoader, type RegistryPaths } from '../registry-loader'

describe('RegistryLoader disk fallback', () => {
  let dir: string
  let paths: RegistryPaths
  let loader: RegistryLoader
  const onFallback = vi.fn()

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'registry-fallback-'))
    paths = {
      models: join(dir, 'models.json'),
      providers: join(dir, 'providers.json'),
      providerModels: join(dir, 'provider-models.json')
    }
    onFallback.mockClear()
    loader = new RegistryLoader(paths, { fallbacks: bundledCatalog, onFallback })
  })

  afterEach(() => {
    loader.invalidate()
    vi.useRealTimers()
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns bundled providers when the file is missing and reports it once per cache cycle', () => {
    expect(loader.loadProviders()).toEqual(bundledCatalog.providers.providers)
    expect(loader.getProvidersVersion()).toBe(bundledCatalog.providers.version)
    expect(onFallback).toHaveBeenCalledExactlyOnceWith({
      file: 'providers.json',
      path: paths.providers,
      error: expect.objectContaining({ cause: expect.objectContaining({ code: 'ENOENT' }) })
    })

    loader.invalidate()
    expect(loader.findProvider('openai')).toMatchObject({ id: 'openai' })
    expect(onFallback).toHaveBeenCalledTimes(2)
  })

  it('returns bundled models for corrupt JSON and reports the parse error once', () => {
    writeFileSync(paths.models, '{')

    expect(loader.loadModels()).toEqual(bundledCatalog.models.models)
    expect(loader.getModelsVersion()).toBe(bundledCatalog.models.version)
    expect(onFallback).toHaveBeenCalledExactlyOnceWith({
      file: 'models.json',
      path: paths.models,
      error: expect.objectContaining({ cause: expect.any(SyntaxError) })
    })
  })

  it('returns bundled provider-model overrides when the disk data violates the schema', () => {
    writeFileSync(paths.providerModels, '{"version":"2026.01.01","overrides":{}}')

    expect(loader.loadProviderModels()).toEqual(bundledCatalog.providerModels.overrides)
    expect(loader.getProviderModelsVersion()).toBe(bundledCatalog.providerModels.version)
    expect(onFallback).toHaveBeenCalledExactlyOnceWith({
      file: 'provider-models.json',
      path: paths.providerModels,
      error: expect.any(Error)
    })
  })

  it('preserves the error and filesystem cause when no fallback is provided', () => {
    mkdirSync(paths.providers)
    loader = new RegistryLoader(paths, 30_000)

    expect(() => loader.loadProviders()).toThrow(
      expect.objectContaining({
        message: `Failed to load registry file: ${paths.providers}`,
        cause: expect.objectContaining({ code: 'EISDIR' })
      })
    )
  })

  it('returns independent arrays for the bundled fallback', () => {
    expect(loader.loadModels()).not.toBe(bundledCatalog.models.models)
    expect(loader.loadProviders()).not.toBe(bundledCatalog.providers.providers)
    expect(loader.loadProviderModels()).not.toBe(bundledCatalog.providerModels.overrides)
  })

  it('loads the repaired file and its version after invalidation without reporting another fallback', () => {
    expect(loader.findProvider('openai')).toMatchObject({ id: 'openai' })

    const repairedProvider = { id: 'openai', name: 'Repaired OpenAI', metadata: { website: {} } }
    writeFileSync(paths.providers, JSON.stringify({ version: '2099.01.01', providers: [repairedProvider] }))
    loader.invalidate()

    expect(loader.loadProviders()).toMatchObject([repairedProvider])
    expect(loader.getProvidersVersion()).toBe('2099.01.01')
    expect(onFallback).toHaveBeenCalledTimes(1)
  })

  it('retries a fallback on schedule while accesses keep the idle cache alive', () => {
    vi.useFakeTimers()
    loader = new RegistryLoader(paths, { idleTtlMs: 100, fallbacks: bundledCatalog, onFallback })
    expect(loader.getProvidersVersion()).toBe(bundledCatalog.providers.version)
    vi.advanceTimersByTime(50)
    expect(loader.findProvider('openai')).toMatchObject({ id: 'openai' })
    expect(onFallback).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(50)
    expect(loader.getProvidersVersion()).toBe(bundledCatalog.providers.version)
    expect(onFallback).toHaveBeenCalledTimes(2)

    const repairedProvider = { id: 'openai', name: 'Repaired OpenAI', metadata: { website: {} } }
    writeFileSync(paths.providers, JSON.stringify({ version: '2099.01.01', providers: [repairedProvider] }))
    vi.advanceTimersByTime(50)
    expect(loader.getProvidersVersion()).toBe(bundledCatalog.providers.version)
    vi.advanceTimersByTime(50)
    expect(loader.getProvidersVersion()).toBe('2099.01.01')
    expect(loader.findProvider('openai')).toMatchObject(repairedProvider)
    expect(onFallback).toHaveBeenCalledTimes(2)
  })
})
