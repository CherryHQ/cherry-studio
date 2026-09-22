import { describe, expect, it } from 'vitest'

import { isSystemSpeechError, speechError, throwIfAborted } from '../src/contracts'

describe('system speech errors', () => {
  it('preserves a stable error code without exposing the cause in the message', () => {
    const cause = new Error('private native detail')
    const error = speechError('audio_decode_failed', cause)

    expect(isSystemSpeechError(error)).toBe(true)
    expect(error.code).toBe('audio_decode_failed')
    expect(error.message).toBe('audio_decode_failed')
    expect(error.cause).toBe(cause)
  })

  it('turns an aborted signal into the cancelled contract', () => {
    const controller = new AbortController()
    controller.abort('discarded')

    expect(() => throwIfAborted(controller.signal)).toThrowError(
      expect.objectContaining({ code: 'cancelled', message: 'cancelled' })
    )
  })
})
