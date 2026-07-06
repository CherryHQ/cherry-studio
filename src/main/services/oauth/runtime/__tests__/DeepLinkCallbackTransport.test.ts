import { beforeEach, describe, expect, it, vi } from 'vitest'

const ipcApiServiceMock = vi.hoisted(() => ({
  send: vi.fn()
}))

vi.mock('@application', () => ({
  application: {
    get: (name: string) => {
      if (name === 'IpcApiService') return ipcApiServiceMock
      throw new Error(`unexpected service: ${name}`)
    }
  }
}))

import { DeepLinkCallbackTransport } from '../DeepLinkCallbackTransport'

const REDIRECT_URI = 'cherrystudio://oauth/callback'
const FLOW_TTL_MS = 10 * 60 * 1000

function registerFlow(transport: DeepLinkCallbackTransport, state = 'state') {
  transport.registerAuthorizationRequest('https://open.cherryin.ai/oauth2/auth', state, 'verifier', 'settings-window')
}

describe('DeepLinkCallbackTransport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
  })

  it('consumes a valid callback for the registered state', () => {
    const transport = new DeepLinkCallbackTransport({ redirectUri: REDIRECT_URI })
    registerFlow(transport)

    expect(transport.consumeCallback(new URL(`${REDIRECT_URI}?state=state&code=code`))).toEqual({
      state: 'state',
      code: 'code',
      codeVerifier: 'verifier',
      initiatorWindowId: 'settings-window',
      context: {}
    })
  })

  it('ignores and removes callbacks whose state has expired', () => {
    const transport = new DeepLinkCallbackTransport({ redirectUri: REDIRECT_URI })
    registerFlow(transport)
    vi.setSystemTime(Date.now() + FLOW_TTL_MS + 1)

    const callbackUrl = new URL(`${REDIRECT_URI}?state=state&code=code`)

    // Returns null (not throw) so the dispatcher treats it as a non-event and
    // keeps trying other transports; the expired flow is dropped on first read.
    expect(transport.consumeCallback(callbackUrl)).toBeNull()
    expect(transport.consumeCallback(callbackUrl)).toBeNull()
  })

  it('ignores callbacks with an unknown or missing state', () => {
    const transport = new DeepLinkCallbackTransport({ redirectUri: REDIRECT_URI })
    registerFlow(transport, 'known-state')

    expect(transport.consumeCallback(new URL(`${REDIRECT_URI}?state=forged&code=code`))).toBeNull()
    expect(transport.consumeCallback(new URL(`${REDIRECT_URI}?code=code`))).toBeNull()
    // The genuine flow is untouched by the forged probes.
    expect(transport.consumeCallback(new URL(`${REDIRECT_URI}?state=known-state&code=code`))).not.toBeNull()
  })

  // When the user denies consent the provider redirects back with an `error`
  // (and usually an `error_description`); surface that as a thrown error so the
  // flow reports failure rather than silently succeeding with no code.
  it('throws with the error_description when the user denies the request', () => {
    const transport = new DeepLinkCallbackTransport({ redirectUri: REDIRECT_URI })
    registerFlow(transport)

    expect(() =>
      transport.consumeCallback(
        new URL(`${REDIRECT_URI}?state=state&error=access_denied&error_description=User%20denied%20access`)
      )
    ).toThrow('User denied access')
    // The denied flow is consumed, so a replayed callback is treated as unknown.
    expect(transport.consumeCallback(new URL(`${REDIRECT_URI}?state=state&code=code`))).toBeNull()
  })

  it('falls back to the raw error code when no description is provided', () => {
    const transport = new DeepLinkCallbackTransport({ redirectUri: REDIRECT_URI })
    registerFlow(transport)

    expect(() => transport.consumeCallback(new URL(`${REDIRECT_URI}?state=state&error=access_denied`))).toThrow(
      'access_denied'
    )
  })

  // The result carries the user's API keys, so it must reach exactly the flow's
  // initiator via point-to-point IpcApi send — never a broadcast.
  it('sends the consumed result point-to-point to the initiator window', () => {
    const transport = new DeepLinkCallbackTransport({ redirectUri: REDIRECT_URI })

    transport.sendConsumedResult('state', 'settings-window', { apiKeys: 'k1,k2' })

    expect(ipcApiServiceMock.send).toHaveBeenCalledWith('settings-window', 'oauth.deep_link_result', {
      state: 'state',
      apiKeys: 'k1,k2'
    })
  })

  it('sends an error result to the initiator without any apiKeys field', () => {
    const transport = new DeepLinkCallbackTransport({ redirectUri: REDIRECT_URI })

    transport.sendConsumedResult('state', 'settings-window', { error: 'boom' })

    expect(ipcApiServiceMock.send).toHaveBeenCalledWith('settings-window', 'oauth.deep_link_result', {
      state: 'state',
      error: 'boom'
    })
  })
})
