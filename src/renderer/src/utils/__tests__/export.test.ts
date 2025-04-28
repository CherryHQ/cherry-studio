import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getTitleFromString, messagesToMarkdown, messageToMarkdown, messageToMarkdownWithReasoning } from '../export'

// 辅助函数：生成完整 Message 对象
function createMessage(partial) {
  return {
    id: partial.id || 'id',
    assistantId: partial.assistantId || 'a',
    role: partial.role,
    content: partial.content,
    topicId: partial.topicId || 't',
    createdAt: partial.createdAt || '2024-01-01',
    updatedAt: partial.updatedAt || 0,
    status: partial.status || 'success',
    type: partial.type || 'text',
    ...partial
  }
}

describe('export', () => {
  describe('getTitleFromString', () => {
    it('should extract first line before punctuation', () => {
      expect(getTitleFromString('标题。其余内容')).toBe('标题')
      expect(getTitleFromString('标题，其余内容')).toBe('标题')
      expect(getTitleFromString('标题.其余内容')).toBe('标题')
      expect(getTitleFromString('标题,其余内容')).toBe('标题')
    })

    it('should extract first line if no punctuation', () => {
      expect(getTitleFromString('第一行\n第二行')).toBe('第一行')
    })

    it('should truncate if too long', () => {
      expect(getTitleFromString('a'.repeat(100), 10)).toBe('a'.repeat(10))
    })

    it('should return slice if first line empty', () => {
      expect(getTitleFromString('\nabc', 2)).toBe('ab')
    })

    it('should handle empty string', () => {
      expect(getTitleFromString('', 5)).toBe('')
    })

    it('should handle only punctuation', () => {
      expect(getTitleFromString('。', 5)).toBe('。')
    })

    it('should handle only whitespace', () => {
      expect(getTitleFromString('   ', 2)).toBe('  ')
    })

    it('should handle non-ascii', () => {
      expect(getTitleFromString('你好，世界')).toBe('你好')
    })
  })

  describe('messageToMarkdown', () => {
    beforeEach(() => {
      vi.resetModules()
      vi.doMock('@renderer/store', () => ({
        default: { getState: () => ({ settings: { forceDollarMathInMarkdown: false } }) }
      }))
    })

    it('should format user message', () => {
      const msg = createMessage({ role: 'user', content: 'hello', id: '1' })
      expect(messageToMarkdown(msg)).toContain('### 🧑‍💻 User')
      expect(messageToMarkdown(msg)).toContain('hello')
    })

    it('should format assistant message', () => {
      const msg = createMessage({ role: 'assistant', content: 'hi', id: '2' })
      expect(messageToMarkdown(msg)).toContain('### 🤖 Assistant')
      expect(messageToMarkdown(msg)).toContain('hi')
    })
  })

  describe('messageToMarkdownWithReasoning', () => {
    beforeEach(() => {
      vi.resetModules()
      vi.doMock('@renderer/store', () => ({
        default: { getState: () => ({ settings: { forceDollarMathInMarkdown: false } }) }
      }))
      vi.doMock('@renderer/i18n', () => ({
        default: { t: (k: string) => k }
      }))
    })

    it('should include reasoning content in details', () => {
      const msg = createMessage({ role: 'assistant', content: 'hi', reasoning_content: '思考内容', id: '5' })
      expect(messageToMarkdownWithReasoning(msg)).toContain('<details')
      expect(messageToMarkdownWithReasoning(msg)).toContain('思考内容')
    })

    it('should handle <think> tag and newlines', () => {
      const msg = createMessage({ role: 'assistant', content: 'hi', reasoning_content: '<think>\nA\nB', id: '6' })
      expect(messageToMarkdownWithReasoning(msg)).toContain('A<br>B')
    })

    it('should fallback if no reasoning_content', () => {
      const msg = createMessage({ role: 'assistant', content: 'hi', id: '7' })
      expect(messageToMarkdownWithReasoning(msg)).toContain('hi')
    })
  })

  describe('messagesToMarkdown', () => {
    beforeEach(() => {
      vi.resetModules()
      vi.doMock('@renderer/store', () => ({
        default: { getState: () => ({ settings: { forceDollarMathInMarkdown: false } }) }
      }))
    })

    it('should join multiple messages', () => {
      const msgs = [
        createMessage({ role: 'user', content: 'a', id: '9' }),
        createMessage({ role: 'assistant', content: 'b', id: '10' })
      ]
      expect(messagesToMarkdown(msgs)).toContain('a')
      expect(messagesToMarkdown(msgs)).toContain('b')
      expect(messagesToMarkdown(msgs).split('---').length).toBe(2)
    })

    it('should handle empty array', () => {
      expect(messagesToMarkdown([])).toBe('')
    })

    it('should handle single message', () => {
      const msgs = [createMessage({ role: 'user', content: 'a', id: '13' })]
      expect(messagesToMarkdown(msgs)).toContain('a')
    })
  })
})
