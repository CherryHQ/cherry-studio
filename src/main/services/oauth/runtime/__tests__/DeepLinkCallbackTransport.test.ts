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

  it('rejects and removes callbacks whose state has expired', () => {
    const transport = new DeepLinkCallbackTransport({ redirectUri: REDIRECT_URI })
    registerFlow(transport)
    vi.setSystemTime(Date.now() + FLOW_TTL_MS + 1)

    const callbackUrl = new URL(`${REDIRECT_URI}?state=state&code=code`)

    expect(() => transport.consumeCallback(callbackUrl)).toThrow('OAuth callback for unknown or expired state')
    expect(() => transport.consumeCallback(callbackUrl)).toThrow('OAuth callback for unknown or expired state')
  })
})
