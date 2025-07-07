import { Message, Topic } from '@renderer/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { copyMessageAsPlainText, copyTopicAsMarkdown, copyTopicAsPlainText } from '../copy'

// Mock dependencies
vi.mock('@renderer/utils/export', () => ({
  topicToMarkdown: vi.fn(),
  topicToPlainText: vi.fn(),
  messageToPlainText: vi.fn()
}))

vi.mock('i18next', () => ({
  default: {
    t: vi.fn((key) => key)
  }
}))

// Mock navigator.clipboard
const mockClipboard = {
  writeText: vi.fn()
}

// Mock window.message
const mockMessage = {
  success: vi.fn()
}

// 创建测试数据辅助函数
function createTestTopic(partial: Partial<Topic> = {}): Topic {
  return {
    id: 'test-topic-id',
    assistantId: 'test-assistant-id',
    name: 'Test Topic',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages: [],
    ...partial
  }
}

function createTestMessage(partial: Partial<Message> = {}): Message {
  return {
    id: 'test-message-id',
    role: 'user',
    assistantId: 'test-assistant-id',
    topicId: 'test-topic-id',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'success',
    blocks: [],
    ...partial
  } as Message
}

describe('copy', () => {
  beforeEach(() => {
    // 设置全局 mocks
    Object.defineProperty(global.navigator, 'clipboard', {
      value: mockClipboard,
      writable: true
    })

    Object.defineProperty(global.window, 'message', {
      value: mockMessage,
      writable: true
    })

    // 清理所有 mock 调用
    vi.clearAllMocks()
  })

  describe('copyTopicAsMarkdown', () => {
    it('should copy topic as markdown successfully', async () => {
      // 准备测试数据
      const topic = createTestTopic()
      const markdownContent = '# Test Topic\n\nContent here...'

      const { topicToMarkdown } = await import('@renderer/utils/export')
      vi.mocked(topicToMarkdown).mockResolvedValue(markdownContent)
      mockClipboard.writeText.mockResolvedValue(undefined)

      // 执行测试
      await copyTopicAsMarkdown(topic)

      // 验证结果
      expect(topicToMarkdown).toHaveBeenCalledWith(topic)
      expect(mockClipboard.writeText).toHaveBeenCalledWith(markdownContent)
      expect(mockMessage.success).toHaveBeenCalledWith('message.copy.success')
    })

    it('should handle export function errors', async () => {
      // 测试导出函数错误
      const topic = createTestTopic()
      const { topicToMarkdown } = await import('@renderer/utils/export')
      vi.mocked(topicToMarkdown).mockRejectedValue(new Error('Export error'))

      await expect(copyTopicAsMarkdown(topic)).rejects.toThrow('Export error')
      expect(mockClipboard.writeText).not.toHaveBeenCalled()
      expect(mockMessage.success).not.toHaveBeenCalled()
    })

    it('should handle clipboard write errors', async () => {
      // 测试剪贴板写入错误
      const topic = createTestTopic()
      const markdownContent = '# Test Topic'

      const { topicToMarkdown } = await import('@renderer/utils/export')
      vi.mocked(topicToMarkdown).mockResolvedValue(markdownContent)
      mockClipboard.writeText.mockRejectedValue(new Error('Clipboard error'))

      await expect(copyTopicAsMarkdown(topic)).rejects.toThrow('Clipboard error')
      expect(mockMessage.success).not.toHaveBeenCalled()
    })
  })

  describe('copyTopicAsPlainText', () => {
    it('should copy topic as plain text successfully', async () => {
      // 测试成功复制纯文本
      const topic = createTestTopic()
      const plainTextContent = 'Test Topic\n\nPlain text content...'

      const { topicToPlainText } = await import('@renderer/utils/export')
      vi.mocked(topicToPlainText).mockResolvedValue(plainTextContent)
      mockClipboard.writeText.mockResolvedValue(undefined)

      await copyTopicAsPlainText(topic)

      expect(topicToPlainText).toHaveBeenCalledWith(topic)
      expect(mockClipboard.writeText).toHaveBeenCalledWith(plainTextContent)
      expect(mockMessage.success).toHaveBeenCalledWith('message.copy.success')
    })

    it('should handle export function errors', async () => {
      // 测试导出函数错误
      const topic = createTestTopic()
      const { topicToPlainText } = await import('@renderer/utils/export')
      vi.mocked(topicToPlainText).mockRejectedValue(new Error('Export error'))

      await expect(copyTopicAsPlainText(topic)).rejects.toThrow('Export error')
      expect(mockClipboard.writeText).not.toHaveBeenCalled()
      expect(mockMessage.success).not.toHaveBeenCalled()
    })
  })

  describe('copyMessageAsPlainText', () => {
    it('should copy message as plain text successfully', async () => {
      // 测试成功复制消息纯文本
      const message = createTestMessage()
      const plainTextContent = 'This is the plain text content of the message'

      const { messageToPlainText } = await import('@renderer/utils/export')
      vi.mocked(messageToPlainText).mockReturnValue(plainTextContent)
      mockClipboard.writeText.mockResolvedValue(undefined)

      await copyMessageAsPlainText(message)

      expect(messageToPlainText).toHaveBeenCalledWith(message)
      expect(mockClipboard.writeText).toHaveBeenCalledWith(plainTextContent)
      expect(mockMessage.success).toHaveBeenCalledWith('message.copy.success')
    })

    it('should handle messageToPlainText errors', async () => {
      // 测试消息转换错误
      const message = createTestMessage()
      const { messageToPlainText } = await import('@renderer/utils/export')
      vi.mocked(messageToPlainText).mockImplementation(() => {
        throw new Error('Message conversion error')
      })

      await expect(copyMessageAsPlainText(message)).rejects.toThrow('Message conversion error')
      expect(mockClipboard.writeText).not.toHaveBeenCalled()
      expect(mockMessage.success).not.toHaveBeenCalled()
    })
  })

  describe('edge cases', () => {
    it('should handle null or undefined inputs gracefully', async () => {
      // 测试null/undefined输入的错误处理
      const { topicToMarkdown, topicToPlainText, messageToPlainText } = await import('@renderer/utils/export')

      vi.mocked(topicToMarkdown).mockRejectedValue(new Error('Cannot read properties of null'))
      vi.mocked(topicToPlainText).mockRejectedValue(new Error('Cannot read properties of undefined'))
      vi.mocked(messageToPlainText).mockImplementation(() => {
        throw new Error('Cannot read properties of null')
      })

      // @ts-expect-error 测试类型错误
      await expect(copyTopicAsMarkdown(null)).rejects.toThrow('Cannot read properties of null')
      // @ts-expect-error 测试类型错误
      await expect(copyTopicAsPlainText(undefined)).rejects.toThrow('Cannot read properties of undefined')
      // @ts-expect-error 测试类型错误
      await expect(copyMessageAsPlainText(null)).rejects.toThrow('Cannot read properties of null')
    })
  })
})
