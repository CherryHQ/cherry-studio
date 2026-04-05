import { describe, expect, it } from 'vitest'

import { buildMessageTree, type OldMessage } from '../ChatMappings'

/** Helper: create a minimal OldMessage stub */
function msg(id: string, role: 'user' | 'assistant' = 'assistant', extra: Partial<OldMessage> = {}): OldMessage {
  return {
    id,
    role,
    assistantId: 'a1',
    topicId: 't1',
    createdAt: '2025-01-01T00:00:00.000Z',
    status: 'success',
    blocks: ['block-1'],
    ...extra
  }
}

describe('buildMessageTree', () => {
  it('returns empty map for empty input', () => {
    expect(buildMessageTree([])).toEqual(new Map())
  })

  it('builds a linear chain for sequential messages', () => {
    const messages = [msg('u1', 'user'), msg('a1'), msg('u2', 'user'), msg('a2')]

    const tree = buildMessageTree(messages)

    expect(tree.get('u1')).toEqual({ parentId: null, siblingsGroupId: 0 })
    expect(tree.get('a1')).toEqual({ parentId: 'u1', siblingsGroupId: 0 })
    expect(tree.get('u2')).toEqual({ parentId: 'a1', siblingsGroupId: 0 })
    expect(tree.get('a2')).toEqual({ parentId: 'u2', siblingsGroupId: 0 })
  })

  it('groups multi-model responses under the user message', () => {
    const messages = [
      msg('u1', 'user'),
      msg('a1', 'assistant', { askId: 'u1', foldSelected: true }),
      msg('a2', 'assistant', { askId: 'u1' })
    ]

    const tree = buildMessageTree(messages)

    expect(tree.get('u1')).toEqual({ parentId: null, siblingsGroupId: 0 })
    // Both responses share the same parent (user message) and siblingsGroupId
    expect(tree.get('a1')!.parentId).toBe('u1')
    expect(tree.get('a2')!.parentId).toBe('u1')
    expect(tree.get('a1')!.siblingsGroupId).toBeGreaterThan(0)
    expect(tree.get('a1')!.siblingsGroupId).toBe(tree.get('a2')!.siblingsGroupId)
  })

  it('links user message after multi-model group to foldSelected response', () => {
    const messages = [
      msg('u1', 'user'),
      msg('a1', 'assistant', { askId: 'u1', foldSelected: true }),
      msg('a2', 'assistant', { askId: 'u1' }),
      msg('u2', 'user')
    ]

    const tree = buildMessageTree(messages)

    // u2 should link to the foldSelected response (a1)
    expect(tree.get('u2')!.parentId).toBe('a1')
  })

  // --- The fix: askId pointing to a deleted user message ---

  it('falls back to previousMessageId when askId points to deleted message', () => {
    // User message 'u1' was deleted, but assistant responses still have askId: 'u1'
    const messages = [msg('a1', 'assistant', { askId: 'u1' }), msg('a2', 'assistant', { askId: 'u1' })]

    const tree = buildMessageTree(messages)

    // askId 'u1' doesn't exist in messages, siblings share a common fallback parent
    expect(tree.get('a1')!.parentId).toBeNull() // first message, no previous → null
    expect(tree.get('a2')!.parentId).toBeNull() // same shared parent as a1
    expect(tree.get('a1')!.siblingsGroupId).toBeGreaterThan(0)
    expect(tree.get('a1')!.siblingsGroupId).toBe(tree.get('a2')!.siblingsGroupId)
  })

  it('falls back to previousMessageId when askId points to deleted message (with prior context)', () => {
    // There's a prior message, then the deleted user message's responses
    const messages = [
      msg('prev', 'assistant'),
      msg('a1', 'assistant', { askId: 'deleted-user-msg' }),
      msg('a2', 'assistant', { askId: 'deleted-user-msg' })
    ]

    const tree = buildMessageTree(messages)

    // Orphaned siblings share 'prev' as common parent and keep siblingsGroupId
    expect(tree.get('a1')!.parentId).toBe('prev')
    expect(tree.get('a2')!.parentId).toBe('prev')
    expect(tree.get('a1')!.siblingsGroupId).toBeGreaterThan(0)
    expect(tree.get('a1')!.siblingsGroupId).toBe(tree.get('a2')!.siblingsGroupId)
  })

  it('handles mixed: some askIds valid, some pointing to deleted messages', () => {
    const messages = [
      msg('u1', 'user'),
      // Valid multi-model group
      msg('a1', 'assistant', { askId: 'u1', foldSelected: true }),
      msg('a2', 'assistant', { askId: 'u1' }),
      // Orphaned group (user message deleted)
      msg('a3', 'assistant', { askId: 'deleted-msg' }),
      msg('a4', 'assistant', { askId: 'deleted-msg' })
    ]

    const tree = buildMessageTree(messages)

    // Valid group: siblings under u1
    expect(tree.get('a1')!.parentId).toBe('u1')
    expect(tree.get('a2')!.parentId).toBe('u1')
    expect(tree.get('a1')!.siblingsGroupId).toBeGreaterThan(0)

    // Orphaned group: siblings share common parent (a2, last before group) and keep groupId
    expect(tree.get('a3')!.parentId).toBe('a2')
    expect(tree.get('a4')!.parentId).toBe('a2')
    expect(tree.get('a3')!.siblingsGroupId).toBeGreaterThan(0)
    expect(tree.get('a3')!.siblingsGroupId).toBe(tree.get('a4')!.siblingsGroupId)
  })

  it('does not form a group for single askId reference even when valid', () => {
    // Only one response with askId — not a multi-model group (count == 1)
    const messages = [msg('u1', 'user'), msg('a1', 'assistant', { askId: 'u1' })]

    const tree = buildMessageTree(messages)

    // Single askId doesn't create a group, falls through to sequential
    expect(tree.get('a1')!.parentId).toBe('u1')
    expect(tree.get('a1')!.siblingsGroupId).toBe(0)
  })

  it('links user message after orphaned foldSelected group to the selected response', () => {
    const messages = [
      msg('prev', 'assistant'),
      msg('a1', 'assistant', { askId: 'deleted', foldSelected: true }),
      msg('a2', 'assistant', { askId: 'deleted' }),
      msg('u1', 'user')
    ]

    const tree = buildMessageTree(messages)

    // Orphaned siblings share 'prev' as parent
    expect(tree.get('a1')!.parentId).toBe('prev')
    expect(tree.get('a2')!.parentId).toBe('prev')
    // u1 should link to foldSelected response a1
    expect(tree.get('u1')!.parentId).toBe('a1')
  })
})
