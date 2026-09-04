import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const services = vi.hoisted(() => ({
  getByProviderId: vi.fn(),
  getByKey: vi.fn()
}))

vi.mock('@main/data/services/ProviderService', () => ({
  providerService: { getByProviderId: services.getByProviderId }
}))
vi.mock('@main/data/services/ModelService', () => ({ modelService: { getByKey: services.getByKey } }))

const { defaultModel, defaultProviderApiKey } = await import('../provider')
const ctx = { signal: new AbortController().signal }

function provider(overrides: Record<string, unknown> = {}) {
  return {
    id: 'openai',
    isEnabled: true,
    authMethods: ['api-key'],
    authOptional: false,
    apiKeys: [{ id: 'key-1', isEnabled: true }],
    ...overrides
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  MockMainPreferenceServiceUtils.resetMocks()
  MockMainPreferenceServiceUtils.setPreferenceValue('chat.default_model_id', 'openai::gpt-4o')
  services.getByProviderId.mockReturnValue(provider())
  services.getByKey.mockReturnValue({ id: 'openai::gpt-4o' })
})

describe('provider-default-model', () => {
  it('fails when no default model is configured', async () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('chat.default_model_id', null)
    await expect(defaultModel.run(ctx)).resolves.toMatchObject({
      status: 'fail',
      detail: { variant: 'not_configured' },
      actions: [{ kind: 'navigate', target: '/settings/provider' }]
    })
  })

  it('rejects malformed ids before looking up provider data', async () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('chat.default_model_id', 'not-a-unique-model-id')
    await expect(defaultModel.run(ctx)).resolves.toMatchObject({ status: 'fail', detail: { variant: 'invalid_id' } })
    expect(services.getByProviderId).not.toHaveBeenCalled()
  })

  it('fails when the provider is unavailable in this edition', async () => {
    services.getByProviderId.mockImplementation(() => {
      throw new Error('not found')
    })
    await expect(defaultModel.run(ctx)).resolves.toMatchObject({
      status: 'fail',
      detail: { variant: 'provider_unavailable' }
    })
  })

  it('fails before model lookup when the provider is disabled', async () => {
    services.getByProviderId.mockReturnValue(provider({ isEnabled: false }))
    await expect(defaultModel.run(ctx)).resolves.toMatchObject({
      status: 'fail',
      detail: { variant: 'provider_disabled' }
    })
    expect(services.getByKey).not.toHaveBeenCalled()
  })

  it('fails when the configured model no longer exists', async () => {
    services.getByKey.mockImplementation(() => {
      throw new Error('not found')
    })
    await expect(defaultModel.run(ctx)).resolves.toMatchObject({
      status: 'fail',
      detail: { variant: 'model_unavailable' }
    })
  })

  it('passes when the enabled provider and model both exist', async () => {
    await expect(defaultModel.run(ctx)).resolves.toEqual({ status: 'pass' })
  })
})

describe('provider-api-key-present', () => {
  it('passes for login-based providers', async () => {
    services.getByProviderId.mockReturnValue(provider({ authMethods: ['oauth'], apiKeys: [] }))
    await expect(defaultProviderApiKey.run(ctx)).resolves.toEqual({ status: 'pass' })
  })

  it('passes for providers whose authentication is optional', async () => {
    services.getByProviderId.mockReturnValue(provider({ authOptional: true, apiKeys: [] }))
    await expect(defaultProviderApiKey.run(ctx)).resolves.toEqual({ status: 'pass' })
  })

  it('passes when at least one API key is enabled', async () => {
    services.getByProviderId.mockReturnValue(
      provider({
        apiKeys: [
          { id: 'disabled', isEnabled: false },
          { id: 'enabled', isEnabled: true }
        ]
      })
    )
    await expect(defaultProviderApiKey.run(ctx)).resolves.toEqual({ status: 'pass' })
  })

  it('fails without exposing key material when all configured keys are disabled', async () => {
    services.getByProviderId.mockReturnValue(
      provider({ apiKeys: [{ id: 'disabled', key: 'sk-sensitive-value', isEnabled: false }] })
    )
    const result = await defaultProviderApiKey.run(ctx)
    expect(result).toMatchObject({
      status: 'fail',
      attribution: 'user-fixable',
      detail: { variant: 'missing' },
      actions: [{ kind: 'navigate', target: '/settings/provider' }]
    })
    expect(JSON.stringify(result)).not.toContain('sk-sensitive-value')
  })
})
