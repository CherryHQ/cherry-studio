import { createInstance } from 'i18next'
import { describe, expect, it } from 'vitest'

import enUs from '@renderer/i18n/locales/en-us.json'
import { cherryCloudErrorCodes } from '@shared/ipc/errors/cherryCloud'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { oauthErrorCodes } from '@shared/ipc/errors/oauth'

import { formatSignInFailure } from '../signInFailure'

const i18n = createInstance()
await i18n.init({
  resources: { en: { translation: enUs } },
  lng: 'en',
  keySeparator: false,
  interpolation: { escapeValue: false }
})

describe('formatSignInFailure', () => {
  it.each([
    [
      'codex',
      { reason: 'http_error', phase: 'exchange', httpStatus: 400 },
      'login',
      { title: 'OpenAI Codex sign-in failed', description: 'During token exchange: The request failed (HTTP 400).' }
    ],
    [
      'codex',
      { reason: 'network', phase: 'exchange' },
      'login',
      { title: 'OpenAI Codex sign-in failed', description: 'During token exchange: A network error prevented sign-in.' }
    ],
    [
      'codex',
      { reason: 'request_timeout', phase: 'exchange' },
      'login',
      { title: 'OpenAI Codex sign-in failed', description: 'During token exchange: The request timed out.' }
    ],
    [
      'grok_cli',
      { reason: 'callback_timeout', phase: 'callback' },
      'login',
      {
        title: 'Grok CLI sign-in failed',
        description: 'During browser authorization: Timed out waiting for browser authorization.'
      }
    ],
    [
      'codex',
      { reason: 'http_error', phase: 'exchange' },
      'login',
      { title: 'OpenAI Codex sign-in failed', description: 'During token exchange: The server rejected the request.' }
    ],
    [
      'codex',
      { reason: 'network', phase: 'exchange' },
      'cancel',
      { title: 'Could not cancel OpenAI Codex sign-in', description: 'A network error prevented sign-in.' }
    ],
    [
      'codex',
      { reason: 'http_error', phase: 'exchange', httpStatus: 400 },
      'cancel',
      { title: 'Could not cancel OpenAI Codex sign-in', description: 'The request failed (HTTP 400).' }
    ],
    [
      'codex',
      { reason: 'unknown', phase: 'persist' },
      'login',
      {
        title: 'OpenAI Codex sign-in failed',
        description: 'An unexpected error occurred.'
      }
    ],
    [
      'grok_cli',
      { reason: 'invalid_response', phase: 'discovery' },
      'login',
      {
        title: 'Grok CLI sign-in failed',
        description: 'During provider discovery: The provider returned an invalid sign-in response.'
      }
    ]
  ] as const)('translates %s failure %j for %s', (namespace, data, action, expected) => {
    const error = new IpcError(oauthErrorCodes.SIGN_IN_FAILED, 'PRIVATE_MESSAGE', data)

    const { title, description } = formatSignInFailure(i18n.t, namespace, error, action)

    expect(title).toBe(expected.title)
    expect(description).toBe(expected.description)
  })

  it.each([{ reason: 'nope' }, 'PRIVATE_DATA', undefined, null])('uses a safe unknown reason for %j', (data) => {
    const error = new IpcError(oauthErrorCodes.SIGN_IN_FAILED, 'PRIVATE_MESSAGE', data)
    error.stack = 'PRIVATE_STACK'

    const text = formatSignInFailure(i18n.t, 'codex', error, 'login')

    expect(text).toEqual({ title: 'OpenAI Codex sign-in failed', description: 'An unexpected error occurred.' })
  })

  it('uses the no-status sentence when the shared normalizer drops an invalid status', () => {
    const error = new IpcError(oauthErrorCodes.SIGN_IN_FAILED, 'PRIVATE_MESSAGE', {
      reason: 'http_error',
      httpStatus: 999
    })

    expect(formatSignInFailure(i18n.t, 'codex', error, 'login')).toEqual({
      title: 'OpenAI Codex sign-in failed',
      description: 'The server rejected the request.'
    })
  })

  it('translates the Cherry Cloud envelope with the local provider label', () => {
    const error = new IpcError(cherryCloudErrorCodes.SIGN_IN_FAILED, 'PRIVATE_MESSAGE', {
      reason: 'network',
      phase: 'authorization'
    })

    expect(formatSignInFailure(i18n.t, 'cherry_cloud', error, 'login')).toEqual({
      title: 'Cherry Cloud sign-in failed',
      description: 'During authorization request: A network error prevented sign-in.'
    })
  })

  it.each([
    new Error('PRIVATE_MESSAGE'),
    new IpcError('INTERNAL', 'PRIVATE_MESSAGE', { reason: 'network' }),
    new IpcError(oauthErrorCodes.SIGN_IN_CANCELLED, 'PRIVATE_MESSAGE', { reason: 'network' })
  ])('ignores upstream text and data outside a sign-in-failed envelope: %s', (error) => {
    const text = formatSignInFailure(i18n.t, 'codex', error, 'login')

    expect(text).toEqual({ title: 'OpenAI Codex sign-in failed', description: 'An unexpected error occurred.' })
  })
})
