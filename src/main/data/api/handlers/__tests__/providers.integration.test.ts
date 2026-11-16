// Load the sibling so it self-registers in the data-service registry (prod loads it via its DataApi handler).
import '@data/services/ProviderRegistryService'
import { setupTestDatabase } from '@test-helpers/db'
import { MockApplicationUtils } from '@test-mocks/main/application'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PresetProviderSeeder } from '@data/db/seeding/seeders/presetProviderSeeder'

import { providerHandlers } from '../providers'

const trackProductEvent = vi.fn()

vi.mock('@cherrystudio/provider-registry/node', () => {
  class RegistryLoader {
    loadProviders() {
      return [{ id: 'openai', name: 'OpenAI', endpointConfigs: {}, defaultChatEndpoint: null }]
    }
    getProvidersVersion() {
      return 'test-version'
    }
    loadModels() {
      return []
    }
    loadProviderModels() {
      return []
    }
    findModel() {
      return null
    }
    findOverride() {
      return null
    }
  }
  return { RegistryLoader }
})

describe('PATCH /providers/:providerId usage analytics', () => {
  const dbh = setupTestDatabase()
  beforeEach(() => {
    trackProductEvent.mockReset()
    MockApplicationUtils.setService('AnalyticsService', { trackProductEvent })
  })
  afterEach(() => MockApplicationUtils.resetServices())

  const patch = (providerId: string, body: object) =>
    providerHandlers['/providers/:providerId'].PATCH({ params: { providerId }, body })
  const reported = () => trackProductEvent.mock.calls.map(([event]) => event)

  it('does not report seeded presets, only the user switching one on', async () => {
    new PresetProviderSeeder().run(dbh.db)
    expect(trackProductEvent).not.toHaveBeenCalled()

    await patch('openai', { name: 'Work account' })
    await patch('openai', { isEnabled: true })
    await patch('openai', { isEnabled: true })

    expect(reported()).toEqual([
      { event: 'feature_used', feature: 'provider', action: 'provider_configured', target: 'openai' }
    ])
  })

  it('reports a custom provider without its user-chosen id', async () => {
    await providerHandlers['/providers'].POST({
      body: { providerId: 'my-private-relay', presetProviderId: 'openai', name: 'Private relay' }
    })
    await patch('my-private-relay', { isEnabled: true })

    expect(reported()).toEqual([{ event: 'feature_used', feature: 'provider', action: 'provider_configured' }])
  })
})
