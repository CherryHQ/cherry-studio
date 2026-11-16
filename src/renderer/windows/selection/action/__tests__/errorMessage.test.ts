import { describe, expect, it } from 'vitest'

import { getSelectionActionErrorMessage } from '../errorMessage'

const translations: Record<string, string> = {
  'error.diagnosis.unknown': 'An error occurred',
  'translate.error.not_configured': 'Translation model is not configured'
}
const translate = (key: string) => translations[key] ?? key

describe('getSelectionActionErrorMessage', () => {
  it('localizes controlled translate error keys', () => {
    expect(getSelectionActionErrorMessage(new Error('translate.error.not_configured'), translate)).toBe(
      'Translation model is not configured'
    )
  })

  it('shows a localized generic message instead of an unclassified raw error', () => {
    expect(getSelectionActionErrorMessage(new Error('Provider returned an unexpected response'), translate)).toBe(
      'An error occurred'
    )
    expect(getSelectionActionErrorMessage('socket hang up', translate)).toBe('An error occurred')
  })
})
