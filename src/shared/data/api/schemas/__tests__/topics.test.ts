import { describe, expect, it } from 'vitest'

import {
  CreateTopicSchema,
  DuplicateTopicSchema,
  ListTopicsQuerySchema,
  ReusableTopicPlaceholderQuerySchema,
  SetActiveNodeSchema,
  UpdateTopicSchema
} from '../topics'

describe('ListTopicsQuerySchema', () => {
  it('keeps the compatibility branch limited to parameters it executes', () => {
    expect(ListTopicsQuerySchema.parse({ q: 'needle', limit: '10' })).toEqual({ q: 'needle', limit: 10 })
    expect(ListTopicsQuerySchema.safeParse({ assistantId: 'unlinked' }).success).toBe(false)
  })

  it('separates pinned and ordinary stream dimensions', () => {
    expect(ListTopicsQuerySchema.safeParse({ pinned: true, q: 'needle' }).success).toBe(true)
    expect(ListTopicsQuerySchema.safeParse({ pinned: true, sortBy: 'lastActivityAt' }).success).toBe(false)
    expect(ListTopicsQuerySchema.safeParse({ pinned: false, sortBy: 'lastActivityAt' }).success).toBe(true)
  })
})

describe('ReusableTopicPlaceholderQuerySchema', () => {
  it('accepts an exact live owner or the unassigned creation target', () => {
    const assistantId = '11111111-1111-4111-8111-111111111111'
    expect(ReusableTopicPlaceholderQuerySchema.parse({ assistantId })).toEqual({ assistantId })
    expect(ReusableTopicPlaceholderQuerySchema.parse({ assistantId: 'unassigned' })).toEqual({
      assistantId: 'unassigned'
    })
  })

  it('rejects list-only and unlinked aggregate dimensions', () => {
    expect(() => ReusableTopicPlaceholderQuerySchema.parse({ assistantId: 'unlinked' })).toThrow()
    expect(() => ReusableTopicPlaceholderQuerySchema.parse({ assistantId: 'unassigned', pinned: false })).toThrow(
      /unrecognized/i
    )
  })
})

describe('CreateTopicSchema', () => {
  it('accepts UUID assistant ownership and rejects legacy sentinels or arbitrary ids', () => {
    const assistantId = '11111111-1111-4111-8111-111111111111'
    expect(CreateTopicSchema.parse({ assistantId })).toEqual({ assistantId })
    expect(CreateTopicSchema.safeParse({ assistantId: 'default' }).success).toBe(false)
    expect(CreateTopicSchema.safeParse({ assistantId: 'assistant-1' }).success).toBe(false)
  })

  it.each(['sourceNodeId', 'groupId'])('rejects unsupported key %s', (key) => {
    expect(() => CreateTopicSchema.parse({ [key]: 'value' })).toThrow(/unrecognized/i)
  })
})

describe('UpdateTopicSchema', () => {
  // Pin state and ordering must NOT be mutable through PATCH /topics/:id —
  // pin/unpin goes through /pins endpoints; reorder goes through /:id/order.
  // Schema is strict (inherited from TopicSchema.strictObject), so disallowed
  // keys throw a ZodError; pinning that behavior so a refactor to non-strict
  // (z.object / .passthrough()) is caught.
  it.each(['sortOrder', 'isPinned', 'pinnedOrder', 'orderKey', 'groupId'])('throws on disallowed key %s', (key) => {
    expect(() => UpdateTopicSchema.parse({ name: 'x', [key]: 99 })).toThrow(/unrecognized/i)
  })

  it('accepts allowed fields', () => {
    const assistantId = '11111111-1111-4111-8111-111111111111'
    const parsed = UpdateTopicSchema.parse({
      name: 'n',
      isNameManuallyEdited: true,
      assistantId
    })
    expect(parsed).toEqual({ name: 'n', isNameManuallyEdited: true, assistantId })
  })

  it('accepts null assistantId to clear default-assistant ownership', () => {
    expect(UpdateTopicSchema.parse({ assistantId: null })).toEqual({ assistantId: null })
  })

  it('rejects legacy sentinels and arbitrary assistant ids', () => {
    expect(UpdateTopicSchema.safeParse({ assistantId: 'default' }).success).toBe(false)
    expect(UpdateTopicSchema.safeParse({ assistantId: 'assistant-1' }).success).toBe(false)
  })
})

describe('SetActiveNodeSchema', () => {
  // descend was removed pending the ai-service merge (its renderer call sites
  // live there). Pinning the current shape here so a re-add without consumers
  // is caught by CI.
  it('rejects unknown keys (strict object)', () => {
    expect(() => SetActiveNodeSchema.parse({ nodeId: 'n1', descend: true })).toThrow()
  })

  it('accepts nodeId only', () => {
    expect(SetActiveNodeSchema.parse({ nodeId: 'n1' })).toEqual({ nodeId: 'n1' })
  })
})

describe('DuplicateTopicSchema', () => {
  it('accepts nodeId only', () => {
    expect(DuplicateTopicSchema.parse({ nodeId: 'n1' })).toEqual({
      nodeId: 'n1'
    })
  })

  it('accepts an optional trimmed name', () => {
    expect(DuplicateTopicSchema.parse({ nodeId: 'n1', name: '  Source (Copy)  ' })).toEqual({
      nodeId: 'n1',
      name: 'Source (Copy)'
    })
  })

  it('rejects blank or overlong names', () => {
    expect(() => DuplicateTopicSchema.parse({ nodeId: 'n1', name: '   ' })).toThrow()
    expect(() => DuplicateTopicSchema.parse({ nodeId: 'n1', name: 'x'.repeat(256) })).toThrow()
  })

  it('rejects unknown keys', () => {
    expect(() => DuplicateTopicSchema.parse({ nodeId: 'n1', includeDescendants: true })).toThrow()
  })
})
