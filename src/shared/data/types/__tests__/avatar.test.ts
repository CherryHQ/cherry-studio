import { describe, expect, it } from 'vitest'

import { AvatarInputSchema, AvatarValueSchema } from '../avatar'

const FILE_ID = '019606a0-0000-7000-8000-000000000001'

describe('AvatarValueSchema', () => {
  it('accepts exactly one emoji or image representation', () => {
    expect(AvatarValueSchema.parse({ kind: 'emoji', emoji: '🦞' })).toEqual({ kind: 'emoji', emoji: '🦞' })
    expect(AvatarValueSchema.parse({ kind: 'image', fileId: FILE_ID, src: 'file:///tmp/avatar.png' })).toEqual({
      kind: 'image',
      fileId: FILE_ID,
      src: 'file:///tmp/avatar.png'
    })
  })

  it('rejects payloads that carry fields from both variants', () => {
    expect(
      AvatarValueSchema.safeParse({
        kind: 'emoji',
        emoji: '🦞',
        fileId: FILE_ID,
        src: 'file:///tmp/avatar.png'
      }).success
    ).toBe(false)
    expect(
      AvatarValueSchema.safeParse({
        kind: 'image',
        fileId: FILE_ID,
        src: 'file:///tmp/avatar.png',
        emoji: '🦞'
      }).success
    ).toBe(false)
  })

  it('rejects neither-source and non-portable create-image payloads', () => {
    expect(AvatarValueSchema.safeParse({}).success).toBe(false)
    expect(AvatarInputSchema.safeParse({ kind: 'image', fileId: FILE_ID, src: 'file:///tmp/avatar.png' }).success).toBe(
      false
    )
  })

  it('accepts strict create variants and rejects both/neither/extra fields', () => {
    expect(AvatarInputSchema.parse({ kind: 'emoji', emoji: '🦞' })).toEqual({ kind: 'emoji', emoji: '🦞' })
    expect(AvatarInputSchema.parse({ kind: 'image', fileId: FILE_ID })).toEqual({ kind: 'image', fileId: FILE_ID })

    expect(AvatarInputSchema.safeParse({}).success).toBe(false)
    expect(AvatarInputSchema.safeParse({ kind: 'emoji', emoji: '🦞', fileId: FILE_ID }).success).toBe(false)
    expect(AvatarInputSchema.safeParse({ kind: 'image', fileId: FILE_ID, emoji: '🦞' }).success).toBe(false)
  })
})
