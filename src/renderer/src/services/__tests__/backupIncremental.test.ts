import type { Message } from '@renderer/types'
import { UserMessageStatus } from '@renderer/types/newMessage'
import { describe, expect, it } from 'vitest'

import { mergeMessagesByUpdatedAt } from '../BackupService'

const makeMessage = (overrides: Partial<Message>): Message => {
  return {
    id: overrides.id || 'message-id',
    role: 'user',
    assistantId: 'assistant-id',
    topicId: 'topic-id',
    createdAt: overrides.createdAt || new Date().toISOString(),
    updatedAt: overrides.updatedAt,
    status: UserMessageStatus.SUCCESS,
    blocks: [],
    ...overrides
  }
}

describe('mergeMessagesByUpdatedAt', () => {
  it('优先保留更新时间更新的消息', () => {
    const existing = makeMessage({
      id: 'm1',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z'
    })
    const incoming = makeMessage({
      id: 'm1',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-02T00:00:00.000Z'
    })

    const result = mergeMessagesByUpdatedAt([existing], [incoming])

    expect(result).toHaveLength(1)
    expect(result[0].updatedAt).toBe('2025-01-02T00:00:00.000Z')
  })

  it('合并新增消息并保持创建时间排序', () => {
    const existing = makeMessage({ id: 'm1', createdAt: '2025-01-01T00:00:00.000Z' })
    const incoming = makeMessage({ id: 'm2', createdAt: '2025-01-02T00:00:00.000Z' })

    const result = mergeMessagesByUpdatedAt([existing], [incoming])

    expect(result.map((message) => message.id)).toEqual(['m1', 'm2'])
  })
})
