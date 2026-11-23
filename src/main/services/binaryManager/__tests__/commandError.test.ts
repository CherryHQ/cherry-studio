import { describe, expect, it } from 'vitest'

import { sanitizedCommandError } from '../commandError'

describe('sanitizedCommandError', () => {
  it('redacts credentials from the message and stderr while retaining useful diagnostics', () => {
    const error = Object.assign(
      new Error('Download failed: https://user:password@example.com/archive?access_token=private-access'),
      {
        stderr: 'Authorization: Bearer private-token\nhttps://mirror.test/file?api_key=private-key'
      }
    )

    expect(sanitizedCommandError(error)).toBe(
      'Download failed: https://***@example.com/archive?access_token=***\nAuthorization: Bearer ***\nhttps://mirror.test/file?api_key=***'
    )
  })

  it('returns safe diagnostic text when a captured stderr property cannot be read', () => {
    const error = Object.defineProperty(new Error('failed with private-token'), 'stderr', {
      get() {
        throw new Error('private-token')
      }
    })

    expect(sanitizedCommandError(error)).toBe('Unknown error')
  })

  it('converts malformed Error message values without raising a secondary exception', () => {
    const error = Object.assign(new Error(), {
      message: {
        toString() {
          throw new Error('private-token')
        }
      }
    })

    expect(sanitizedCommandError(error)).toBe('Unknown error')
    expect(sanitizedCommandError(null)).toBe('null')
  })
})
