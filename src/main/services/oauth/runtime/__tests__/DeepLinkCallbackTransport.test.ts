import { beforeEach, describe, expect, it, vi } from 'vitest'

const windowManagerMock = vi.hoisted(() => ({
  getWindowIdByWebContents: vi.fn()
}))

vi.mock('@application', () => ({
  application: {
    get: (name: string) => {
      if (name === 'WindowManager') return windowManagerMock
      throw new Error(`unexpected service: ${name}`)
    }
  }
}))

import { DeepLinkCallbackTransport } from '../DeepLinkCallbackTransport'

const REDIRECT_URI = 'cherrystudio://oauth/callback'
const FLOW_TTL_MS = 10 * 60 * 1000

function registerFlow(transport: DeepLinkCallbackTransport, state = 'state') {
  windowManagerMock.getWindowIdByWebContents.mockReturnValue('settings-window')
  transport.registerAuthorizationRequest('https://open.cherryin.ai/oauth2/auth', state, 'verifier', {
    sender: { id: 1 }
  } as Electron.IpcMainInvokeEvent)
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
})
