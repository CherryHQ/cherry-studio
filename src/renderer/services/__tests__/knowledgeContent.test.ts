import { describe, expect, it, vi } from 'vitest'

import { processMessagesContent } from '@renderer/services/knowledgeContent'
import type { ExportableMessage } from '@renderer/types/messageExport'
import { CONTENT_TYPES } from '@renderer/utils/knowledge'

vi.mock('@renderer/hooks/useTopic', () => ({
  getTopicMessages: vi.fn()
}))

const message = (role: 'user' | 'assistant', text: string): ExportableMessage => ({
  id: `message-${role}`,
  role,
  topicId: 'topic-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  status: 'success',
  parts: [{ type: 'text', text }]
})

describe('processMessagesContent', () => {
  it('omits the title when the user did not select text content', () => {
    const result = processMessagesContent('采购管理', [message('user', 'hi')], [CONTENT_TYPES.CODE])

    expect(result.text).not.toContain('采购管理')
  })
})
