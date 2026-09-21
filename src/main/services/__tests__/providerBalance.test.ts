import '@data/services/ProviderRegistryService'

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { application } from '@application'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { providerService } from '@data/services/ProviderService'
import { CreateProviderSchema, UpdateProviderSchema } from '@shared/data/api/schemas/providers'
import type { ProviderBalanceConfig } from '@shared/data/types/providerBalance'
import { ProviderBalanceErrorCode as Code } from '@shared/ipc/errors/providerBalance'
import { setupTestDatabase } from '@test-helpers/db'
import { net } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BALANCE_PROVIDER_IDS, queryProviderBalance } from '../providerBalance'

const config: ProviderBalanceConfig = {
  enabled: true,
  endpoint: 'https://relay.example/balance',
  amountPath: 'data.balance',
  currency: 'CNY',
  rechargeUrl: 'https://relay.example/billing'
}

describe('provider balance queries', () => {
  const dbh = setupTestDatabase()

  beforeEach(() => {
    vi.mocked(application.getPath).mockImplementation((key, filename) =>
      key === 'feature.provider_registry.data'
        ? resolve('packages/provider-registry/data', filename ?? '')
        : `/mock/${key}/${filename ?? ''}`
    )
    vi.mocked(net.fetch).mockReset()
    dbh.db
      .insert(userProviderTable)
      .values({
        providerId: 'relay',
        name: 'Relay',
        orderKey: 'a0',
        apiKeys: [
          { id: 'first', key: 'first-secret', isEnabled: true },
          { id: 'second', key: 'second-secret', isEnabled: true },
          { id: 'disabled', key: 'disabled-secret', isEnabled: false }
        ],
        providerSettings: { balanceQuery: config, timeout: 30 }
      })
      .run()
  })

  it('persists the form through Provider DTOs and queries the selected key with custom auth', async () => {
    const patch = UpdateProviderSchema.parse({
      providerSettings: { balanceQuery: { ...config, currency: 'USD' } },
      authConfig: { type: 'api-key', headerName: 'X-API-Key', prefix: '' }
    })
    providerService.update('relay', patch)
    expect(providerService.getByProviderId('relay').settings).toMatchObject({
      timeout: 30,
      balanceQuery: { ...config, currency: 'USD' }
    })
    vi.mocked(net.fetch).mockResolvedValue(Response.json({ data: { balance: '-1.25' } }))
    const result = await queryProviderBalance('relay', 'second')
    expect(result).toMatchObject({
      kind: 'account-balance',
      balances: [{ currency: 'USD', amount: -1.25 }],
      rechargeUrl: config.rechargeUrl
    })
    expect(net.fetch).toHaveBeenCalledWith(
      config.endpoint,
      expect.objectContaining({ method: 'GET', redirect: 'error', credentials: 'omit' })
    )
    const request = vi.mocked(net.fetch).mock.calls[0][1]!
    expect(new Headers(request.headers).get('X-API-Key')).toBe('second-secret')
    expect(new Headers(request.headers).has('Authorization')).toBe(false)
  })

  it('tests an unsaved configuration without replacing saved configuration', async () => {
    vi.mocked(net.fetch).mockResolvedValue(Response.json({ credits: 0 }))
    const result = await queryProviderBalance('relay', 'first', {
      ...config,
      amountPath: 'credits',
      endpoint: 'http://127.0.0.1:1234/balance'
    })
    expect(result.balances).toEqual([{ currency: 'CNY', amount: 0 }])
    expect(providerService.getByProviderId('relay').settings.balanceQuery).toEqual(config)
  })

  it.each([null, '', ' ', true, 'not-a-number', {}, undefined])(
    'rejects invalid amounts instead of reporting zero: %j',
    async (balance) => {
      vi.mocked(net.fetch).mockResolvedValue(Response.json({ data: { balance } }))
      await expect(queryProviderBalance('relay', 'first')).rejects.toMatchObject({ code: Code.RESPONSE })
    }
  )

  it.each([
    [401, Code.AUTH],
    [429, Code.RATE_LIMIT],
    [404, Code.UNSUPPORTED],
    [503, Code.NETWORK]
  ])('reports HTTP %s without exposing response content', async (status, code) => {
    vi.mocked(net.fetch).mockResolvedValue(new Response('second-secret private response', { status: Number(status) }))
    await expect(queryProviderBalance('relay', 'second')).rejects.toMatchObject({ code, message: code })
  })

  it('does not send a disabled key or query a disabled configuration', async () => {
    await expect(queryProviderBalance('relay', 'disabled')).rejects.toMatchObject({ code: Code.AUTH })
    providerService.update('relay', { providerSettings: { balanceQuery: { ...config, enabled: false } } })
    await expect(queryProviderBalance('relay', 'first')).rejects.toMatchObject({ code: Code.CONFIG })
    expect(net.fetch).not.toHaveBeenCalled()
  })

  it('redacts network errors that include credentials', async () => {
    vi.mocked(net.fetch).mockRejectedValue(new Error('Authorization: Bearer first-secret'))
    await expect(queryProviderBalance('relay', 'first')).rejects.toMatchObject({
      code: Code.NETWORK,
      message: Code.NETWORK
    })
  })

  it.each([
    [
      'deepseek',
      {
        balance_infos: [
          { currency: 'CNY', total_balance: '10.25' },
          { currency: 'USD', total_balance: '-0.1' }
        ]
      },
      'user/balance',
      [
        { currency: 'CNY', amount: 10.25 },
        { currency: 'USD', amount: -0.1 }
      ]
    ],
    ['moonshot', { data: { available_balance: 0 } }, 'v1/users/me/balance', [{ currency: 'CNY', amount: 0 }]]
  ] as const)(
    'queries %s preset copies using the configured host and native schema',
    async (preset, body, path, balances) => {
      providerService.create(
        CreateProviderSchema.parse({
          providerId: `${preset}-copy`,
          presetProviderId: preset,
          name: preset,
          endpointConfigs: { 'openai-chat-completions': { baseUrl: 'https://proxy.example/prefix/v1' } },
          apiKeys: [{ id: 'key', key: 'secret', isEnabled: true }]
        })
      )
      expect(providerService.getByProviderId(`${preset}-copy`).supportsBalance).toBe(true)
      vi.mocked(net.fetch).mockResolvedValue(Response.json(body))
      const result = await queryProviderBalance(`${preset}-copy`, 'key')
      expect(result.balances).toEqual(balances)
      expect(net.fetch).toHaveBeenCalledWith(`https://proxy.example/prefix/${path}`, expect.anything())
    }
  )

  it.each([
    [
      'ppio',
      { availableBalance: '1000000', cashBalance: '800000', creditLimit: '200000' },
      100,
      'CNY',
      'https://api.ppio.com/openapi/v1/billing/balance/detail'
    ],
    ['ppio', { availableBalance: '0' }, 0, 'CNY', 'https://api.ppio.com/openapi/v1/billing/balance/detail'],
    ['ppio', { availableBalance: '-12345' }, -1.2345, 'CNY', 'https://api.ppio.com/openapi/v1/billing/balance/detail'],
    ['gateway', { balance: '95.50', total_used: '4.50' }, 95.5, 'USD', 'https://ai-gateway.vercel.sh/v1/credits'],
    ['gateway', { balance: '0', total_used: '100' }, 0, 'USD', 'https://ai-gateway.vercel.sh/v1/credits']
  ] as const)(
    'queries %s account balance without confusing units or spending',
    async (preset, body, amount, currency, endpoint) => {
      providerService.create(
        CreateProviderSchema.parse({
          providerId: `${preset}-copy`,
          presetProviderId: preset,
          name: preset,
          apiKeys: [{ id: 'key', key: 'secret', isEnabled: true }]
        })
      )
      vi.mocked(net.fetch).mockResolvedValue(Response.json(body))
      const result = await queryProviderBalance(`${preset}-copy`, 'key')
      expect(result.balances).toEqual([{ currency, amount }])
      expect(net.fetch).toHaveBeenCalledWith(endpoint, expect.objectContaining({ method: 'GET' }))
      expect(new Headers(vi.mocked(net.fetch).mock.calls[0][1]!.headers).get('Authorization')).toBe('Bearer secret')
    }
  )

  it('preserves the Gateway proxy prefix without appending credits to the inference path', async () => {
    providerService.create(
      CreateProviderSchema.parse({
        providerId: 'gateway-copy',
        presetProviderId: 'gateway',
        name: 'Gateway proxy',
        endpointConfigs: { 'openai-chat-completions': { baseUrl: 'https://proxy.example/prefix/v1/ai/' } },
        apiKeys: [{ id: 'key', key: 'secret', isEnabled: true }]
      })
    )
    vi.mocked(net.fetch).mockResolvedValue(Response.json({ balance: '10.50' }))
    expect((await queryProviderBalance('gateway-copy', 'key')).balances).toEqual([{ currency: 'USD', amount: 10.5 }])
    expect(net.fetch).toHaveBeenCalledWith('https://proxy.example/prefix/v1/credits', expect.anything())
  })

  it.each(['ppio', 'gateway'])('rejects malformed %s balance responses instead of showing zero', async (preset) => {
    providerService.create(
      CreateProviderSchema.parse({
        providerId: `${preset}-copy`,
        presetProviderId: preset,
        name: preset,
        apiKeys: [{ id: 'key', key: 'secret', isEnabled: true }]
      })
    )
    for (const amount of [null, '', 'NaN', true, undefined]) {
      vi.mocked(net.fetch).mockResolvedValue(Response.json({ balance: amount, availableBalance: amount }))
      await expect(queryProviderBalance(`${preset}-copy`, 'key')).rejects.toMatchObject({ code: Code.RESPONSE })
    }
  })

  it('does not advertise or call the retired SiliconFlow balance endpoint', async () => {
    providerService.create(
      CreateProviderSchema.parse({
        providerId: 'silicon-copy',
        presetProviderId: 'silicon',
        name: 'SiliconFlow',
        apiKeys: [{ id: 'key', key: 'secret', isEnabled: true }]
      })
    )
    expect(providerService.getByProviderId('silicon-copy').supportsBalance).not.toBe(true)
    await expect(queryProviderBalance('silicon-copy', 'key')).rejects.toMatchObject({ code: Code.UNSUPPORTED })
    expect(net.fetch).not.toHaveBeenCalled()
  })

  it('provides a main implementation for every advertised balance capability', () => {
    const registry = JSON.parse(readFileSync(resolve('packages/provider-registry/data/providers.json'), 'utf8')) as {
      providers: Array<{ id: string; supportsBalance?: boolean }>
    }
    expect(
      registry.providers
        .filter((provider) => provider.supportsBalance)
        .map((provider) => provider.id)
        .sort()
    ).toEqual([...BALANCE_PROVIDER_IDS].sort())
  })
})
