import { describe, expect, it } from 'vitest'

import { normalizePaintingGenerateError, PaintingGenerateError } from '../paintingGenerateError'

describe('painting failure normalization', () => {
  it('retains owned failures and readable provider messages', () => {
    const owned = new PaintingGenerateError('PROMPT_REQUIRED')
    expect(normalizePaintingGenerateError(owned)).toBe(owned)
    expect(normalizePaintingGenerateError(new Error('Provider unavailable'))).toMatchObject({
      code: 'REMOTE_ERROR',
      message: 'Provider unavailable'
    })
  })

  it.each([
    { label: 'non-string message', descriptor: { value: Object.create(null) } },
    {
      label: 'throwing message getter',
      descriptor: {
        get() {
          throw new Error('unreadable')
        }
      }
    }
  ])('keeps the remote failure category with a $label', ({ descriptor }) => {
    const error = Object.defineProperty(new Error(), 'message', descriptor)
    expect(normalizePaintingGenerateError(error)).toMatchObject({ code: 'REMOTE_ERROR', message: 'REMOTE_ERROR' })
  })

  it.each([null, undefined, false, 0, 'raw provider failure'])(
    'does not expose an unclassified rejection: %s',
    (reason) => {
      expect(normalizePaintingGenerateError(reason)).toMatchObject({
        code: 'GENERATE_FAILED',
        message: 'GENERATE_FAILED'
      })
    }
  )
})
