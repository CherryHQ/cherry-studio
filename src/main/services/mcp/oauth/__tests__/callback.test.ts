import { EventEmitter } from 'events'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@main/services/ConfigManager', () => ({
  configManager: {
    getLanguage: vi.fn(() => 'en-US')
  }
}))

vi.mock('@main/utils/locales', () => ({
  locales: {
    'en-US': {
      translation: {
        settings: {
          mcp: {
            oauth: {
              callback: {
                title: 'OAuth complete',
                message: 'You can return to Cherry Studio.'
              }
            }
          }
        }
      }
    }
  }
}))

import { CallBackServer } from '../callback'

async function request(url: string) {
  const response = await fetch(url)
  return {
    status: response.status,
    body: await response.text()
  }
}

describe('CallBackServer', () => {
  let callbackServer: CallBackServer | undefined

  afterEach(async () => {
    await callbackServer?.close()
    callbackServer = undefined
  })

  async function startServer(expectedState = 'expected-state') {
    const events = new EventEmitter()
    const receivedCodes: string[] = []
    events.on('auth-code-received', (code) => {
      receivedCodes.push(code)
    })

    callbackServer = new CallBackServer({
      port: 0,
      path: '/oauth/callback',
      expectedState,
      events
    })

    const server = await callbackServer.getServer
    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('Unexpected callback server address')
    }

    return {
      baseUrl: `http://127.0.0.1:${address.port}`,
      receivedCodes
    }
  }

  it('accepts callbacks with the expected OAuth state', async () => {
    const { baseUrl, receivedCodes } = await startServer()

    const response = await request(`${baseUrl}/oauth/callback?code=AUTH_CODE&state=expected-state`)

    expect(response.status).toBe(200)
    expect(receivedCodes).toEqual(['AUTH_CODE'])
  })

  it('rejects callbacks with missing or mismatched OAuth state', async () => {
    const { baseUrl, receivedCodes } = await startServer()

    const missingState = await request(`${baseUrl}/oauth/callback?code=ATTACKER_CODE`)
    const wrongState = await request(`${baseUrl}/oauth/callback?code=ATTACKER_CODE&state=wrong-state`)

    expect(missingState.status).toBe(400)
    expect(missingState.body).toBe('Invalid OAuth state')
    expect(wrongState.status).toBe(400)
    expect(wrongState.body).toBe('Invalid OAuth state')
    expect(receivedCodes).toEqual([])
  })

  it('ignores an attacker callback and waits for the matching OAuth state', async () => {
    const { baseUrl } = await startServer()
    const authCodePromise = callbackServer!.waitForAuthCode()

    const attackerResponse = await request(`${baseUrl}/oauth/callback?code=ATTACKER_CODE&state=wrong-state`)
    const legitimateResponse = await request(`${baseUrl}/oauth/callback?code=VICTIM_CODE&state=expected-state`)

    await expect(authCodePromise).resolves.toBe('VICTIM_CODE')
    expect(attackerResponse.status).toBe(400)
    expect(legitimateResponse.status).toBe(200)
  })

  it('requires an exact callback path match', async () => {
    const { baseUrl, receivedCodes } = await startServer()

    const response = await request(`${baseUrl}/oauth/callback.extra?code=AUTH_CODE&state=expected-state`)

    expect(response.status).toBe(404)
    expect(receivedCodes).toEqual([])
  })
})
