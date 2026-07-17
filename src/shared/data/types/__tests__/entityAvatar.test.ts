import { describe, expect, it } from 'vitest'

import { EntityAvatarInputSchema, EntityAvatarSchema } from '../entityAvatar'

const FILE_ID = '019606a0-0000-7000-8000-000000000001'

describe('EntityAvatarSchema', () => {
  it('accepts exactly one emoji or image representation', () => {
    expect(EntityAvatarSchema.parse({ kind: 'emoji', emoji: '🦞' })).toEqual({ kind: 'emoji', emoji: '🦞' })
    expect(EntityAvatarSchema.parse({ kind: 'image', fileId: FILE_ID, src: 'file:///tmp/avatar.png' })).toEqual({
      kind: 'image',
      fileId: FILE_ID,
      src: 'file:///tmp/avatar.png'
    })
  })

  it('rejects payloads that carry fields from both variants', () => {
    expect(
      EntityAvatarSchema.safeParse({
        kind: 'emoji',
        emoji: '🦞',
        fileId: FILE_ID,
        src: 'file:///tmp/avatar.png'
      }).success
    ).toBe(false)
    expect(
      EntityAvatarSchema.safeParse({
        kind: 'image',
        fileId: FILE_ID,
        src: 'file:///tmp/avatar.png',
        emoji: '🦞'
      }).success
    ).toBe(false)
  })

  it('rejects neither-source and non-portable create-image payloads', () => {
    expect(EntityAvatarSchema.safeParse({}).success).toBe(false)
    expect(
      EntityAvatarInputSchema.safeParse({ kind: 'image', fileId: FILE_ID, src: 'file:///tmp/avatar.png' }).success
    ).toBe(false)
  })
})
