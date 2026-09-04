import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const services = vi.hoisted(() => ({
  getByProviderId: vi.fn(),
  getByKey: vi.fn(),
  getCherryCloudStatus: vi.fn(),
  edition: 'cn' as 'cn' | 'global'
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    CherryCloudService: { getStatus: services.getCherryCloudStatus }
  } as never)
})
vi.mock('@main/data/services/ProviderService', () => ({
  providerService: { getByProviderId: services.getByProviderId }
}))
vi.mock('@main/data/services/ModelService', () => ({ modelService: { getByKey: services.getByKey } }))
vi.mock('@main/utils/appEdition', () => ({ getAppEdition: () => services.edition }))

const { cherryAccount, defaultModel, defaultProviderApiKey } = await import('../provider')
const signal = new AbortController().signal
const ctx = { signal, share: <T>(_key: string, factory: (signal: AbortSignal) => Promise<T>) => factory(signal) }

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
  services.getCherryCloudStatus.mockResolvedValue({ phase: 'signed-in', displayName: 'Cherry User' })
  services.edition = 'cn'
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

describe('provider-cherry-account', () => {
  it('does not require an account where Cherry Cloud login is unavailable', async () => {
    services.edition = 'global'
    await expect(cherryAccount.run(ctx)).resolves.toEqual({ status: 'pass' })
    expect(services.getCherryCloudStatus).not.toHaveBeenCalled()
  })

  it.each(['signed-in', 'authorizing'] as const)('passes while the Cherry account is %s', async (phase) => {
    services.getCherryCloudStatus.mockResolvedValue({
      phase,
      displayName: phase === 'signed-in' ? 'Cherry User' : null
    })
    await expect(cherryAccount.run(ctx)).resolves.toEqual({ status: 'pass' })
  })

  it('warns and links to sign-in when there is no valid Cherry account session', async () => {
    services.getCherryCloudStatus.mockResolvedValue({ phase: 'signed-out', displayName: null })

    await expect(cherryAccount.run(ctx)).resolves.toMatchObject({
      status: 'warn',
      attribution: 'user-fixable',
      detail: { variant: 'signed_out' },
      actions: [{ kind: 'open_cherry_account' }]
    })
  })
})
