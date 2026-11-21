import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { MockMainDbServiceUtils } from '@test-mocks/main/DbService'
import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { REASONING_FORMAT_PROFILES } from '@cherrystudio/provider-registry'
import {
  readModelRegistry,
  readProviderModelRegistry,
  readProviderRegistry,
  REGISTRY_SCHEMA_VERSION,
  RegistryLoader
} from '@cherrystudio/provider-registry/node'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { modelService } from '@data/services/ModelService'
import { providerRegistryService } from '@data/services/ProviderRegistryService'
import { providerService } from '@data/services/ProviderService'
import { generateOrderKeyBetween } from '@data/services/utils/orderKey'
import { createUniqueModelId } from '@shared/data/types/model'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

const endpoint = 'anthropic-messages' as const
const providerId = 'recovery-provider'
const rawModelId = 'deployment/raw-api-model'
const storedReasoning = {
  controls: [{ kind: 'toggle' as const }],
  selectableEfforts: ['none' as const, 'high' as const],
  thinkingTokenLimits: { min: 1024, max: 8192 }
}
const providerWire = {
  off: { operations: [{ target: 'thinking.type', value: { source: 'literal', value: 'disabled' } }] }
}
const tierControl = {
  default: 'auto',
  options: ['standard', 'auto', 'fast'],
  wire: {
    delivery: { type: 'request-body', key: 'service_tier' },
    values: { standard: 'default', auto: 'auto', fast: 'priority' }
  }
}
const fixtures = {
  'providers.json': {
    version: '1.0.0',
    providers: [
      {
        id: providerId,
        name: 'Recovery provider',
        metadata: { website: {} },
        defaultChatEndpoint: endpoint,
        endpointConfigs: {
          [endpoint]: {
            baseUrl: 'https://catalog.invalid',
            reasoningFormat: { type: 'anthropic', wire: providerWire },
            requestControls: { serviceTier: tierControl }
          }
        }
      }
    ]
  },
  'models.json': { version: '1.0.0', models: [{ id: 'catalog-model', name: 'Catalog model' }] },
  'provider-models.json': {
    version: '1.0.0',
    overrides: [
      {
        providerId,
        modelId: 'catalog-model',
        apiModelId: rawModelId,
        requestControls: { serviceTier: { options: ['standard', 'fast'] } }
      }
    ]
  }
}
type ResourceFile = keyof typeof fixtures
const resourceFiles = Object.keys(fixtures) as ResourceFile[]

describe('ProviderRegistryService resource recovery', () => {
  const dbh = setupTestDatabase()
  let directory: string

  function writeFixture(file: ResourceFile) {
    writeFileSync(join(directory, 'provider-registry', file), JSON.stringify(fixtures[file]))
  }

  function removeResource(file: ResourceFile) {
    rmSync(join(directory, 'provider-registry', file))
    providerRegistryService.clearCache()
  }

  function materialize(modelId = rawModelId) {
    return {
      provider: providerService.getByProviderId(providerId),
      model: modelService.getByKey(providerId, modelId)
    }
  }

  function rows() {
    return {
      providers: dbh.db.select().from(userProviderTable).all(),
      models: dbh.db.select().from(userModelTable).all()
    }
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    MockMainDbServiceUtils.setDb(dbh.db)
    directory = mkdtempSync(join(tmpdir(), 'provider-registry-recovery-'))
    mkdirSync(join(directory, 'provider-registry'))
    vi.mocked(application.getPath).mockImplementation((key, filename) =>
      join(
        directory,
        key === 'feature.provider_registry.override' ? 'provider-registry-override' : 'provider-registry',
        filename ?? ''
      )
    )
    resourceFiles.forEach(writeFixture)
    expect(readProviderRegistry(join(directory, 'provider-registry', 'providers.json')).providers).toHaveLength(1)
    expect(readModelRegistry(join(directory, 'provider-registry', 'models.json')).models).toHaveLength(1)
    expect(
      readProviderModelRegistry(join(directory, 'provider-registry', 'provider-models.json')).overrides
    ).toHaveLength(1)
    providerRegistryService.clearCache()
    dbh.db
      .insert(userProviderTable)
      .values({
        providerId,
        presetProviderId: providerId,
        name: 'Persisted provider',
        defaultChatEndpoint: endpoint,
        endpointConfigs: { [endpoint]: { adapterFamily: 'anthropic', baseUrl: 'https://configured.invalid/v1' } },
        orderKey: generateOrderKeyBetween(null, null)
      })
      .run()
    dbh.db
      .insert(userModelTable)
      .values({
        id: createUniqueModelId(providerId, rawModelId),
        providerId,
        modelId: rawModelId,
        presetModelId: null,
        name: 'Persisted model',
        capabilities: ['reasoning'],
        supportsStreaming: true,
        endpointTypes: [endpoint],
        reasoning: storedReasoning,
        contextWindow: 64000,
        maxInputTokens: 60000,
        maxOutputTokens: 9000,
        orderKey: generateOrderKeyBetween(null, null)
      })
      .run()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.clearAllTimers()
    vi.useRealTimers()
    providerRegistryService.clearCache()
    rmSync(directory, { recursive: true, force: true })
  })

  // Catches late enrichment aborting preparation after usable rows were materialized.
  it.each(resourceFiles)('prepares persisted configuration with missing %s', (file) => {
    removeResource(file)
    const before = rows()
    const { provider, model } = materialize()
    const profile = providerRegistryService.resolveReasoningProfile(provider, model)
    const tier = providerRegistryService.resolveServiceTierControl(provider, model)

    expect(provider.id).toBe(providerId)
    expect(provider.endpointConfigs?.[endpoint]?.baseUrl).toBe('https://configured.invalid/v1')
    expect(provider.defaultChatEndpoint).toBe(endpoint)
    expect(model.apiModelId).toBe(rawModelId)
    expect(model.presetModelId).toBeNull()
    expect(model.reasoning).toEqual(storedReasoning)
    expect(model).toMatchObject({ contextWindow: 64000, maxInputTokens: 60000, maxOutputTokens: 9000 })
    expect(profile.format).toBe('anthropic')
    expect(profile.support?.controls).toEqual(storedReasoning.controls)
    expect(profile.support?.thinkingTokenLimits).toEqual(storedReasoning.thinkingTokenLimits)
    expect(profile.wire).toEqual(file === 'providers.json' ? REASONING_FORMAT_PROFILES.anthropic.wire : providerWire)
    expect(tier).toEqual(
      file === 'providers.json'
        ? undefined
        : {
            ...tierControl,
            options: file === 'provider-models.json' ? tierControl.options : ['standard', 'fast']
          }
    )
    expect(rows()).toEqual(before)
  })

  it.each(resourceFiles)('keeps authoritative resolution strict with missing %s and logs no fallback', (file) => {
    removeResource(file)
    expect(() => providerRegistryService.resolveModel({ id: providerId }, rawModelId)).toThrow(
      `Failed to load registry file: ${join(directory, 'provider-registry', file)}`
    )
    expect(mockMainLoggerService.warn).not.toHaveBeenCalled()
  })

  it.each(['malformed JSON', 'invalid envelope'])('recovers from %s with real loader validation', (failure) => {
    writeFileSync(join(directory, 'provider-registry', 'models.json'), failure === 'malformed JSON' ? '{' : '{}')
    const { provider, model } = materialize()
    const profile = providerRegistryService.resolveReasoningProfile(provider, model)
    expect(profile.wire).toEqual(providerWire)
    expect(profile.support?.controls).toEqual(storedReasoning.controls)
    expect(mockMainLoggerService.warn).toHaveBeenCalledTimes(1)
  })

  it('warns once per path across models, expiry and clearCache, then rereads a repaired resource', () => {
    const first = rows().models[0]
    dbh.db
      .insert(userModelTable)
      .values({
        ...first,
        id: createUniqueModelId(providerId, 'second-model'),
        modelId: 'second-model',
        orderKey: generateOrderKeyBetween(first.orderKey, null)
      })
      .run()
    removeResource('providers.json')
    const before = rows()
    for (const modelId of [rawModelId, 'second-model']) {
      const { provider, model } = materialize(modelId)
      providerRegistryService.resolveReasoningProfile(provider, model)
      providerRegistryService.resolveServiceTierControl(provider, model)
    }
    vi.advanceTimersByTime(30001)
    const { provider, model } = materialize()
    providerRegistryService.resolveReasoningProfile(provider, model)
    providerRegistryService.clearCache()
    providerRegistryService.resolveReasoningProfile(provider, model)
    expect(mockMainLoggerService.warn).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(mockMainLoggerService.warn.mock.calls)).toContain(
      join(directory, 'provider-registry', 'providers.json')
    )
    expect(JSON.stringify(mockMainLoggerService.warn.mock.calls)).toContain('ENOENT')
    expect(JSON.stringify(mockMainLoggerService.warn.mock.calls)).toContain('feature.provider_registry.data')
    writeFixture('providers.json')
    expect(providerRegistryService.resolveReasoningProfile(provider, model).wire).toEqual(providerWire)
    removeResource('provider-models.json')
    expect(providerRegistryService.resolveServiceTierControl(provider, model)).toEqual(tierControl)
    expect(mockMainLoggerService.warn).toHaveBeenCalledTimes(2)
    expect(rows()).toEqual(before)
  })

  it('reports the retained override path even when snapshot selection would now fall back to the bundle', () => {
    const overrideDir = join(directory, 'provider-registry-override')
    mkdirSync(overrideDir)
    for (const file of ['models.json', 'provider-models.json'] as const) {
      writeFileSync(join(overrideDir, file), JSON.stringify(fixtures[file]))
    }
    writeFileSync(
      join(overrideDir, 'manifest.json'),
      JSON.stringify({
        schemaVersion: REGISTRY_SCHEMA_VERSION,
        minAppVersion: '1.0.0',
        sourceAppVersion: '1.0.0',
        revision: 1,
        files: { 'models.json': '1.0.0', 'provider-models.json': '1.0.0' }
      })
    )
    expect(providerRegistryService.getCatalogVersion('providers.json')).toBe('1.0.0')
    const path = join(overrideDir, 'models.json')
    rmSync(path)
    const { provider, model } = materialize()
    expect(providerRegistryService.resolveReasoningProfile(provider, model).wire).toEqual(providerWire)
    expect(providerRegistryService.getCatalogVersion('models.json')).toBeNull()
    expect(mockMainLoggerService.warn).toHaveBeenCalledTimes(1)
    expect(mockMainLoggerService.warn.mock.calls[0][1]).toMatchObject({
      file: 'models.json',
      path,
      namespace: 'feature.provider_registry.override',
      cause: 'ENOENT',
      repair: 'Restore the validated model snapshot for this override'
    })
  })

  it('propagates programming failures during pure profile computation unchanged', () => {
    const { provider, model } = materialize()
    const sentinel = new TypeError('profile computation failed')
    Object.defineProperty(provider, 'endpointConfigs', {
      get: () => {
        throw sentinel
      }
    })
    try {
      providerRegistryService.resolveReasoningProfile(provider, model)
      expect.unreachable('Expected the profile computation failure')
    } catch (error) {
      expect(error).toBe(sentinel)
    }
    expect(mockMainLoggerService.warn).not.toHaveBeenCalled()
  })

  it.each(['unwrapped', 'TypeError', 'DB error', 'unrelated fs error', 'wrong wrapper path'])(
    'does not recover from %s at a resource read',
    (failure) => {
      const { provider, model } = materialize()
      const path = join(directory, 'provider-registry', 'models.json')
      const cause =
        failure === 'TypeError'
          ? new TypeError('index failure')
          : Object.assign(new Error('failure'), {
              code: failure === 'DB error' ? 'SQLITE_ERROR' : 'ENOENT',
              path: failure === 'unrelated fs error' ? join(directory, 'unrelated') : path,
              syscall: 'open'
            })
      const error =
        failure === 'unwrapped'
          ? cause
          : new Error(`Failed to load registry file: ${failure === 'wrong wrapper path' ? 'other-path' : path}`, {
              cause
            })
      vi.spyOn(RegistryLoader.prototype, 'findModel').mockImplementation(() => {
        throw error
      })
      try {
        providerRegistryService.resolveReasoningProfile(provider, model)
        expect.unreachable('Expected the non-resource failure')
      } catch (caught) {
        expect(caught).toBe(error)
      }
      expect(mockMainLoggerService.warn).not.toHaveBeenCalled()
    }
  )
})
