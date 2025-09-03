import type { Topic } from '@renderer/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CONTENT_TYPES } from '../knowledge'

// Simple mocks
vi.mock('@renderer/hooks/useTopic', () => ({
  TopicManager: {
    getTopicMessages: vi.fn()
  }
}))

describe('Topic Knowledge Functions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const createTestTopic = (): Topic => ({
    id: 'test-topic-1',
    assistantId: 'test-assistant',
    name: 'Test Topic',
    createdAt: '2023-01-01T00:00:00Z',
    updatedAt: '2023-01-01T00:00:00Z',
    messages: []
  })

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

  describe('Topic Data Structure', () => {
    it('should create valid topic structure', () => {
      const topic = createTestTopic()

      expect(topic).toHaveProperty('id')
      expect(topic).toHaveProperty('name')
      expect(topic).toHaveProperty('assistantId')
      expect(topic).toHaveProperty('createdAt')
      expect(topic).toHaveProperty('updatedAt')
      expect(topic).toHaveProperty('messages')
      expect(Array.isArray(topic.messages)).toBe(true)
    })
  })

  describe('Topic Knowledge Functions Integration', () => {
    it('should be importable without circular dependencies', async () => {
      // This test verifies that the knowledge functions can be imported
      // without causing circular dependency issues
      const knowledgeModule = await import('../knowledge')

      expect(knowledgeModule).toHaveProperty('analyzeTopicContent')
      expect(knowledgeModule).toHaveProperty('processTopicContent')
      expect(knowledgeModule).toHaveProperty('CONTENT_TYPES')
      expect(typeof knowledgeModule.analyzeTopicContent).toBe('function')
      expect(typeof knowledgeModule.processTopicContent).toBe('function')
    })

    it('should handle TopicManager mock correctly', async () => {
      const { TopicManager } = await import('@renderer/hooks/useTopic')
      expect(TopicManager).toHaveProperty('getTopicMessages')
      expect(typeof TopicManager.getTopicMessages).toBe('function')
    })
  })
})
