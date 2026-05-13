import { describe, expect, it } from 'vitest'

import { SetActiveNodeSchema, UpdateTopicSchema } from '../topics'

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
