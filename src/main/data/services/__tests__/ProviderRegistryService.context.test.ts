import { resolve } from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { providerRegistryService } from '@data/services/ProviderRegistryService'
import { providerService } from '@data/services/ProviderService'

describe('ProviderRegistryService explicit provider context', () => {
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
  })

  afterEach(() => {
    vi.restoreAllMocks()
    providerRegistryService.clearCache()
  })

  it('uses the supplied provider identity even when persisted identity differs and global DB is unavailable', () => {
    dbh.db
      .insert(userProviderTable)
      .values({
        providerId: 'relay',
        presetProviderId: 'openai',
        name: 'Relay',
        orderKey: 'a0'
      })
      .run()
    vi.spyOn(application.get('DbService'), 'getDb').mockImplementation(() => {
      throw new Error('Database is not initialized')
    })

    const result = providerRegistryService.resolveModel(
      { id: 'relay', presetProviderId: 'groq', defaultChatEndpoint: 'openai-chat-completions' },
      'gpt-oss-120b'
    )

    expect(result.reasoningProfile.support?.controls).toEqual([{ kind: 'effort', values: ['low', 'medium', 'high'] }])
    expect(result.serviceTierControl).toMatchObject({
      default: 'standard',
      options: ['standard', 'auto', 'fast', 'flex']
    })
  })

  it('keeps an explicitly custom provider free of preset overrides without querying the database', () => {
    vi.spyOn(application.get('DbService'), 'getDb').mockImplementation(() => {
      throw new Error('Database is not initialized')
    })

    const result = providerRegistryService.resolveModel(
      { id: 'groq', presetProviderId: null, defaultChatEndpoint: 'openai-chat-completions' },
      'gpt-oss-120b'
    )

    expect(result.presetModel).not.toBeNull()
    expect(result.registryOverride).toBeNull()
    expect(result.serviceTierControl).toBeUndefined()
  })

  it('resolves caller-owned provider changes inside a transaction without falling back to global DB', () => {
    vi.spyOn(application.get('DbService'), 'getDb').mockImplementation(() => {
      throw new Error('Database is not initialized')
    })

    const result = dbh.db.transaction((tx) => {
      tx.insert(userProviderTable)
        .values({
          providerId: 'startup-groq',
          presetProviderId: 'groq',
          name: 'Startup Groq',
          orderKey: 'a0'
        })
        .run()
      const contexts = providerService.getReasoningContextsByProviderIdsTx(tx, ['startup-groq', 'missing'])
      expect(contexts.has('missing')).toBe(false)
      const context = contexts.get('startup-groq')
      if (!context) throw new Error('Provider context was not loaded from the transaction')
      return providerRegistryService.resolveModel(context, 'gpt-oss-120b')
    })

    expect(result.serviceTierControl).toMatchObject({
      default: 'standard',
      options: ['standard', 'auto', 'fast', 'flex']
    })
  })
})
