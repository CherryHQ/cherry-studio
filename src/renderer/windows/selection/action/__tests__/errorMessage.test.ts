import { describe, expect, it, vi } from 'vitest'

import { getSelectionActionErrorMessage } from '../errorMessage'

describe('getSelectionActionErrorMessage', () => {
  it('localizes controlled translate error keys', () => {
    const translate = vi.fn(() => 'Translation model is not configured')

    expect(getSelectionActionErrorMessage(new Error('translate.error.not_configured'), translate)).toBe(
      'Translation model is not configured'
    )
    expect(translate).toHaveBeenCalledWith('translate.error.not_configured')
  })

  it('preserves unknown error messages without translating them', () => {
    const translate = vi.fn((key: string) => key)

    expect(getSelectionActionErrorMessage(new Error('Provider returned an unexpected response'), translate)).toBe(
      'Provider returned an unexpected response'
    )
    expect(translate).not.toHaveBeenCalled()
  })
})
