import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getCredentials: vi.fn(), fetch: vi.fn() }))

vi.mock('electron', () => ({ net: { fetch: mocks.fetch } }))
vi.mock('./StellaConnectionService', () => ({
  normalizeStellaEndpoint: (value: string) => new URL(value).toString().replace(/\/$/, ''),
  stellaConnectionService: { getCredentials: mocks.getCredentials }
}))

const { StellaClient } = await import('./StellaClient')

describe('StellaClient', () => {
  afterEach(() => vi.clearAllMocks())

  it('sends the PAT only to the configured origin and refuses redirects', async () => {
    mocks.fetch.mockResolvedValue(new Response(null, { status: 302, headers: { location: 'https://evil.example' } }))
    mocks.getCredentials.mockReturnValue({ endpoint: 'https://stella.example', pat: 'secret' })

    await expect(new StellaClient().listAgents()).rejects.toThrow('redirected')
    expect(mocks.fetch).toHaveBeenCalledWith(
      'https://stella.example/api/agents',
      expect.objectContaining({
        redirect: 'manual',
        headers: expect.objectContaining({ authorization: 'Bearer secret' })
      })
    )
  })
})
