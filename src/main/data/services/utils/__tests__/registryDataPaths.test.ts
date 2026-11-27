import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { resolve } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getVersion: () => '2.0.0' } }))

// Unified application mock: override getPath per test to point at temp fixtures.
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

import { application } from '@application'
import { REGISTRY_SCHEMA_VERSION } from '@cherrystudio/provider-registry/node'

import { probeOverrideSnapshot, readActiveOverrideManifest, resolveRegistryPaths } from '../registryDataPaths'

const FILES = { 'models.json': 'a', 'provider-models.json': 'c' }
const MANIFEST_DATA = {
  minAppVersion: '1.0.0',
  sourceAppVersion: '2.0.0',
  revision: 1,
  schemaVersion: REGISTRY_SCHEMA_VERSION,
  files: FILES
}

let fixtureRoot: string
let overrideRoot: string
let bundledRoot: string

function activePaths() {
  return {
    models: resolve(overrideRoot, 'models.json'),
    providers: resolve(bundledRoot, 'providers.json'),
    providerModels: resolve(overrideRoot, 'provider-models.json')
  }
}

function bundledPaths() {
  return {
    models: resolve(bundledRoot, 'models.json'),
    providers: resolve(bundledRoot, 'providers.json'),
    providerModels: resolve(bundledRoot, 'provider-models.json')
  }
}

function writeManifest(override: Record<string, unknown> = {}) {
  writeFileSync(resolve(overrideRoot, 'manifest.json'), JSON.stringify({ ...MANIFEST_DATA, ...override }))
}

function writeCompleteOverride() {
  writeManifest()
  writeFileSync(resolve(overrideRoot, 'models.json'), JSON.stringify({ version: 'a', models: [] }))
  writeFileSync(resolve(overrideRoot, 'provider-models.json'), JSON.stringify({ version: 'c', overrides: [] }))
}

beforeEach(() => {
  fixtureRoot = mkdtempSync(resolve(os.tmpdir(), 'registry-data-paths-'))
  overrideRoot = resolve(fixtureRoot, 'override')
  bundledRoot = resolve(fixtureRoot, 'bundled')
  mkdirSync(overrideRoot, { recursive: true })
  mkdirSync(bundledRoot, { recursive: true })
  vi.spyOn(application, 'getPath').mockImplementation((key, filename = '') =>
    resolve(key === 'feature.provider_registry.override' ? overrideRoot : bundledRoot, filename)
  )
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(fixtureRoot, { recursive: true, force: true })
})

describe('registryDataPaths.resolveRegistryPaths', () => {
  it('overrides model metadata while keeping security-sensitive provider routing bundled', () => {
    writeCompleteOverride()
    expect(resolveRegistryPaths()).toEqual(activePaths())
  })

  it('resolves all three files to bundled data when no override manifest exists', () => {
    expect(resolveRegistryPaths()).toEqual(bundledPaths())
  })

  it('ignores an override written for a newer schema (app downgrade) — falls back to bundled', () => {
    writeCompleteOverride()
    writeManifest({ schemaVersion: REGISTRY_SCHEMA_VERSION + 1, sourceAppVersion: '2.5.0' })
    expect(resolveRegistryPaths()).toEqual(bundledPaths())
  })

  it('ignores data that requires a newer application', () => {
    writeCompleteOverride()
    writeManifest({ minAppVersion: '2.1.0' })
    expect(resolveRegistryPaths()).toEqual(bundledPaths())
  })

  it('ignores a stale snapshot after an application upgrade', () => {
    writeCompleteOverride()
    writeManifest({ sourceAppVersion: '1.9.0' })
    expect(resolveRegistryPaths()).toEqual(bundledPaths())
  })

  it('ignores a half-written override (data present, manifest absent) — all-or-nothing', () => {
    writeFileSync(resolve(overrideRoot, 'models.json'), JSON.stringify({ version: 'a', models: [] }))
    expect(resolveRegistryPaths()).toEqual(bundledPaths())
  })

  it('ignores a manifest whose model snapshot is incomplete', () => {
    writeCompleteOverride()
    unlinkSync(resolve(overrideRoot, 'provider-models.json'))
    expect(resolveRegistryPaths()).toEqual(bundledPaths())
  })

  it('ignores model data whose content version does not match the manifest', () => {
    writeCompleteOverride()
    writeFileSync(resolve(overrideRoot, 'models.json'), JSON.stringify({ version: 'wrong', models: [] }))
    expect(resolveRegistryPaths()).toEqual(bundledPaths())
  })
})

describe('registryDataPaths.probeOverrideSnapshot', () => {
  it('returns null when no override manifest exists, including half-written snapshots', () => {
    expect(probeOverrideSnapshot()).toBeNull()

    writeFileSync(resolve(overrideRoot, 'models.json'), JSON.stringify({ version: 'a', models: [] }))
    expect(probeOverrideSnapshot()).toBeNull()
  })

  it('returns null and resolves to override when the snapshot is complete and compatible', () => {
    writeCompleteOverride()
    expect(probeOverrideSnapshot()).toBeNull()
    expect(readActiveOverrideManifest()).toEqual(MANIFEST_DATA)
    expect(resolveRegistryPaths()).toEqual(activePaths())
  })

  it('reports manifest-unparsable when manifest.json is malformed or fails schema validation', () => {
    writeCompleteOverride()
    writeFileSync(resolve(overrideRoot, 'manifest.json'), '{')
    expect(probeOverrideSnapshot()).toEqual({ file: 'manifest.json', cause: 'manifest-unparsable' })
    expect(readActiveOverrideManifest()).toBeNull()

    writeFileSync(resolve(overrideRoot, 'manifest.json'), JSON.stringify({ ...MANIFEST_DATA, revision: -1 }))
    expect(probeOverrideSnapshot()).toEqual({ file: 'manifest.json', cause: 'manifest-unparsable' })
  })

  it('reports incompatible when the manifest falls outside app compatibility', () => {
    writeCompleteOverride()
    writeManifest({ minAppVersion: '2.1.0' })
    expect(probeOverrideSnapshot()).toEqual({ file: 'manifest.json', cause: 'incompatible' })
    expect(readActiveOverrideManifest()).toBeNull()
  })

  it('reports missing when the manifest is complete but provider-models.json is absent', () => {
    writeCompleteOverride()
    unlinkSync(resolve(overrideRoot, 'provider-models.json'))
    expect(probeOverrideSnapshot()).toEqual({ file: 'provider-models.json', cause: 'missing' })
    expect(readActiveOverrideManifest()).toBeNull()
    expect(resolveRegistryPaths()).toEqual(bundledPaths())
  })

  it('reports unparsable when an override data file contains invalid JSON', () => {
    writeCompleteOverride()
    writeFileSync(resolve(overrideRoot, 'provider-models.json'), '{')
    expect(probeOverrideSnapshot()).toEqual({ file: 'provider-models.json', cause: 'unparsable' })
    expect(readActiveOverrideManifest()).toBeNull()
  })

  it('reports version-mismatch when a file version disagrees with the manifest', () => {
    writeCompleteOverride()
    writeFileSync(resolve(overrideRoot, 'provider-models.json'), JSON.stringify({ version: 'wrong', overrides: [] }))
    expect(probeOverrideSnapshot()).toEqual({ file: 'provider-models.json', cause: 'version-mismatch' })
    expect(readActiveOverrideManifest()).toBeNull()
  })
})
