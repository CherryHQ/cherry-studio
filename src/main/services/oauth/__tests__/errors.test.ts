import type { Server } from 'node:http'

import { MockApplicationUtils } from '@test-mocks/main/application'
import { net, shell } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BaseService } from '@main/core/lifecycle'
import { runOAuthSignIn } from '@main/ipc/handlers/oauthSignIn'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { normalizeSignInFailure } from '@shared/ipc/errors/signIn'

import {
  classifyOAuthSignInFailure,
  describeOAuthError,
  OAuthDiscoveryError,
  OAuthServiceError,
  OAuthSignInFailureError
} from '../errors'
import { LoopbackCallbackTransport } from '../runtime/LoopbackCallbackTransport'
import { OAuthRuntimeService } from '../runtime/OAuthRuntimeService'
import { OAuthHttpError } from '../runtime/PkceOAuthClient'

const TOKEN_BODY = '<synthetic body with TOKEN_MARKER>'
const expectedHttpEnvelope = {
  code: 'OAUTH_SIGN_IN_FAILED',
  message: 'Provider sign-in failed',
  data: { reason: 'http_error', phase: 'exchange', httpStatus: 400 }
}

async function exchangeEnvelope() {
  BaseService.resetInstances()
  const runtime = new OAuthRuntimeService()
  vi.spyOn(LoopbackCallbackTransport.prototype, 'waitForAuthorizationCode').mockResolvedValue('CODE_MARKER')
  MockApplicationUtils.setService('OAuthRuntimeService', runtime)
  const error = await runOAuthSignIn('w1', 'openai-codex', 'request-1').catch((caught: unknown) => caught)
  return IpcError.from(error).toJSON()
}

describe('sign-in classification and redaction', () => {
  beforeEach(() => {
    BaseService.resetInstances()
    vi.mocked(net.fetch).mockReset()
    vi.mocked(shell.openExternal).mockReset().mockResolvedValue()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    MockApplicationUtils.resetServices()
  })

  it('keeps discovery HTTP status and the supplied sign-in phase', () => {
    const error = new OAuthDiscoveryError('xAI OAuth discovery failed: 403', 403)
    expect(classifyOAuthSignInFailure(error)).toEqual({ reason: 'http_error', httpStatus: 403 })
    expect(classifyOAuthSignInFailure(error, 'discovery')).toEqual({
      reason: 'http_error',
      phase: 'discovery',
      httpStatus: 403
    })
  })

  it('keeps HTTP status through the real runtime without serializing token bodies, causes or stacks', async () => {
    const upstream = new OAuthHttpError('Failed to exchange code for token: 400', 400, TOKEN_BODY)
    vi.mocked(net.fetch).mockRejectedValueOnce(upstream)
    const envelope = await exchangeEnvelope()
    expect(envelope).toEqual(expectedHttpEnvelope)
    const serialized = JSON.stringify(envelope)
    for (const secret of ['TOKEN_MARKER', TOKEN_BODY, upstream.stack!, 'cause', 'stack', 'CODE_MARKER']) {
      expect(serialized).not.toContain(secret)
    }
  })

  it('classifies a received HTTP 400 at the token seam', async () => {
    vi.mocked(net.fetch).mockResolvedValueOnce(new Response(TOKEN_BODY, { status: 400 }))
    expect(await exchangeEnvelope()).toEqual(expectedHttpEnvelope)
  })

  it('classifies fetch transport rejection without inventing a status', async () => {
    vi.mocked(net.fetch).mockRejectedValueOnce(new TypeError('https://secret.example/TOKEN_MARKER'))
    expect(await exchangeEnvelope()).toEqual({
      code: 'OAUTH_SIGN_IN_FAILED',
      message: 'Provider sign-in failed',
      data: { reason: 'network', phase: 'exchange' }
    })
  })

  it('distinguishes the named token deadline from a received HTTP 408', async () => {
    const deadline = new AbortController()
    const timeout = vi
      .spyOn(AbortSignal, 'timeout')
      .mockImplementation((duration) => (duration === 30_000 ? deadline.signal : new AbortController().signal))
    vi.mocked(net.fetch).mockImplementationOnce(async (_url, options) => {
      deadline.abort(new DOMException('TOKEN_MARKER', 'TimeoutError'))
      throw options?.signal?.reason
    })
    expect(await exchangeEnvelope()).toMatchObject({ data: { reason: 'request_timeout', phase: 'exchange' } })
    expect(timeout).toHaveBeenCalledWith(30_000)
    vi.mocked(net.fetch).mockResolvedValueOnce(new Response('', { status: 408 }))
    expect(await exchangeEnvelope()).toMatchObject({
      data: { reason: 'http_error', phase: 'exchange', httpStatus: 408 }
    })
  })

  it.each(['network', 'request_timeout'])(
    'classifies successful-response body transport failure as %s',
    async (reason) => {
      const deadline = new AbortController()
      vi.spyOn(AbortSignal, 'timeout').mockImplementation((duration) =>
        duration === 30_000 ? deadline.signal : new AbortController().signal
      )
      vi.mocked(net.fetch).mockImplementationOnce(
        async () =>
          new Response(
            new ReadableStream({
              start(controller) {
                if (reason === 'request_timeout') deadline.abort()
                controller.error(new TypeError('TOKEN_MARKER'))
              }
            })
          )
      )
      expect(await exchangeEnvelope()).toEqual({
        code: 'OAUTH_SIGN_IN_FAILED',
        message: 'Provider sign-in failed',
        data: { reason, phase: 'exchange' }
      })
    }
  )

  it.each(['{TOKEN_MARKER', '{"access_token":123}'])(
    'classifies invalid successful token JSON/schema: %s',
    async (body) => {
      vi.mocked(net.fetch).mockResolvedValueOnce(new Response(body))
      expect(await exchangeEnvelope()).toEqual({
        code: 'OAUTH_SIGN_IN_FAILED',
        message: 'Provider sign-in failed',
        data: { reason: 'invalid_response', phase: 'exchange' }
      })
    }
  )

  it.each([
    ['evil<script>', 'callback_failed'],
    ['access_denied', 'authorization_denied'],
    ['', 'missing_code']
  ])('selects a callback reason without copying the query value %s', async (queryError, reason) => {
    const transport = new LoopbackCallbackTransport({
      hosts: ['127.0.0.1'],
      port: 0,
      path: '/callback',
      redirectUri: 'http://127.0.0.1/callback'
    })
    try {
      const runtime = new OAuthRuntimeService()
      vi.spyOn(
        runtime as unknown as { getLoopbackTransport(): LoopbackCallbackTransport },
        'getLoopbackTransport'
      ).mockReturnValue(transport)
      MockApplicationUtils.setService('OAuthRuntimeService', runtime)
      const result = runOAuthSignIn('w1', 'openai-codex', 'callback').catch((error: unknown) =>
        IpcError.from(error).toJSON()
      )
      await vi.waitFor(() => expect(shell.openExternal).toHaveBeenCalled())
      const authUrl = new URL(vi.mocked(shell.openExternal).mock.calls.at(-1)![0])
      const state = authUrl.searchParams.get('state')!
      const servers = (transport as unknown as { activeServers: Server[] }).activeServers
      const address = servers[0].address()
      if (!address || typeof address === 'string') throw new Error('No callback address')
      const url = new URL(`http://127.0.0.1:${address.port}/callback`)
      url.searchParams.set('state', state)
      if (queryError) url.searchParams.set('error', queryError)
      await fetch(url)
      const envelope = await result
      expect(envelope).toEqual({
        code: 'OAUTH_SIGN_IN_FAILED',
        message: 'Provider sign-in failed',
        data: { reason, phase: 'callback' }
      })
      expect(JSON.stringify(envelope)).not.toContain('evil<script>')
      expect(JSON.stringify(envelope)).not.toContain(state)
    } finally {
      transport.close()
    }
  })

  it('retains the underlying transport diagnostic in the log projection', () => {
    const error = new OAuthSignInFailureError({ reason: 'network' }, new Error('net::ERR_TUNNEL_CONNECTION_FAILED'))
    expect(describeOAuthError(error)).toEqual({
      name: 'Error',
      message: 'net::ERR_TUNNEL_CONNECTION_FAILED'
    })
  })

  it('keeps nested HTTP status without leaking token bodies in the log projection', () => {
    const error = new OAuthSignInFailureError(
      { reason: 'http_error', httpStatus: 400 },
      new OAuthServiceError('outer', new OAuthHttpError('Failed to exchange code for token: 400', 400, TOKEN_BODY))
    )
    const projection = describeOAuthError(error)
    expect(projection).toEqual({
      name: 'OAuthHttpError',
      message: 'Failed to exchange code for token: 400',
      status: 400
    })
    expect(projection.message).not.toContain('TOKEN_MARKER')
    expect(JSON.stringify(projection)).not.toContain(TOKEN_BODY)
  })

  it('retains the existing log-safe nested HTTP projection', () => {
    const nested = new OAuthServiceError(
      'outer',
      new OAuthHttpError('Failed to exchange code for token: 400', 400, TOKEN_BODY)
    )
    expect(describeOAuthError(nested)).toEqual({
      name: 'OAuthHttpError',
      message: 'Failed to exchange code for token: 400',
      status: 400
    })
  })
})

describe('normalizeSignInFailure', () => {
  it.each([NaN, Infinity, 400.5, '400', 0, 99, 600])('drops invalid HTTP status %s', (httpStatus) => {
    expect(normalizeSignInFailure({ reason: 'http_error', httpStatus })).toEqual({ reason: 'http_error' })
  })
  it.each([undefined, null, {}, { reason: 'evil<script>' }])('rejects missing or unknown reasons: %s', (data) => {
    expect(normalizeSignInFailure(data)).toBeUndefined()
  })
  it('selects only allowed fields and drops an unknown phase', () => {
    expect(
      normalizeSignInFailure({
        reason: 'http_error',
        phase: 'TOKEN_MARKER',
        httpStatus: 400,
        body: TOKEN_BODY,
        cause: 'secret'
      })
    ).toEqual({ reason: 'http_error', httpStatus: 400 })
  })
})
