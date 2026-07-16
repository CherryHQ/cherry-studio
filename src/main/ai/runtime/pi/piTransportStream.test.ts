import type { ProviderConfig } from '@earendil-works/pi-coding-agent'
import { describe, expect, it, vi } from 'vitest'

import type { ProviderTransportAdapter } from '../../provider/runtimeTransport'
import { type PiAiStreamFns, withTransportStream } from './piTransportStream'

const BASE_CONFIG: ProviderConfig = {
  name: 'Grok CLI',
  baseUrl: 'https://cli-chat-proxy.grok.com/v1',
  apiKey: 'placeholder',
  api: 'openai-responses',
  models: []
}

function makeAdapter(overrides: Partial<ProviderTransportAdapter> = {}): ProviderTransportAdapter {
  return {
    resolveCredentials: vi.fn().mockResolvedValue({ accessToken: 'real-token', accountId: 'acct' }),
    buildHeaders: vi
      .fn()
      .mockReturnValue({ authorization: 'Bearer real-token', 'x-grok-client-identifier': 'cherry-studio' }),
    rewritePayload: vi.fn((json) => ({ ...json, rewritten: true })),
    ...overrides
  }
}

/** A lazyStream stub that runs setup eagerly so the test can await the injected options. */
function makeFns(): { fns: PiAiStreamFns; apiStreamSimple: ReturnType<typeof vi.fn> } {
  const apiStreamSimple = vi.fn().mockReturnValue({ kind: 'stream' })
  const lazyStream = vi.fn((_model: unknown, setup: () => Promise<unknown>) => {
    // Kick off setup (mirrors pi-ai lazyStream running async work behind a sync stream).
    void setup()
    return { kind: 'lazy' } as never
  })
  return { fns: { lazyStream: lazyStream as never, apiStreamSimple: apiStreamSimple as never }, apiStreamSimple }
}

describe('withTransportStream', () => {
  it('adds a streamSimple to the config and preserves the rest', () => {
    const { fns } = makeFns()
    const config = withTransportStream(BASE_CONFIG, makeAdapter(), fns)
    expect(config.streamSimple).toBeTypeOf('function')
    expect(config.name).toBe('Grok CLI')
    expect(config.baseUrl).toBe(BASE_CONFIG.baseUrl)
    // The source config is not mutated.
    expect(BASE_CONFIG.streamSimple).toBeUndefined()
  })

  it('delegates to the api stream with injected apiKey, merged headers, and adapter payload rewrite', async () => {
    const adapter = makeAdapter()
    const { fns, apiStreamSimple } = makeFns()
    const config = withTransportStream(BASE_CONFIG, adapter, fns)

    const model = { id: 'grok-cli/grok-build', api: 'openai-responses' }
    const context = { messages: [] }
    const piOnPayload = vi.fn().mockResolvedValue({ pi: 'touched' })
    config.streamSimple!(model as never, context as never, {
      apiKey: 'placeholder',
      headers: { authorization: 'Bearer placeholder', 'x-pi': 'keep' },
      onPayload: piOnPayload as never
    })

    // lazyStream ran setup: wait a tick for the async delegation to complete.
    await vi.waitFor(() => expect(apiStreamSimple).toHaveBeenCalled())

    const [, , options] = apiStreamSimple.mock.calls[0]
    // Real OAuth token replaces the placeholder key.
    expect(options.apiKey).toBe('real-token')
    // Adapter headers merge over pi's, overriding the placeholder Authorization; other pi headers survive.
    expect(options.headers.authorization).toBe('Bearer real-token')
    expect(options.headers['x-grok-client-identifier']).toBe('cherry-studio')
    expect(options.headers['x-pi']).toBe('keep')
    expect(adapter.buildHeaders).toHaveBeenCalledWith({ accessToken: 'real-token', accountId: 'acct' }, model.id)

    // onPayload composes pi's first, then the adapter rewrite.
    const composed = await options.onPayload({ original: true }, model)
    expect(piOnPayload).toHaveBeenCalledWith({ original: true }, model)
    expect(composed).toEqual({ pi: 'touched', rewritten: true })
  })

  it('applies the adapter rewrite even when pi set no onPayload', async () => {
    const adapter = makeAdapter()
    const { fns, apiStreamSimple } = makeFns()
    const config = withTransportStream(BASE_CONFIG, adapter, fns)

    config.streamSimple!({ id: 'm', api: 'openai-responses' } as never, { messages: [] } as never, {})
    await vi.waitFor(() => expect(apiStreamSimple).toHaveBeenCalled())

    const [, , options] = apiStreamSimple.mock.calls[0]
    const out = await options.onPayload({ original: true }, { id: 'm' })
    expect(out).toEqual({ original: true, rewritten: true })
  })
})
