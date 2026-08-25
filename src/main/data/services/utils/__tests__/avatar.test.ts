import { FileEntryIdSchema } from '@shared/data/types/file'
import { describe, expect, it } from 'vitest'

import { resolveAvatarValue } from '../avatar'

const FILE_ID = FileEntryIdSchema.parse('019606a0-0000-7000-8000-000000000001')
const IMAGE = { fileId: FILE_ID, src: 'file:///tmp/avatar.png' }

describe('resolveAvatarValue', () => {
  it('maps each valid persistence representation without fallback', () => {
    expect(resolveAvatarValue({ type: 'assistant', id: 'assistant-1' }, '🦞', undefined)).toEqual({
      kind: 'emoji',
      emoji: '🦞'
    })
    expect(resolveAvatarValue({ type: 'agent', id: 'agent-1' }, null, IMAGE)).toEqual({
      kind: 'image',
      ...IMAGE
    })
  })

  it('throws when both persistence sources exist', () => {
    expect(() => resolveAvatarValue({ type: 'assistant', id: 'assistant-1' }, '🦞', IMAGE)).toThrow(
      'expected exactly one of avatarEmoji or image reference'
    )
  })

  it('throws when neither persistence source exists', () => {
    expect(() => resolveAvatarValue({ type: 'agent', id: 'agent-1' }, null, undefined)).toThrow(
      'expected exactly one of avatarEmoji or image reference'
    )
  })
})
