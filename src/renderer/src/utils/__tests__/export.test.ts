// Import Message, MessageBlock, and necessary enums
import type { Message, MessageBlock } from '@renderer/types/newMessage'
import { AssistantMessageStatus, MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
  })
}))

// Import the functions to test AFTER setting up mocks
import { getTitleFromString, messagesToMarkdown, messageToMarkdown, messageToMarkdownWithReasoning } from '../export'

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
    isPreset: partialMsg.isPreset,
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

    it('should format user message using main text block', () => {
      const msg = mockedMessages.find((m) => m.id === 'u1')
      expect(msg).toBeDefined()
      const markdown = messageToMarkdown(msg!)
      expect(markdown).toContain('### 🧑‍💻 User')
      expect(markdown).toContain('hello user')
    })

    it('should format assistant message using main text block', () => {
      const msg = mockedMessages.find((m) => m.id === 'a1')
      expect(msg).toBeDefined()
      const markdown = messageToMarkdown(msg!)
      expect(markdown).toContain('### 🤖 Assistant')
      expect(markdown).toContain('hi assistant')
    })

    it('should handle message with no main text block gracefully', () => {
      const msg = createMessage({ role: 'user', id: 'u2' }, [])
      mockedMessages.push(msg)
      const markdown = messageToMarkdown(msg)
      expect(markdown).toContain('### 🧑‍💻 User')
      expect(markdown.trim().endsWith('User')).toBe(true)
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
      mockedMessages = [msgWithReasoning, msgWithThinkTag, msgWithoutReasoning]
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
})
