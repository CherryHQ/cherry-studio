import { describe, expect, it } from 'vitest'

import { LogoImageIntentSchema } from '../entityImage'

const FILE_ID = '019606a0-0000-7000-8000-000000000003'

describe('LogoImageIntentSchema key variant', () => {
  it('accepts a preset key', () => {
    expect(LogoImageIntentSchema.safeParse({ kind: 'key', key: 'icon:openai' }).success).toBe(true)
  })

  it('rejects a data:/file:/http(s): key — bytes / stored-file refs / remote URLs are not preset keys', () => {
    for (const key of [
      'data:image/png;base64,abc',
      `file:${FILE_ID}`,
      'file:///tmp/x.png',
      'http://example.com/logo.png',
      'https://example.com/logo.png'
    ]) {
      expect(LogoImageIntentSchema.safeParse({ kind: 'key', key }).success).toBe(false)
    }
  })
})
