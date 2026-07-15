import { describe, expect, it, vi } from 'vitest'

import { getSelectionActionErrorMessage } from '../errorMessage'

describe('getSelectionActionErrorMessage', () => {
  it('preserves unknown error messages without translating them', () => {
    const translate = vi.fn((key: string) => key)

    expect(getSelectionActionErrorMessage(new Error('Provider returned an unexpected response'), translate)).toBe(
      'Provider returned an unexpected response'
    )
    expect(translate).not.toHaveBeenCalled()
  })
})
