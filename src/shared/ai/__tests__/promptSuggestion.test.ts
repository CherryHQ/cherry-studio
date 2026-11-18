import { expect, it } from 'vitest'

import { promptSuggestionForDisplay } from '../promptSuggestion'

it.each([
  '/run tests',
  '@send this',
  'run\u200b tests',
  'run\n tests',
  '-----BEGIN PRIVATE KEY-----',
  'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.signature',
  'x'.repeat(262145)
])('rejects unsafe display text', (text) => {
  expect(promptSuggestionForDisplay(text)).toBe('')
})
it('checks a normalized copy but preserves the original display text', () => {
  expect(promptSuggestionForDisplay('  cafe\u0301 tests  ')).toBe('  cafe\u0301 tests  ')
})

it.each([undefined, null, 0, false, {}, []].map((input) => ({ input })))(
  'omits a non-string candidate: %j',
  ({ input }) => {
    expect(promptSuggestionForDisplay(input)).toBe('')
  }
)
