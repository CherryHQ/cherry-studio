import { describe, expect, it, vi } from 'vitest'

import { CONTENT_TYPES, processMessageContent } from '../knowledge'

vi.mock('@renderer/hooks/useTopic', () => ({
  getTopicMessages: vi.fn()
}))

describe('Topic Knowledge Functions', () => {
  describe('CONTENT_TYPES', () => {
    it('should have all expected content types', () => {
      expect(CONTENT_TYPES.TEXT).toBe('text')
      expect(CONTENT_TYPES.CODE).toBe('code')
      expect(CONTENT_TYPES.THINKING).toBe('thinking')
      expect(CONTENT_TYPES.TOOL_USE).toBe('tools')
      expect(CONTENT_TYPES.CITATION).toBe('citations')
      expect(CONTENT_TYPES.TRANSLATION).toBe('translations')
      expect(CONTENT_TYPES.ERROR).toBe('errors')
      expect(CONTENT_TYPES.FILE).toBe('files')
      expect(CONTENT_TYPES.IMAGES).toBe('images')
    })
  })

  describe('Topic Knowledge Functions Integration', () => {
    it('should be importable without circular dependencies', async () => {
      // This test verifies that the knowledge functions can be imported
      // without causing circular dependency issues
      const knowledgeModule = await import('../knowledge')
      const knowledgeContentModule = await import('@renderer/services/knowledgeContent')

      expect(knowledgeContentModule).toHaveProperty('analyzeTopicContent')
      expect(knowledgeContentModule).toHaveProperty('processTopicContent')
      expect(knowledgeModule).toHaveProperty('CONTENT_TYPES')
      expect(typeof knowledgeContentModule.analyzeTopicContent).toBe('function')
      expect(typeof knowledgeContentModule.processTopicContent).toBe('function')
    })
  })

  describe('processMessageContent', () => {
    it('converts file part URLs to absolute filesystem paths for file metadata', () => {
      const result = processMessageContent(
        {
          id: 'message-1',
          role: 'user',
          topicId: 'topic-1',
          createdAt: '2026-01-01T00:00:00.000Z',
          status: 'success',
          parts: [
            {
              type: 'file',
              url: 'file:///tmp/report%20final.pdf',
              filename: 'report final.pdf',
              mediaType: 'application/pdf'
            }
          ]
        },
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
  })
})
