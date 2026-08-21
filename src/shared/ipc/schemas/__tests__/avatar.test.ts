import { describe, expect, it } from 'vitest'

import { SetAvatarIntentSchema } from '../avatar'

describe('SetAvatarIntentSchema', () => {
  it('accepts one normalized image or emoji variant', () => {
    expect(SetAvatarIntentSchema.safeParse({ kind: 'image', data: new Uint8Array([1]) }).success).toBe(true)
    expect(SetAvatarIntentSchema.safeParse({ kind: 'emoji', emoji: '🦞' }).success).toBe(true)
  })

  it('rejects both, neither, empty bytes, and extra fields', () => {
    expect(SetAvatarIntentSchema.safeParse({}).success).toBe(false)
    expect(SetAvatarIntentSchema.safeParse({ kind: 'image', data: new Uint8Array() }).success).toBe(false)
    expect(SetAvatarIntentSchema.safeParse({ kind: 'emoji', emoji: '🦞', data: new Uint8Array([1]) }).success).toBe(
      false
    )
    expect(SetAvatarIntentSchema.safeParse({ kind: 'image', data: new Uint8Array([1]), emoji: '🦞' }).success).toBe(
      false
    )
  })
})
