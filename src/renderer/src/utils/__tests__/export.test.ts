// Import Message, MessageBlock, and necessary enums
import type { Message, MessageBlock } from '@renderer/types/newMessage'
import { AssistantMessageStatus, MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// --- Mocks Setup ---

// Add this before the test suites
vi.mock('@renderer/config/minapps', () => {
  return {
    ORIGIN_DEFAULT_MIN_APPS: [],
    DEFAULT_MIN_APPS: [],
    loadCustomMiniApp: async () => [],
    updateDefaultMinApps: vi.fn()
  }
})

// Mock window.api
beforeEach(() => {
  Object.defineProperty(window, 'api', {
    value: {
      file: {
        read: vi.fn().mockResolvedValue('[]'),
        writeWithId: vi.fn()
      }
    },
    configurable: true
  })
})

// Mock i18n at the top level using vi.mock
vi.mock('@renderer/i18n', () => ({
  default: {
    t: vi.fn((k: string) => k) // Pass-through mock using vi.fn
  }
}))

// Mock the find utility functions - crucial for the test
vi.mock('@renderer/utils/messageUtils/find', () => ({
  // Provide type safety for mocked message
  getMainTextContent: vi.fn((message: Message & { _fullBlocks?: MessageBlock[] }) => {
    const mainTextBlock = message._fullBlocks?.find((b) => b.type === MessageBlockType.MAIN_TEXT)
    return mainTextBlock?.content || '' // Assuming content exists on MainTextBlock
  }),
  getThinkingContent: vi.fn((message: Message & { _fullBlocks?: MessageBlock[] }) => {
    const thinkingBlock = message._fullBlocks?.find((b) => b.type === MessageBlockType.THINKING)
    // Assuming content exists on ThinkingBlock
    // Need to cast block to access content if not on base type
    return (thinkingBlock as any)?.content || ''
  }),
  getCitationContent: vi.fn((message: Message & { _fullBlocks?: MessageBlock[] }) => {
    const citationBlocks = message._fullBlocks?.filter((b) => b.type === MessageBlockType.CITATION) || []
    // Return empty string if no citation blocks, otherwise mock citation content
    if (citationBlocks.length === 0) return ''
    // Mock citation format: [number] [url](title)
    return citationBlocks
      .map((_, index) => `[${index + 1}] [https://example${index + 1}.com](Example Citation ${index + 1})`)
      .join('\n\n')
  })
}))

vi.mock('@renderer/databases', () => ({
  default: {
    topics: {
      get: vi.fn()
    }
  }
}))

vi.mock('@renderer/utils/markdown', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...(actual as any),
    markdownToPlainText: vi.fn((str) => str) // Simple pass-through for testing export logic
  }
})

// Import the functions to test AFTER setting up mocks
import db from '@renderer/databases'
import { Topic } from '@renderer/types'
import { markdownToPlainText } from '@renderer/utils/markdown'

import { copyMessageAsPlainText } from '../copy'
import {
  getTitleFromString,
  messagesToMarkdown,
  messageToMarkdown,
  messageToMarkdownWithReasoning,
  messageToPlainText,
  topicToPlainText
} from '../export'

// --- Helper Functions for Test Data ---

// Helper function: Create a message block
// Type for partialBlock needs to allow various block properties
// Remove messageId requirement from the input type, as it's passed separately
type PartialBlockInput = Partial<MessageBlock> & { type: MessageBlockType; content?: string }

// Add explicit messageId parameter to createBlock
function createBlock(messageId: string, partialBlock: PartialBlockInput): MessageBlock {
  const blockId = partialBlock.id || `block-${Math.random().toString(36).substring(7)}`
  // Base structure, assuming all required fields are provided or defaulted
  const baseBlock = {
    id: blockId,
    messageId: messageId, // Use the passed messageId
    type: partialBlock.type,
    createdAt: partialBlock.createdAt || '2024-01-01T00:00:00Z',
    status: partialBlock.status || MessageBlockStatus.SUCCESS
    // Add other base fields if they become required
  }

  // Conditionally add content if provided, satisfying MessageBlock union
  const blockData = { ...baseBlock }
  if ('content' in partialBlock && partialBlock.content !== undefined) {
    blockData['content'] = partialBlock.content
  }
  // Add logic for other block-specific required fields if needed

  // Use type assertion carefully, ensure the object matches one of the union types
  return blockData as MessageBlock
}

// Updated helper function: Create a complete Message object with blocks
// Define a type for the input partial message
type PartialMessageInput = Partial<Message> & { role: 'user' | 'assistant' | 'system' }

function createMessage(
  partialMsg: PartialMessageInput,
  blocksData: PartialBlockInput[] = []
): Message & { _fullBlocks: MessageBlock[] } {
  const messageId = partialMsg.id || `msg-${Math.random().toString(36).substring(7)}`
  // Create blocks first, passing the messageId explicitly to createBlock
  const blocks = blocksData.map((blockData, index) =>
    createBlock(messageId, {
      id: `block-${messageId}-${index}`,
      // No need to spread messageId from blockData here
      ...blockData
    })
  )

  const message: Message & { _fullBlocks: MessageBlock[] } = {
    // Core Message fields (provide defaults for required ones)
    id: messageId,
    role: partialMsg.role,
    assistantId: partialMsg.assistantId || 'asst_default',
    topicId: partialMsg.topicId || 'topic_default',
    createdAt: partialMsg.createdAt || '2024-01-01T00:00:00Z',
    status: partialMsg.status || AssistantMessageStatus.SUCCESS,
    blocks: blocks.map((b) => b.id),

    // --- Fields required by Message type definition (using defaults or from partialMsg) ---
    modelId: partialMsg.modelId,
    model: partialMsg.model,
    type: partialMsg.type,
    useful: partialMsg.useful,
    askId: partialMsg.askId,
    mentions: partialMsg.mentions,
    enabledMCPs: partialMsg.enabledMCPs,
    usage: partialMsg.usage,
    metrics: partialMsg.metrics,
    multiModelMessageStyle: partialMsg.multiModelMessageStyle,
    foldSelected: partialMsg.foldSelected,

    // --- Special property for test helpers ---
    _fullBlocks: blocks
  }
  // Manually assign remaining optional properties from partialMsg if needed
  Object.keys(partialMsg).forEach((key) => {
    // Avoid overwriting fields already set explicitly or handled by defaults
    if (!(key in message) || message[key] === undefined) {
      message[key] = partialMsg[key]
    }
  })

  return message
}

// --- Global Test Setup ---

// Store mocked messages generated in beforeEach blocks
let mockedMessages: (Message & { _fullBlocks: MessageBlock[] })[] = []

beforeEach(() => {
  // Reset mocks and modules before each test suite (describe block)
  vi.resetModules()
  vi.clearAllMocks()

  // Mock i18next translation function
  vi.mock('i18next', () => ({
    default: {
      t: vi.fn((key) => key)
    }
  }))

  // Mock store - primarily for settings
  vi.doMock('@renderer/store', () => ({
    default: {
      getState: () => ({
        settings: { forceDollarMathInMarkdown: false }
      })
    }
  }))

  mockedMessages = [] // Clear messages for the next describe block
})

// --- Test Suites ---

describe('export', () => {
  describe('getTitleFromString', () => {
    // These tests are independent of message structure and remain unchanged
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
      // Use the specific Block type required by createBlock
      const userMsg = createMessage({ role: 'user', id: 'u1' }, [
        { type: MessageBlockType.MAIN_TEXT, content: 'hello user' }
      ])
      const assistantMsg = createMessage({ role: 'assistant', id: 'a1' }, [
        { type: MessageBlockType.MAIN_TEXT, content: 'hi assistant' }
      ])
      mockedMessages = [userMsg, assistantMsg]
    })

    it('should handle empty content in message blocks', () => {
      const msgWithEmptyContent = createMessage({ role: 'user', id: 'empty_block' }, [
        { type: MessageBlockType.MAIN_TEXT, content: '' }
      ])
      const markdown = messageToMarkdown(msgWithEmptyContent)
      expect(markdown).toContain('### 🧑‍💻 User')
      // Should handle empty content gracefully
      expect(markdown).toBeDefined()
      expect(markdown.split('\n\n').filter((s) => s.trim()).length).toBeGreaterThanOrEqual(1)
    })

    it('should format user message using main text block', () => {
      const msg = mockedMessages.find((m) => m.id === 'u1')
      expect(msg).toBeDefined()
      const markdown = messageToMarkdown(msg!)
      expect(markdown).toContain('### 🧑‍💻 User')
      expect(markdown).toContain('hello user')
      // Should have double newlines between sections
      const sections = markdown.split('\n\n')
      expect(sections.length).toBeGreaterThanOrEqual(3) // title, content, citation (empty)
    })

    it('should format assistant message using main text block', () => {
      const msg = mockedMessages.find((m) => m.id === 'a1')
      expect(msg).toBeDefined()
      const markdown = messageToMarkdown(msg!)
      expect(markdown).toContain('### 🤖 Assistant')
      expect(markdown).toContain('hi assistant')
      // Should have double newlines between sections
      const sections = markdown.split('\n\n')
      expect(sections.length).toBeGreaterThanOrEqual(3) // title, content, citation (empty)
    })

    it('should handle message with no main text block gracefully', () => {
      const msg = createMessage({ role: 'user', id: 'u2' }, [])
      mockedMessages.push(msg)
      const markdown = messageToMarkdown(msg)
      expect(markdown).toContain('### 🧑‍💻 User')
      // Check that it doesn't fail when no content exists
      expect(markdown).toBeDefined()
    })

    it('should include citation content when citation blocks exist', () => {
      const msgWithCitation = createMessage({ role: 'assistant', id: 'a_cite' }, [
        { type: MessageBlockType.MAIN_TEXT, content: 'Main content' },
        { type: MessageBlockType.CITATION }
      ])
      const markdown = messageToMarkdown(msgWithCitation)
      expect(markdown).toContain('### 🤖 Assistant')
      expect(markdown).toContain('Main content')
      expect(markdown).toContain('[1] [https://example1.com](Example Citation 1)')
    })
  })

  describe('messageToMarkdownWithReasoning', () => {
    beforeEach(() => {
      // Use the specific Block type required by createBlock
      const msgWithReasoning = createMessage({ role: 'assistant', id: 'a2' }, [
        { type: MessageBlockType.MAIN_TEXT, content: 'Main Answer' },
        { type: MessageBlockType.THINKING, content: 'Detailed thought process' }
      ])
      const msgWithThinkTag = createMessage({ role: 'assistant', id: 'a3' }, [
        { type: MessageBlockType.MAIN_TEXT, content: 'Answer B' },
        { type: MessageBlockType.THINKING, content: '<think>\nLine1\nLine2</think>' }
      ])
      const msgWithoutReasoning = createMessage({ role: 'assistant', id: 'a4' }, [
        { type: MessageBlockType.MAIN_TEXT, content: 'Simple Answer' }
      ])
      const msgWithReasoningAndCitation = createMessage({ role: 'assistant', id: 'a5' }, [
        { type: MessageBlockType.MAIN_TEXT, content: 'Answer with citation' },
        { type: MessageBlockType.THINKING, content: 'Some thinking' },
        { type: MessageBlockType.CITATION }
      ])
      mockedMessages = [msgWithReasoning, msgWithThinkTag, msgWithoutReasoning, msgWithReasoningAndCitation]
    })

    it('should include reasoning content from thinking block in details section', () => {
      const msg = mockedMessages.find((m) => m.id === 'a2')
      expect(msg).toBeDefined()
      const markdown = messageToMarkdownWithReasoning(msg!)
      expect(markdown).toContain('### 🤖 Assistant')
      expect(markdown).toContain('Main Answer')
      expect(markdown).toContain('<details')
      expect(markdown).toContain('<summary>common.reasoning_content</summary>')
      expect(markdown).toContain('Detailed thought process')
      // Should have double newlines between sections
      const sections = markdown.split('\n\n')
      expect(sections.length).toBeGreaterThanOrEqual(3)
    })

    it('should handle <think> tag and replace newlines with <br> in reasoning', () => {
      const msg = mockedMessages.find((m) => m.id === 'a3')
      expect(msg).toBeDefined()
      const markdown = messageToMarkdownWithReasoning(msg!)
      expect(markdown).toContain('Answer B')
      expect(markdown).toContain('<details')
      expect(markdown).toContain('Line1<br>Line2')
      expect(markdown).not.toContain('<think>')
    })

    it('should not include details section if no thinking block exists', () => {
      const msg = mockedMessages.find((m) => m.id === 'a4')
      expect(msg).toBeDefined()
      const markdown = messageToMarkdownWithReasoning(msg!)
      expect(markdown).toContain('### 🤖 Assistant')
      expect(markdown).toContain('Simple Answer')
      expect(markdown).not.toContain('<details')
    })

    it('should include both reasoning and citation content', () => {
      const msg = mockedMessages.find((m) => m.id === 'a5')
      expect(msg).toBeDefined()
      const markdown = messageToMarkdownWithReasoning(msg!)
      expect(markdown).toContain('### 🤖 Assistant')
      expect(markdown).toContain('Answer with citation')
      expect(markdown).toContain('<details')
      expect(markdown).toContain('Some thinking')
      expect(markdown).toContain('[1] [https://example1.com](Example Citation 1)')
    })
  })

  describe('messagesToMarkdown', () => {
    beforeEach(() => {
      // Use the specific Block type required by createBlock
      const userMsg = createMessage({ role: 'user', id: 'u3' }, [
        { type: MessageBlockType.MAIN_TEXT, content: 'User query A' }
      ])
      const assistantMsg = createMessage({ role: 'assistant', id: 'a5' }, [
        { type: MessageBlockType.MAIN_TEXT, content: 'Assistant response B' }
      ])
      const singleUserMsg = createMessage({ role: 'user', id: 'u4' }, [
        { type: MessageBlockType.MAIN_TEXT, content: 'Single user query' }
      ])
      mockedMessages = [userMsg, assistantMsg, singleUserMsg]
    })

    it('should join multiple messages with markdown separator', () => {
      const msgs = mockedMessages.filter((m) => ['u3', 'a5'].includes(m.id))
      const markdown = messagesToMarkdown(msgs)
      expect(markdown).toContain('User query A')
      expect(markdown).toContain('Assistant response B')
      expect(markdown.split('\n\n---\n\n').length).toBe(2)
    })

    it('should handle an empty array of messages', () => {
      expect(messagesToMarkdown([])).toBe('')
    })

    it('should handle a single message without separator', () => {
      const msgs = mockedMessages.filter((m) => m.id === 'u4')
      const markdown = messagesToMarkdown(msgs)
      expect(markdown).toContain('Single user query')
      expect(markdown.split('\n\n---\n\n').length).toBe(1)
    })
  })

  describe('formatMessageAsPlainText (via topicToPlainText)', () => {
    it('should format user and assistant messages correctly to plain text with roles', async () => {
      const userMsg = createMessage({ role: 'user', id: 'u_plain_formatted' }, [
        { type: MessageBlockType.MAIN_TEXT, content: '# User Content Formatted' }
      ])
      const assistantMsg = createMessage({ role: 'assistant', id: 'a_plain_formatted' }, [
        { type: MessageBlockType.MAIN_TEXT, content: '*Assistant Content Formatted*' }
      ])
      const testTopic: Topic = {
        id: 't_plain_formatted',
        name: 'Formatted Plain Topic',
        assistantId: 'asst_test_formatted',
        messages: [userMsg, assistantMsg] as any,
        createdAt: '',
        updatedAt: ''
      }
      ;(db.topics.get as any).mockResolvedValue({ messages: [userMsg, assistantMsg] })
      // Specific mock for this test to check formatting
      ;(markdownToPlainText as any).mockImplementation((str: string) => str.replace(/[#*]/g, ''))

      const plainText = await topicToPlainText(testTopic)

      expect(plainText).toContain('User:\nUser Content Formatted')
      expect(plainText).toContain('Assistant:\nAssistant Content Formatted')
      expect(markdownToPlainText).toHaveBeenCalledWith('# User Content Formatted')
      expect(markdownToPlainText).toHaveBeenCalledWith('*Assistant Content Formatted*')
      expect(markdownToPlainText).toHaveBeenCalledWith('Formatted Plain Topic')
    })
  })

  describe('messageToPlainText', () => {
    it('should convert a single message content to plain text without role prefix', () => {
      const testMessage = createMessage({ role: 'user', id: 'single_msg_plain' }, [
        { type: MessageBlockType.MAIN_TEXT, content: '### Single Message Content' }
      ])
      ;(markdownToPlainText as any).mockImplementation((str: string) => str.replace(/[#*_]/g, ''))

      const result = messageToPlainText(testMessage)
      expect(result).toBe('Single Message Content')
      expect(markdownToPlainText).toHaveBeenCalledWith('### Single Message Content')
    })

    it('should return empty string for message with no main text or empty content', () => {
      // Test case 1: No blocks at all
      const testMessageNoBlocks = createMessage({ role: 'user', id: 'empty_msg_plain' }, [])
      ;(markdownToPlainText as any).mockReturnValue('')

      const result1 = messageToPlainText(testMessageNoBlocks)
      expect(result1).toBe('')
      expect(markdownToPlainText).toHaveBeenCalledWith('')

      // Test case 2: Block exists but content is empty
      const testMessageEmptyContent = createMessage({ role: 'user', id: 'empty_content_msg' }, [
        { type: MessageBlockType.MAIN_TEXT, content: '' }
      ])

      const result2 = messageToPlainText(testMessageEmptyContent)
      expect(result2).toBe('')
      expect(markdownToPlainText).toHaveBeenCalledWith('')
    })

    it('should handle special characters in message content', () => {
      const testMessage = createMessage({ role: 'user', id: 'special_chars_msg' }, [
        { type: MessageBlockType.MAIN_TEXT, content: 'Text with "quotes" & <tags> and &entities;' }
      ])
      ;(markdownToPlainText as any).mockImplementation((str: string) => str)

      const result = messageToPlainText(testMessage)
      expect(result).toBe('Text with "quotes" & <tags> and &entities;')
      expect(markdownToPlainText).toHaveBeenCalledWith('Text with "quotes" & <tags> and &entities;')
    })

    it('should handle messages with markdown formatting', () => {
      const testMessage = createMessage({ role: 'user', id: 'markdown_msg' }, [
        { type: MessageBlockType.MAIN_TEXT, content: '# Header\n**Bold** and *italic* text\n- List item' }
      ])
      ;(markdownToPlainText as any).mockImplementation((str: string) =>
        str.replace(/[#*_]/g, '').replace(/^- /gm, '').replace(/\n+/g, '\n').trim()
      )

      const result = messageToPlainText(testMessage)
      expect(result).toBe('Header\nBold and italic text\nList item')
      expect(markdownToPlainText).toHaveBeenCalledWith('# Header\n**Bold** and *italic* text\n- List item')
    })
  })

  describe('messagesToPlainText (via topicToPlainText)', () => {
    it('should join multiple formatted plain text messages with double newlines', async () => {
      const msg1 = createMessage({ role: 'user', id: 'm_plain1_formatted' }, [
        { type: MessageBlockType.MAIN_TEXT, content: 'Msg1 Formatted' }
      ])
      const msg2 = createMessage({ role: 'assistant', id: 'm_plain2_formatted' }, [
        { type: MessageBlockType.MAIN_TEXT, content: 'Msg2 Formatted' }
      ])
      const testTopic: Topic = {
        id: 't_multi_plain_formatted',
        name: 'Multi Plain Formatted',
        assistantId: 'asst_test_multi_formatted',
        messages: [msg1, msg2] as any,
        createdAt: '',
        updatedAt: ''
      }
      ;(db.topics.get as any).mockResolvedValue({ messages: [msg1, msg2] })
      ;(markdownToPlainText as any).mockImplementation((str: string) => str) // Pass-through

      const plainText = await topicToPlainText(testTopic)
      expect(plainText).toBe('Multi Plain Formatted\n\nUser:\nMsg1 Formatted\n\nAssistant:\nMsg2 Formatted')
    })
  })

  describe('topicToPlainText', () => {
    beforeEach(() => {
      vi.clearAllMocks() // Clear mocks before each test in this suite
      // Mock store for settings if not already done globally or if specific settings are needed
      vi.doMock('@renderer/store', () => ({
        default: {
          getState: () => ({
            settings: { forceDollarMathInMarkdown: false } // Default or specific settings
          })
        }
      }))
    })

    it('should handle empty content in topic messages', async () => {
      const msgWithEmpty = createMessage({ role: 'user', id: 'empty_content' }, [
        { type: MessageBlockType.MAIN_TEXT, content: '' }
      ])
      const testTopic: Topic = {
        id: 'topic_empty_content',
        name: 'Topic with empty content',
        assistantId: 'asst_test',
        messages: [msgWithEmpty] as any,
        createdAt: '',
        updatedAt: ''
      }
      ;(db.topics.get as any).mockResolvedValue({ messages: [msgWithEmpty] })
      ;(markdownToPlainText as any).mockImplementation((str: string) => str)

      const result = await topicToPlainText(testTopic)
      expect(result).toBe('Topic with empty content\n\nUser:\n')
    })

    it('should handle special characters in topic content', async () => {
      const msgWithSpecial = createMessage({ role: 'user', id: 'special_chars' }, [
        { type: MessageBlockType.MAIN_TEXT, content: 'Content with "quotes" & <tags> and &entities;' }
      ])
      const testTopic: Topic = {
        id: 'topic_special_chars',
        name: 'Topic with "quotes" & symbols',
        assistantId: 'asst_test',
        messages: [msgWithSpecial] as any,
        createdAt: '',
        updatedAt: ''
      }
      ;(db.topics.get as any).mockResolvedValue({ messages: [msgWithSpecial] })
      ;(markdownToPlainText as any).mockImplementation((str: string) => str)

      const result = await topicToPlainText(testTopic)
      expect(markdownToPlainText).toHaveBeenCalledWith('Topic with "quotes" & symbols')
      expect(markdownToPlainText).toHaveBeenCalledWith('Content with "quotes" & <tags> and &entities;')
      expect(result).toContain('Content with "quotes" & <tags> and &entities;')
    })

    it('should return plain text for a topic with messages', async () => {
      const msg1 = createMessage({ role: 'user', id: 'tp_u1' }, [
        { type: MessageBlockType.MAIN_TEXT, content: '**Hello**' }
      ])
      const msg2 = createMessage({ role: 'assistant', id: 'tp_a1' }, [
        { type: MessageBlockType.MAIN_TEXT, content: '_World_' }
      ])
      const testTopic: Topic = {
        id: 'topic1_plain',
        name: '# Topic One',
        assistantId: 'asst_test',
        messages: [msg1, msg2] as any,
        createdAt: '',
        updatedAt: ''
      }
      ;(db.topics.get as any).mockResolvedValue({ messages: [msg1, msg2] })
      ;(markdownToPlainText as any).mockImplementation((str: string) => str.replace(/[#*_]/g, ''))

      const result = await topicToPlainText(testTopic)
      expect(db.topics.get).toHaveBeenCalledWith('topic1_plain')
      expect(markdownToPlainText).toHaveBeenCalledWith('# Topic One')
      expect(markdownToPlainText).toHaveBeenCalledWith('**Hello**')
      expect(markdownToPlainText).toHaveBeenCalledWith('_World_')
      expect(result).toBe('Topic One\n\nUser:\nHello\n\nAssistant:\nWorld')
    })

    it('should return only topic name if topic has no messages', async () => {
      const testTopic: Topic = {
        id: 'topic_empty_plain',
        name: '## Empty Topic',
        assistantId: 'asst_test',
        messages: [] as any,
        createdAt: '',
        updatedAt: ''
      }
      ;(db.topics.get as any).mockResolvedValue({ messages: [] })
      ;(markdownToPlainText as any).mockImplementation((str: string) => str.replace(/[#*_]/g, ''))

      const result = await topicToPlainText(testTopic)
      expect(result).toBe('Empty Topic')
      expect(markdownToPlainText).toHaveBeenCalledWith('## Empty Topic')
    })

    it('should return empty string if topicMessages is null', async () => {
      const testTopic: Topic = {
        id: 'topic_null_msgs_plain',
        name: 'Null Messages Topic',
        assistantId: 'asst_test',
        messages: null as any,
        createdAt: '',
        updatedAt: ''
      }
      ;(db.topics.get as any).mockResolvedValue(null)

      const result = await topicToPlainText(testTopic)
      expect(result).toBe('')
    })
  })

  describe('copyMessageAsPlainText', () => {
    // Mock navigator.clipboard.writeText
    const writeTextMock = vi.fn()
    beforeEach(() => {
      vi.stubGlobal('navigator', {
        clipboard: {
          writeText: writeTextMock
        }
      })

      // Mock window.message methods
      vi.stubGlobal('window', {
        message: {
          success: vi.fn(),
          error: vi.fn(),
          warning: vi.fn(),
          info: vi.fn()
        }
      })

      // Mock i18next translation function
      vi.mock('i18next', () => ({
        default: {
          t: vi.fn((key) => key)
        }
      }))

      writeTextMock.mockReset()
      // Ensure markdownToPlainText mock is set
      ;(markdownToPlainText as any).mockImplementation((str: string) => str.replace(/[#*_]/g, ''))
    })

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('should call messageToPlainText and copy its result to clipboard', async () => {
      const testMessage = createMessage({ role: 'user', id: 'copy_msg_plain' }, [
        { type: MessageBlockType.MAIN_TEXT, content: '**Copy This Plain**' }
      ])

      await copyMessageAsPlainText(testMessage)

      expect(markdownToPlainText).toHaveBeenCalledWith('**Copy This Plain**')
      expect(writeTextMock).toHaveBeenCalledWith('Copy This Plain')
    })

    it('should handle empty message content', async () => {
      const testMessage = createMessage({ role: 'user', id: 'copy_empty_msg_plain' }, [])
      ;(markdownToPlainText as any).mockReturnValue('')

      await copyMessageAsPlainText(testMessage)

      expect(markdownToPlainText).toHaveBeenCalledWith('')
      expect(writeTextMock).toHaveBeenCalledWith('')
    })
  })
})
