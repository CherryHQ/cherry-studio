import { describe, expect, it, vi } from 'vitest'

import type { ExportableMessage } from '@renderer/types/messageExport'

import { CONTENT_TYPES, processMessageContent } from '../knowledge'

vi.mock('@renderer/hooks/useTopic', () => ({
  getTopicMessages: vi.fn()
}))

const message = (parts: unknown[]): ExportableMessage =>
  ({
    id: 'message-1',
    role: 'assistant',
    topicId: 'topic-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    status: 'success',
    parts
  }) as ExportableMessage

describe('processMessageContent', () => {
  it('converts file part URLs to absolute filesystem paths for file metadata', () => {
    const result = processMessageContent(
      message([
        {
          type: 'file',
          url: 'file:///tmp/report%20final.pdf',
          filename: 'report final.pdf',
          mediaType: 'application/pdf'
        }
      ]),
      [CONTENT_TYPES.FILE]
    )

    expect(result.files).toEqual([
      expect.objectContaining({
        name: 'report final.pdf',
        path: '/tmp/report final.pdf',
        type: 'application/pdf'
      })
    ])
  })

  it('keeps the fence and language tag on code parts', () => {
    const result = processMessageContent(
      message([{ type: 'data-code', data: { language: 'typescript', content: 'const a = 1' } }]),
      [CONTENT_TYPES.CODE]
    )

    expect(result.text).toBe('```typescript\nconst a = 1\n```')
  })

  it('drops the part types the user did not select', () => {
    const result = processMessageContent(
      message([
        { type: 'text', text: 'answer' },
        { type: 'data-code', data: { language: 'ts', content: 'const a = 1' } },
        { type: 'data-error', data: { name: 'ApiError', message: 'boom' } }
      ]),
      [CONTENT_TYPES.TEXT]
    )

    expect(result.text).toBe('answer')
  })
})
