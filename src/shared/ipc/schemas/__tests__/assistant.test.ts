import { describe, expect, it } from 'vitest'

import { assistantRequestSchemas } from '../assistant'

const schema = assistantRequestSchemas['assistant.set_avatar'].input
const assistantId = '550e8400-e29b-41d4-a716-446655440000'

describe('assistant.set_avatar', () => {
  it('accepts bytes, emoji, and default intents', () => {
    for (const avatar of [
      { kind: 'image', data: new Uint8Array([1]) },
      { kind: 'emoji', emoji: '👩🏽‍💻' },
      { kind: 'default' }
    ]) {
      expect(schema.parse({ assistantId, avatar })).toEqual({ assistantId, avatar })
    }
  })

  it('rejects file IDs, paths, URLs, extra fields and non-emoji values', () => {
    for (const avatar of [
      { kind: 'file', fileId: assistantId },
      { kind: 'image', data: '/tmp/avatar.webp' },
      { kind: 'image', data: 'file:///tmp/avatar.webp' },
      { kind: 'image', data: new Uint8Array([1]), fileId: assistantId },
      { kind: 'emoji', emoji: `file:${assistantId}` },
      { kind: 'default', url: 'https://example.com/avatar' }
    ])
      expect(schema.safeParse({ assistantId, avatar }).success).toBe(false)
    expect(schema.safeParse({ assistantId, avatar: { kind: 'default' }, avatarFileId: assistantId }).success).toBe(
      false
    )
  })

  it('enforces the processed image byte limit', () => {
    for (const length of [0, 1024 * 1024 + 1]) {
      expect(schema.safeParse({ assistantId, avatar: { kind: 'image', data: new Uint8Array(length) } }).success).toBe(
        false
      )
    }
    expect(
      schema.safeParse({ assistantId, avatar: { kind: 'image', data: new Uint8Array(1024 * 1024) } }).success
    ).toBe(true)
  })
})
