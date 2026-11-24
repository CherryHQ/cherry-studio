import { describe, expect, it } from 'vitest'

import { SessionStoreEntrySchema } from '../sessionStoreEntry'

describe('SessionStoreEntrySchema', () => {
  it('retains the opaque native JSON payload', () => {
    const serialized =
      '{"type":"future-native-entry","uuid":"opaque-id","timestamp":"opaque-time","__proto__":{"native":true},"payload":{"future":[1,"two"]}}'
    const original: unknown = JSON.parse(serialized)
    const entry = SessionStoreEntrySchema.parse(original)

    expect(entry).toStrictEqual(original)
  })

  it.each([
    { type: 'system' },
    { type: 'content-replacement', replacements: [{ uuid: 'old', content: 'replacement' }] },
    { type: 'assistant', isSidechain: 'opaque-native-value' }
  ])('accepts the SDK envelope without requiring optional fields for $type', (original) => {
    expect(SessionStoreEntrySchema.parse(original)).toStrictEqual(original)
  })

  it.each(
    [
      null,
      [],
      true,
      42,
      { uuid: 'missing-type' },
      { type: 42 },
      { type: 'assistant', uuid: null },
      { type: 'assistant', timestamp: 42 }
    ].map((value) => ({ value }))
  )('rejects a value outside the SDK envelope: $value', ({ value }) => {
    expect(SessionStoreEntrySchema.safeParse(value).success).toBe(false)
  })
})
