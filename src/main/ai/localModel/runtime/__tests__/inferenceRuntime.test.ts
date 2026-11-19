import { describe, expect, it } from 'vitest'

import { describeError } from '../utilityEntries/inferenceRuntime'

describe('inference error diagnostics', () => {
  it('keeps native error names, codes, and causes', () => {
    const error = Object.assign(new Error('initialization failed'), {
      code: 'EIO',
      cause: new TypeError('invalid model')
    })

    expect(describeError(error)).toBe('Error code=EIO: initialization failed <- caused by TypeError: invalid model')
  })

  it.each([
    { error: undefined, text: 'Error: undefined' },
    { error: null, text: 'Error: null' },
    { error: false, text: 'Error: false' },
    { error: 0, text: 'Error: 0' },
    { error: '', text: 'Error: ' }
  ])('describes the falsy failure $text', ({ error, text }) => {
    expect(describeError(error)).toBe(text)
  })

  it('contains failures from unreadable native error fields', () => {
    const error = {
      get message() {
        throw new Error('unreadable message')
      }
    }

    expect(describeError(error)).toBe('Error: Unreadable inference failure')
  })

  it('stops at cyclic causes', () => {
    const error = new Error('native failure')
    error.cause = error

    expect(describeError(error)).toBe('Error: native failure')
  })
})
