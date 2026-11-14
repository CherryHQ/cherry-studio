import { describe, expect, it } from 'vitest'

import { serializeError } from '@main/ai/utils/serializeError'

import { isPiObservationError, PiObservationError } from './piObservationError'

describe('PiObservationError', () => {
  it('names the Pi runtime component, the reason, and the retry recovery', () => {
    const error = new PiObservationError({
      runtime: 'pi',
      kind: 'gap',
      reason: 'disconnected',
      sessionId: 'session-1',
      backendId: 'backend-1',
      nativeThreadId: 'thread-1'
    })

    expect(error.name).toBe('PiObservationError')
    expect(error.message).toContain('Pi runtime')
    expect(error.message).toContain('disconnected')
    expect(error.message).toContain('send your message again')
    expect(error.isRetryable).toBe(true)
    expect(error.providerErrorCategory).toBe('stream')
    expect(error.i18nKey).toBe('pi_observation_interrupted')
    expect(error.detailI18nKey).toBe('pi_observation_interrupted_detail')
    expect(error.detailI18nValues).toMatchObject({ reason: 'disconnected' })
    expect(isPiObservationError(error)).toBe(true)
    expect(isPiObservationError(new Error('other'))).toBe(false)
  })

  it('names the durable runtime and preserves the native detail', () => {
    const error = new PiObservationError({
      runtime: 'pi-durable',
      kind: 'closed',
      reason: 'source-lost',
      sessionId: 'session-2',
      causeMessage: 'native boom'
    })

    expect(error.message).toContain('Pi durable runtime')
    expect(error.message).toContain('native boom')
    expect(error.toLogContext()).toMatchObject({
      runtime: 'pi-durable',
      kind: 'closed',
      sessionId: 'session-2',
      causeMessage: 'native boom'
    })
  })

  it('preserves provider classification and retry policy for failed outcomes', () => {
    const error = new PiObservationError({
      runtime: 'pi',
      kind: 'outcome',
      reason: 'failed',
      sessionId: 'session-auth',
      causeMessage: '401 Unauthorized: invalid API key'
    })

    // Ordinary provider failures keep their own diagnosis (auth, not stream)
    // so the renderer preserves the provider-settings navigation.
    expect(error.providerErrorCategory).toBe('auth')
    expect(error.isRetryable).toBe(false)
    expect(error.i18nKey).toBeUndefined()
    expect(error.message).toContain('401 Unauthorized')
    expect(error.message).not.toContain('send your message again')
    expect(error.toLogContext()).toMatchObject({ runtime: 'pi', kind: 'outcome' })
  })

  it('preserves HTTP-status diagnosis when the provider text carries only a status code', () => {
    const auth = new PiObservationError({
      runtime: 'pi',
      kind: 'diagnostic',
      reason: 'failed',
      sessionId: 'session-status-auth',
      causeMessage: '401: {"message":"Access denied"}'
    })

    expect(auth.providerErrorCategory).toBe('auth')
    expect(auth.statusCode).toBe(401)
    expect(auth.isRetryable).toBe(false)

    const unavailable = new PiObservationError({
      runtime: 'pi',
      kind: 'outcome',
      reason: 'failed',
      sessionId: 'session-status-server',
      causeMessage: '503: {"message":"Temporary maintenance"}'
    })

    expect(unavailable.providerErrorCategory).toBe('server')
    expect(unavailable.statusCode).toBe(503)
    expect(unavailable.isRetryable).toBe(true)
  })

  it('leaves unknown provider failures unset so downstream status fallback still applies', () => {
    const error = new PiObservationError({
      runtime: 'pi',
      kind: 'diagnostic',
      reason: 'weird-unknown-xyz',
      sessionId: 'session-unknown',
      causeMessage: 'Something totally unrelated failure'
    })

    expect(error.providerErrorCategory).toBeUndefined()
    expect(error.statusCode).toBeUndefined()
    expect(error.isRetryable).toBe(false)

    const serialized = serializeError(error)
    expect(serialized.providerErrorCategory).toBeUndefined()
  })

  it('survives main-process serialization with retry and stream diagnosis intact', () => {
    const error = new PiObservationError({
      runtime: 'pi',
      kind: 'closed',
      reason: 'source-lost',
      sessionId: 'session-3',
      backendId: 'backend-3',
      nativeThreadId: 'thread-3'
    })

    const serialized = serializeError(error)
    expect(serialized.name).toBe('PiObservationError')
    expect(serialized.isRetryable).toBe(true)
    expect(serialized.providerErrorCategory).toBe('stream')
    expect(serialized.runtime).toBe('pi')
    expect(serialized.kind).toBe('closed')
    expect(serialized.sessionId).toBe('session-3')
    expect(serialized.backendId).toBe('backend-3')
    expect(serialized.nativeThreadId).toBe('thread-3')
    // `providerErrorCategory: 'stream'` is what routes the renderer to the
    // stream diagnosis (retry guidance) instead of the generic unknown wrapper.
    expect(serialized.providerErrorCategory).toBe('stream')
    expect(serialized.i18nKey).toBe('pi_observation_interrupted')
    expect(serialized.detailI18nKey).toBe('pi_observation_interrupted_detail')
  })
})
