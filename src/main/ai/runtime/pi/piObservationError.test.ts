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
    expect(isPiObservationError(error)).toBe(true)
    expect(isPiObservationError(new Error('other'))).toBe(false)
  })

  it('names the durable runtime and preserves the native detail', () => {
    const error = new PiObservationError({
      runtime: 'pi-durable',
      kind: 'diagnostic',
      reason: 'native-error',
      sessionId: 'session-2',
      causeMessage: 'native boom'
    })

    expect(error.message).toContain('Pi durable runtime')
    expect(error.message).toContain('native boom')
    expect(error.toLogContext()).toMatchObject({
      runtime: 'pi-durable',
      kind: 'diagnostic',
      sessionId: 'session-2',
      causeMessage: 'native boom'
    })
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
  })
})
