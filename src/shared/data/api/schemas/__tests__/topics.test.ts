import { describe, expect, it } from 'vitest'

import {
  CreateTopicSchema,
  DuplicateTopicSchema,
  ListTopicsQuerySchema,
  MoveTopicSchema,
  SetActiveNodeSchema,
  TopicStatsQuerySchema,
  UpdateTopicSchema
} from '../topics'

describe('CreateTopicSchema', () => {
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
    const parsed = UpdateTopicSchema.parse({
      name: 'n',
      isNameManuallyEdited: true,
      assistantId: 'a1'
    })
    expect(parsed).toEqual({ name: 'n', isNameManuallyEdited: true, assistantId: 'a1' })
  })

  it('accepts null assistantId to clear default-assistant ownership', () => {
    expect(UpdateTopicSchema.parse({ assistantId: null })).toEqual({ assistantId: null })
  })
})

describe('MoveTopicSchema', () => {
  it('requires owner and order together', () => {
    expect(MoveTopicSchema.parse({ assistantId: null, order: { before: 'topic-2' } })).toEqual({
      assistantId: null,
      order: { before: 'topic-2' }
    })
    expect(() => MoveTopicSchema.parse({ assistantId: null })).toThrow()
    expect(() => MoveTopicSchema.parse({ order: { position: 'first' } })).toThrow()
  })

  it('accepts UUID owners and rejects malformed owner ids', () => {
    const assistantId = '11111111-1111-4111-8111-111111111111'
    expect(MoveTopicSchema.parse({ assistantId, order: { position: 'last' } })).toEqual({
      assistantId,
      order: { position: 'last' }
    })
    expect(() => MoveTopicSchema.parse({ assistantId: 'assistant-1', order: { position: 'last' } })).toThrow()
  })
})

describe('ListTopicsQuerySchema', () => {
  it('accepts cursor/limit/q without sortBy (ordinary stream defaults to createdAt)', () => {
    expect(ListTopicsQuerySchema.parse({ q: 'x', limit: 10 })).toEqual({ q: 'x', limit: 10 })
  })

  it.each([{ assistantId: 'unlinked' }, { ids: ['t1'] }])('accepts record filter %j without sortBy', (filter) => {
    expect(ListTopicsQuerySchema.parse(filter)).toMatchObject(filter)
    expect(ListTopicsQuerySchema.parse({ sortBy: 'updatedAt', ...filter })).toMatchObject(filter)
  })

  it('accepts immutable creation order and rejects an unknown sortBy value or non-uuid owner scope', () => {
    expect(ListTopicsQuerySchema.parse({ sortBy: 'createdAt' })).toEqual({ sortBy: 'createdAt' })
    expect(() => ListTopicsQuerySchema.parse({ sortBy: 'name' })).toThrow()
    expect(() => ListTopicsQuerySchema.parse({ sortBy: 'updatedAt', assistantId: 'not-a-uuid' })).toThrow()
  })

  it('accepts searchScope name/name-or-owner and rejects an unknown scope', () => {
    expect(ListTopicsQuerySchema.parse({ q: 'x', searchScope: 'name' })).toMatchObject({ searchScope: 'name' })
    expect(ListTopicsQuerySchema.parse({ q: 'x', searchScope: 'name-or-owner' })).toMatchObject({
      searchScope: 'name-or-owner'
    })
    expect(() => ListTopicsQuerySchema.parse({ q: 'x', searchScope: 'full' })).toThrow()
  })

  it.each(['updatedAtFrom', 'updatedAtTo'])('rejects removed date-window filter %s', (key) => {
    expect(() => ListTopicsQuerySchema.parse({ sortBy: 'updatedAt', [key]: 1 })).toThrow(/unrecognized/i)
    expect(() => TopicStatsQuerySchema.parse({ [key]: 1 })).toThrow(/unrecognized/i)
  })

  it('accepts the pin-owned stream without sortBy and rejects pinOrderKey', () => {
    expect(ListTopicsQuerySchema.parse({ pinned: true, assistantId: 'unlinked' })).toEqual({
      pinned: true,
      assistantId: 'unlinked'
    })
    expect(ListTopicsQuerySchema.parse({ sortBy: 'updatedAt', pinned: true })).toEqual({
      sortBy: 'updatedAt',
      pinned: true
    })
    expect(() => ListTopicsQuerySchema.parse({ sortBy: 'pinOrderKey', pinned: true })).toThrow()
  })
})

describe('TopicStatsQuerySchema', () => {
  it('rejects cursor/limit/sortBy/pinned — stats take record filters only', () => {
    expect(() => TopicStatsQuerySchema.parse({ cursor: 'x' })).toThrow()
    expect(() => TopicStatsQuerySchema.parse({ limit: 10 })).toThrow()
    expect(() => TopicStatsQuerySchema.parse({ sortBy: 'updatedAt' })).toThrow()
    expect(() => TopicStatsQuerySchema.parse({ pinned: true })).toThrow()
  })

  it('rejects the list-only ids filter', () => {
    expect(() => TopicStatsQuerySchema.parse({ ids: ['topic-1'] })).toThrow(/unrecognized/i)
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
