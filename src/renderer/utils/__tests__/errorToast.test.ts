import { describe, expect, it } from 'vitest'

import { serializeToastError } from '../errorToast'

describe('toast failure serialization', () => {
  it('keeps the original message when unrelated provider metadata cannot be read', () => {
    const error = new Error('original failure')
    Object.defineProperty(error, 'request', {
      enumerable: true,
      get() {
        throw new Error('metadata unavailable')
      }
    })
    expect(serializeToastError(error)).toMatchObject({ name: 'Error', message: 'original failure' })
  })

  it('keeps a native Error with an unreadable message presentable', () => {
    const error = new Error('original failure')
    Object.defineProperty(error, 'message', {
      get() {
        throw new Error('message unavailable')
      }
    })
    expect(serializeToastError(error)).toMatchObject({ message: '[Unserializable]' })
  })
})
