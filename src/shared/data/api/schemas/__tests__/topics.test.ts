import { describe, expect, it } from 'vitest'

import {
  CreateTopicSchema,
  DeleteTopicQuerySchema,
  DeleteTopicsQuerySchema,
  DuplicateTopicSchema,
  ListTopicsQuerySchema,
  RestoreTopicsQuerySchema,
  SetActiveNodeSchema,
  UpdateTopicSchema
} from '../topics'

describe('CreateTopicSchema', () => {
  it('rejects sourceNodeId reference-fork input', () => {
    expect(() => CreateTopicSchema.parse({ sourceNodeId: 'n1' })).toThrow()
  })
})

describe('UpdateTopicSchema', () => {
  // Pin state and ordering must NOT be mutable through PATCH /topics/:id —
  // pin/unpin goes through /pins endpoints; reorder goes through /:id/order.
  // Schema is strict (inherited from TopicSchema.strictObject), so disallowed
  // keys throw a ZodError; pinning that behavior so a refactor to non-strict
  // (z.object / .passthrough()) is caught.
  it.each(['sortOrder', 'isPinned', 'pinnedOrder', 'orderKey'])('throws on disallowed key %s', (key) => {
    expect(() => UpdateTopicSchema.parse({ name: 'x', [key]: 99 })).toThrow(/unrecognized/i)
  })

  it('accepts allowed fields', () => {
    const parsed = UpdateTopicSchema.parse({
      name: 'n',
      isNameManuallyEdited: true,
      assistantId: 'a1',
      groupId: 'g1'
    })
    expect(parsed).toEqual({ name: 'n', isNameManuallyEdited: true, assistantId: 'a1', groupId: 'g1' })
  })

  it('accepts null assistantId to clear default-assistant ownership', () => {
    expect(UpdateTopicSchema.parse({ assistantId: null })).toEqual({ assistantId: null })
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

describe('deletedAt is read-only', () => {
  // deletedAt is set via DELETE (archive) and cleared via the restore endpoints;
  // it must never be writable through the Create/Update DTOs.
  it('CreateTopicSchema rejects deletedAt', () => {
    expect(() => CreateTopicSchema.parse({ name: 'n', deletedAt: '2026-07-04T00:00:00.000Z' })).toThrow(/unrecognized/i)
  })

  it('UpdateTopicSchema rejects deletedAt', () => {
    expect(() => UpdateTopicSchema.parse({ deletedAt: null })).toThrow(/unrecognized/i)
  })
})

describe('ListTopicsQuerySchema', () => {
  it('accepts a boolean inTrash and defaults to absent', () => {
    expect(ListTopicsQuerySchema.parse({ inTrash: true })).toEqual({ inTrash: true })
    expect(ListTopicsQuerySchema.parse({})).toEqual({})
  })

  it('rejects a non-boolean inTrash (plain z.boolean, no coercion)', () => {
    expect(() => ListTopicsQuerySchema.parse({ inTrash: 'true' })).toThrow()
  })
})

describe('DeleteTopicsQuerySchema / DeleteTopicQuerySchema', () => {
  it('accepts an optional boolean permanent flag', () => {
    expect(DeleteTopicsQuerySchema.parse({ ids: 'a,b', permanent: true })).toEqual({
      ids: ['a', 'b'],
      permanent: true
    })
    expect(DeleteTopicQuerySchema.parse({})).toEqual({})
    expect(DeleteTopicQuerySchema.parse({ permanent: true })).toEqual({ permanent: true })
  })

  it('rejects a non-boolean permanent (plain z.boolean, no coercion)', () => {
    expect(() => DeleteTopicsQuerySchema.parse({ ids: 'a', permanent: 'true' })).toThrow()
    expect(() => DeleteTopicQuerySchema.parse({ permanent: 1 })).toThrow()
  })
})

describe('RestoreTopicsQuerySchema', () => {
  it('parses trimmed CSV ids', () => {
    expect(RestoreTopicsQuerySchema.parse({ ids: ' a, , b ' })).toEqual({ ids: ['a', 'b'] })
  })

  it('rejects an empty ids list', () => {
    expect(() => RestoreTopicsQuerySchema.parse({ ids: ' , ' })).toThrow()
  })
})
