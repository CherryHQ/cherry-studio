import { describe, expect, it, vi } from 'vitest'

import { hasImageTransport, resolveImageTransport, type NativeImageTransportSettings } from '../imageTransportRegistry'

describe('image transport resolution', () => {
  it.each(['__proto__', 'constructor', 'toString'])(
    'leaves unregistered provider %s without a transport',
    (providerId) => {
      expect(hasImageTransport(providerId, 'model')).toBe(false)
      expect(resolveImageTransport({ providerId, providerSettings: {} }, 'model')).toBeNull()
    }
  )

  it('keeps final settings and fetch updates until the native transport is first used', async () => {
    const initialFetch = vi.fn<typeof fetch>()
    const finalFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ data: [{ url: 'https://image.example/result.png' }] })))
    const settings: NativeImageTransportSettings = {
      apiKey: 'selected-key',
      baseURL: 'https://image-proxy.example/v1',
      headers: { 'X-Image-Route': 'custom' },
      fetch: initialFetch
    }
    const transport = resolveImageTransport({ providerId: 'tokenhub', providerSettings: settings }, 'hy-image-v3')
    if (!transport) throw new Error('TokenHub transport is missing')
    settings.fetch = finalFetch

    expect(
      await transport.submit({
        modelId: 'hy-image-v3',
        modelDescriptor: { id: 'hy-image-v3', endpoint: '/v1/wand/hunyuan-image/v3-generation', isSync: true },
        prompt: 'a red circle',
        n: 1,
        size: undefined,
        seed: undefined,
        files: undefined,
        mask: undefined,
        providerParams: {}
      })
    ).toEqual({ imageUrls: ['https://image.example/result.png'] })
    expect(initialFetch).not.toHaveBeenCalled()
    const [url, request] = finalFetch.mock.calls[0]
    expect(String(url)).toBe('https://image-proxy.example/v1/wand/hunyuan-image/v3-generation')
    expect(new Headers(request?.headers).get('Authorization')).toBe('Bearer selected-key')
    expect(new Headers(request?.headers).get('X-Image-Route')).toBe('custom')
  })
})
