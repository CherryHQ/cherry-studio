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

  describe('workspaceRoot', () => {
    it('accepts a POSIX absolute path', () => {
      expect(UpdateTopicSchema.parse({ workspaceRoot: '/Users/me/proj' })).toEqual({
        workspaceRoot: '/Users/me/proj'
      })
    })

    it('accepts a Windows absolute path with drive letter', () => {
      expect(UpdateTopicSchema.parse({ workspaceRoot: 'C:\\Users\\me' })).toEqual({
        workspaceRoot: 'C:\\Users\\me'
      })
      expect(UpdateTopicSchema.parse({ workspaceRoot: 'D:/proj' })).toEqual({
        workspaceRoot: 'D:/proj'
      })
    })

    it('rejects relative paths', () => {
      expect(() => UpdateTopicSchema.parse({ workspaceRoot: 'relative/path' })).toThrow(/absolute path/i)
      expect(() => UpdateTopicSchema.parse({ workspaceRoot: './foo' })).toThrow(/absolute path/i)
      expect(() => UpdateTopicSchema.parse({ workspaceRoot: '../foo' })).toThrow(/absolute path/i)
    })

    it('rejects bare drive letter without separator', () => {
      expect(() => UpdateTopicSchema.parse({ workspaceRoot: 'C:foo' })).toThrow(/absolute path/i)
    })

    it('treats empty string as null (unbind)', () => {
      expect(UpdateTopicSchema.parse({ workspaceRoot: '' })).toEqual({ workspaceRoot: null })
    })

    it('accepts explicit null (unbind)', () => {
      expect(UpdateTopicSchema.parse({ workspaceRoot: null })).toEqual({ workspaceRoot: null })
    })

    it('accepts omitted (no change)', () => {
      expect(UpdateTopicSchema.parse({ name: 'x' })).toEqual({ name: 'x' })
    })
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
