import { afterEach, describe, expect, it, vi } from 'vitest'

import { resolveVideoTransport } from '../videoTransportRegistry'

describe('resolveVideoTransport', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('uses the global undici fetch, never a caller-injected fetch in settings', async () => {
    // The transports ignore any caller-injected fetch and use the global undici
    // `fetch` directly. This keeps them off Electron net.fetch, which can throw
    // uncaught ByteString errors on non-ASCII response headers.
    const globalFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'vid-1' })))
    vi.stubGlobal('fetch', globalFetch)
    const unsafeFetch = vi.fn()

    const transport = resolveVideoTransport('aihubmix', 'doubao-seedance-2-0-260128', {
      baseURL: 'https://aihubmix.com/v1',
      apiKey: 'sk-aih',
      fetch: unsafeFetch
    })
    expect(transport).not.toBeNull()

    await transport!.submit({ modelId: 'doubao-seedance-2-0-260128', prompt: 'p', providerParams: {} })

    expect(globalFetch).toHaveBeenCalledTimes(1)
    expect(unsafeFetch).not.toHaveBeenCalled()
  })

  it('returns null for a provider with no video transport', () => {
    expect(resolveVideoTransport('openai', 'gpt-4o', { fetch: vi.fn() })).toBeNull()
  })
})
