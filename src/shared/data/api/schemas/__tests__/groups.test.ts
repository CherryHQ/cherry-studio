import { describe, expect, it } from 'vitest'

import { GroupSchema } from '../../../types/group'
import { CreateGroupSchema, UpdateGroupSchema } from '../groups'

describe('group schemas', () => {
  it('represents migrated long names while keeping regular mutations capped at 64 characters', () => {
    const longName = 'x'.repeat(65)
    const group = {
      id: '11111111-1111-4111-8111-111111111111',
      entityType: 'assistant',
      name: longName,
      orderKey: 'a0',
      createdAt: '2026-07-16T00:00:00.000Z',
      updatedAt: '2026-07-16T00:00:00.000Z'
    }

    expect(GroupSchema.parse(group)).toEqual(group)
    expect(CreateGroupSchema.safeParse({ entityType: 'assistant', name: longName }).success).toBe(false)
    expect(UpdateGroupSchema.safeParse({ name: longName }).success).toBe(false)
  })
})
