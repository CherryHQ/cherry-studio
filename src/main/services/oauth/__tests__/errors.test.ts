import { describe, expect, it } from 'vitest'

import { describeOAuthError, OAuthServiceError } from '../errors'

describe('OAuth error diagnostics', () => {
  it('retains a nested HTTP failure without exposing the token response body', () => {
    const failure = Object.assign(new Error('token exchange rejected'), {
      status: 401,
      body: { access_token: 'private-access-token', refresh_token: 'private-refresh-token' }
    })

    const diagnostic = describeOAuthError(new OAuthServiceError('refresh failed', failure))

    expect(diagnostic).toEqual({ name: 'Error', message: 'token exchange rejected', status: 401 })
    expect(JSON.stringify(diagnostic)).not.toContain('private-')
  })

  it('contains unreadable provider error fields', () => {
    const failure = Object.defineProperty(new Error('request failed'), 'status', {
      get() {
        throw new Error('unreadable status')
      }
    })

    expect(describeOAuthError(failure)).toEqual({ name: 'UnknownError', message: 'OAuth request failed' })
  })

  it('contains rejection values that cannot be converted to text', () => {
    const failure = {
      toString() {
        throw new Error('unprintable OAuth failure')
      }
    }

    expect(describeOAuthError(failure)).toEqual({ name: 'UnknownError', message: 'OAuth request failed' })
  })
})
