import { describe, expect, it } from 'vitest'

import { SetLogoIntentSchema } from '../logo'

const FILE_ID = '019606a0-0000-7000-8000-000000000003'

describe('SetLogoIntentSchema', () => {
  it('accepts image, preset-key, and default variants', () => {
    expect(SetLogoIntentSchema.safeParse({ kind: 'image', data: new Uint8Array([1]) }).success).toBe(true)
    expect(SetLogoIntentSchema.safeParse({ kind: 'key', key: 'icon:openai' }).success).toBe(true)
    expect(SetLogoIntentSchema.safeParse({ kind: 'default' }).success).toBe(true)
  })

  it('rejects a data:/file:/http(s): key — bytes / stored-file refs / remote URLs are not preset keys', () => {
    for (const key of [
      'data:image/png;base64,abc',
      `file:${FILE_ID}`,
      'file:///tmp/x.png',
      'http://example.com/logo.png',
      'https://example.com/logo.png'
    ]) {
      expect(SetLogoIntentSchema.safeParse({ kind: 'key', key }).success).toBe(false)
    }
  })

  it('rejects neither, empty bytes, and fields from another variant', () => {
    expect(SetLogoIntentSchema.safeParse({}).success).toBe(false)
    expect(SetLogoIntentSchema.safeParse({ kind: 'image', data: new Uint8Array() }).success).toBe(false)
    expect(
      SetLogoIntentSchema.safeParse({ kind: 'image', data: new Uint8Array([1]), key: 'icon:openai' }).success
    ).toBe(false)
    expect(SetLogoIntentSchema.safeParse({ kind: 'default', key: 'icon:openai' }).success).toBe(false)
  })
})
