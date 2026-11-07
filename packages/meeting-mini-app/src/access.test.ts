import { describe, expect, it } from 'vitest'

import { ACCOUNT_URL, assertAccess, refreshAccess, verifyAccessToken } from './access'
import { encodeText } from './meeting'

const response = (value: unknown, status = 200) => ({ status, headers: {}, body: encodeText(JSON.stringify(value)) })
const accepted = { code: 1, data: { user: { id: 42 } } }

describe('online meeting access', () => {
  it('sends the token only in the account request header and accepts the verified user', async () => {
    const access = await verifyAccessToken(' test-token ', async (input) => {
      expect(input).toEqual({
        url: ACCOUNT_URL,
        method: 'GET',
        headers: { accept: 'application/json', token: 'test-token' }
      })
      return response(accepted)
    })
    expect(access).toEqual({ token: 'test-token', userId: '42', revoked: false })
  })

  it.each([0, 401, -1])('rejects HTTP success with business failure %s', async (code) => {
    await expect(verifyAccessToken('test-token', async () => response({ code }))).rejects.toThrow('invalidToken')
  })

  it.each([401, 403])('rejects HTTP %s even with a success-shaped body', async (status) => {
    await expect(verifyAccessToken('test-token', async () => response(accepted, status))).rejects.toThrow(
      'invalidToken'
    )
  })

  it.each([{ code: 1 }, { code: '1', data: accepted.data }, { code: 1, data: { user: {} } }])(
    'fails closed on a malformed user response',
    async (value) => {
      await expect(verifyAccessToken('test-token', async () => response(value))).rejects.toThrow('authUnavailable')
    }
  )

  it.each(['', 'a\nb', 'x'.repeat(4097)])('rejects invalid token input before a request', async (token) => {
    let requested = false
    await expect(
      verifyAccessToken(token, async () => {
        requested = true
        return response(accepted)
      })
    ).rejects.toThrow('invalidToken')
    expect(requested).toBe(false)
  })

  it('clears a revoked token and does not revive the session', async () => {
    const access = await verifyAccessToken('test-token', async () => response(accepted))
    await expect(refreshAccess(access, async () => response({ code: 0 }))).rejects.toThrow('accessExpired')
    expect(access.token).toBe('')
    expect(() => assertAccess(access)).toThrow('accessExpired')
    await expect(refreshAccess(access, async () => response(accepted))).rejects.toThrow('accessExpired')
  })

  it('closes access on network failure without exposing transport details', async () => {
    const access = await verifyAccessToken('test-token', async () => response(accepted))
    await expect(
      refreshAccess(access, async () => {
        throw new Error('secret request details')
      })
    ).rejects.toThrow('authUnavailable')
    expect(access.token).toBe('')
    expect(() => assertAccess(access)).toThrow('accessExpired')
  })

  it('rejects a token that changes account identity', async () => {
    const access = await verifyAccessToken('test-token', async () => response(accepted))
    await expect(refreshAccess(access, async () => response({ code: 1, data: { user: { id: 43 } } }))).rejects.toThrow(
      'accessExpired'
    )
  })
})
