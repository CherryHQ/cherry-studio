import '@data/services/ProviderService'
import { resolve } from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { providerRegistryService } from '@data/services/ProviderRegistryService'

// Each expectation differs from the base catalog entry the Wally id normalizes to, so a Wally row
// that stops matching (dotted ids, dated snapshots) or merges instead of replacing fails here.
describe('ProviderRegistryService Wally model metadata', () => {
  const dbh = setupTestDatabase()

  beforeEach(() => {
    const getPath = vi.mocked(application.getPath).getMockImplementation()
    vi.spyOn(application, 'getPath').mockImplementation((key, filename) =>
      key === 'feature.provider_registry.data' && filename
        ? resolve(process.cwd(), 'packages/provider-registry/data', filename)
        : key === 'app.root'
          ? resolve(process.cwd(), filename ?? '')
          : (getPath?.(key, filename) ?? `/mock/${key}`)
    )
    providerRegistryService.clearCache()
    dbh.db
      .insert(userProviderTable)
      .values({ providerId: 'wally', presetProviderId: 'wally', name: 'Wally', orderKey: 'a0' })
      .run()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    providerRegistryService.clearCache()
  })

  it('bills synced models at Wally prices, including cache reads', () => {
    const [model] = providerRegistryService.resolveModels('wally', ['deepseek-v4.1-flash'])

    expect(model.pricing).toMatchObject({
      input: { perMillionTokens: 0.275 },
      output: { perMillionTokens: 1.2 },
      cacheRead: { perMillionTokens: 0.006 }
    })
    expect(model.inputModalities).toEqual(['text', 'image'])
    expect(model.reasoning?.selectableEfforts).toEqual(['none', 'low', 'medium', 'high', 'max'])
  })

  it.each(['glm-5.3-flash', 'minimax-m3'])('keeps text-only %s from offering image or video input', (modelId) => {
    const [model] = providerRegistryService.resolveModels('wally', [modelId])

    expect(model.inputModalities).toEqual(['text'])
    expect(model.capabilities).not.toContain('image-recognition')
    expect(model.capabilities).not.toContain('video-recognition')
  })

  it('offers no thinking-off effort where Wally rejects it', () => {
    const [model] = providerRegistryService.resolveModels('wally', ['glm-5.3-flash'])

    expect(model.reasoning?.selectableEfforts).not.toContain('none')
    expect(model.reasoning?.defaultEffort).toBe('max')
  })

  it('resolves the dated 1017 snapshot to its own text-only row', () => {
    const [snapshot, current] = providerRegistryService.resolveModels('wally', [
      'deepseek-v4.1-flash-1017',
      'deepseek-v4.1-flash'
    ])

    expect(snapshot).toMatchObject({ name: 'DeepSeek V4.1 Flash 1017', inputModalities: ['text'] })
    expect(snapshot.pricing?.input.perMillionTokens).toBe(0.195)
    expect(current.name).toBe('DeepSeek V4.1 Flash')
  })
})
