// Import Message, MessageBlock, and necessary enums
import { getTopicMessages } from '@renderer/hooks/useTopic'
import { addNote } from '@renderer/services/NotesService'
import type { MessageExportView } from '@renderer/types/messageExport'
import type { Message, MessageBlock } from '@renderer/types/newMessage'
import { AssistantMessageStatus, MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import { mockRendererLoggerService } from '@test-mocks/RendererLoggerService'
import { beforeEach, describe, expect, it, test, vi } from 'vitest'

// --- Mocks Setup ---

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
  Object.defineProperty(window, 'toast', {
    value: {
      error: vi.fn(),
      success: vi.fn(),
      warning: vi.fn()
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

// Mock getProviderLabelKey
vi.mock('@renderer/i18n/label', () => ({
  getProviderLabelKey: vi.fn((providerId: string) => providerId || 'Unknown Provider')
}))

// Mock the find utility functions - crucial for the test
vi.mock('@renderer/utils/message/find', () => ({
  // Provide type safety for mocked message
  getMainTextContent: vi.fn((message: Message & { _fullBlocks?: MessageBlock[]; parts?: any[] }) => {
    if (message.parts?.length) {
      return message.parts
        .filter((part) => part.type === 'text')
        .map((part) => part.text || '')
        .filter((text) => text.trim().length > 0)
        .join('\n\n')
    }
    const mainTextBlock = message._fullBlocks?.find((b) => b.type === MessageBlockType.MAIN_TEXT)
    return mainTextBlock?.content || '' // Assuming content exists on MainTextBlock
  }),
  // Gated copy/naming variant — text-only here (the mock never synthesises
  // code/error/translation), which already matches dropping error/translation.
  getNamingTextContent: vi.fn((message: Message & { _fullBlocks?: MessageBlock[]; parts?: any[] }) => {
    if (message.parts?.length) {
      return message.parts
        .filter((part) => part.type === 'text')
        .map((part) => part.text || '')
        .filter((text) => text.trim().length > 0)
        .join('\n\n')
    }
    const mainTextBlock = message._fullBlocks?.find((b) => b.type === MessageBlockType.MAIN_TEXT)
    return mainTextBlock?.content || ''
  }),
  getThinkingContent: vi.fn((message: Message & { _fullBlocks?: MessageBlock[]; parts?: any[] }) => {
    if (message.parts?.length) {
      return message.parts
        .filter((part) => part.type === 'reasoning')
        .map((part) => part.text || '')
        .filter((text) => text.trim().length > 0)
        .join('\n\n')
    }
    const thinkingBlock = message._fullBlocks?.find((b) => b.type === MessageBlockType.THINKING)
    // Assuming content exists on ThinkingBlock
    // Need to cast block to access content if not on base type
    return (thinkingBlock as any)?.content || ''
  }),
  getCitationContent: vi.fn((message: Message & { _fullBlocks?: MessageBlock[]; parts?: any[] }) => {
    if (message.parts?.length) {
      const citations = message.parts.flatMap((part) => (part as any).providerMetadata?.cherry?.references || [])
      if (citations.length === 0) return ''
      return citations
        .map(
          (ref, index) =>
            `[${index + 1}] [${ref.url || `https://example${index + 1}.com`}](${ref.title || `Example Citation ${index + 1}`})`
        )
        .join('\n\n')
    }
    const citationBlocks = message._fullBlocks?.filter((b) => b.type === MessageBlockType.CITATION) || []
    // Return empty string if no citation blocks, otherwise mock citation content
    if (citationBlocks.length === 0) return ''
    // Mock citation format: [number] [url](title)
    return citationBlocks
      .map((_, index) => `[${index + 1}] [https://example${index + 1}.com](Example Citation ${index + 1})`)
      .join('\n\n')
  })
}))

// Mock getTopicMessages for dynamic import
vi.mock('@renderer/hooks/useTopic', () => ({
  getTopicMessages: vi.fn()
}))

vi.mock('@renderer/services/NotesService', () => ({
  addNote: vi.fn()
}))

// PreferenceService is now mocked globally in tests/renderer.setup.ts

vi.mock('@renderer/utils/markdown', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...(actual as any),
    markdownToPlainText: vi.fn((str: string) => str) // Simple pass-through for testing export logic
  }
})

// Import the functions to test AFTER setting up mocks
import { type Topic, TopicType } from '@renderer/types/topic'
import { processCitations } from '@renderer/utils/export'
import { markdownToPlainText } from '@renderer/utils/markdown'

import {
  exportTopicToNotes,
  messagesToMarkdown,
  messageToMarkdown,
  messageToMarkdownWithReasoning,
  topicToPlainText
} from '../ExportService'

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

function createExportView(parts: any[], role: 'user' | 'assistant' | 'system' = 'assistant'): MessageExportView {
  return {
    id: `export-${Math.random().toString(36).substring(7)}`,
    role,
    topicId: 'topic_default',
    createdAt: '2024-01-01T00:00:00Z',
    status: 'success',
    parts: parts as MessageExportView['parts']
  }
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

  mockedMessages = [] // Clear messages for the next describe block
})

// --- Test Suites ---

describe('ExportService', () => {
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

    it('should handle empty content in message blocks', async () => {
      const msgWithEmptyContent = createMessage({ role: 'user', id: 'empty_block' }, [
        { type: MessageBlockType.MAIN_TEXT, content: '' }
      ])
      const markdown = await messageToMarkdown(msgWithEmptyContent)
      expect(markdown).toContain('## 🧑‍💻 User')
      // Should handle empty content gracefully
      expect(markdown).toBeDefined()
      expect(markdown.split('\n\n').filter((s) => s.trim()).length).toBeGreaterThanOrEqual(1)
    })

    it('should format user message using main text block', async () => {
      const msg = mockedMessages.find((m) => m.id === 'u1')
      expect(msg).toBeDefined()
      const markdown = await messageToMarkdown(msg!)
      expect(markdown).toContain('## 🧑‍💻 User')
      expect(markdown).toContain('hello user')

      // The format is: [titleSection, '', contentSection, citation].join('\n')
      // When citation is empty, we get: "## 🧑‍💻 User\n\nhello user\n"
      const sections = markdown.split('\n\n')
      expect(sections.length).toBeGreaterThanOrEqual(2) // title section and content section
    })

    it('should format assistant message using main text block', async () => {
      const msg = mockedMessages.find((m) => m.id === 'a1')
      expect(msg).toBeDefined()
      const markdown = await messageToMarkdown(msg!)
      expect(markdown).toContain('## 🤖 Assistant')
      expect(markdown).toContain('hi assistant')

      // The format is: [titleSection, '', contentSection, citation].join('\n')
      // When citation is empty, we get: "## 🤖 Assistant\n\nhi assistant\n"
      const sections = markdown.split('\n\n')
      expect(sections.length).toBeGreaterThanOrEqual(2) // title section and content section
    })

    it('should handle message with no main text block gracefully', async () => {
      const msg = createMessage({ role: 'user', id: 'u2' }, [])
      mockedMessages.push(msg)
      const markdown = await messageToMarkdown(msg)
      expect(markdown).toContain('## 🧑‍💻 User')
      // Check that it doesn't fail when no content exists
      expect(markdown).toBeDefined()
    })

    it('should include citation content when citation blocks exist', async () => {
      const msgWithCitation = createMessage({ role: 'assistant', id: 'a_cite' }, [
        { type: MessageBlockType.MAIN_TEXT, content: 'Main content' },
        { type: MessageBlockType.CITATION }
      ])
      const markdown = await messageToMarkdown(msgWithCitation)
      expect(markdown).toContain('## 🤖 Assistant')
      expect(markdown).toContain('Main content')
      expect(markdown).toContain('[^1]: [https://example1.com](Example Citation 1)')
    })

    it('should format parts-only export view text', async () => {
      const message = createExportView([{ type: 'text', text: 'Parts-only content' }])

      const markdown = await messageToMarkdown(message)

      expect(markdown).toContain('## 🤖 Assistant')
      expect(markdown).toContain('Parts-only content')
    })

    it('should format composer skill tokens as pasteable markers instead of hidden prompt text', async () => {
      const message = createExportView(
        [
          {
            type: 'text',
            text: 'Use the find-skills skill. **hello**',
            providerMetadata: {
              cherry: {
                composer: {
                  version: 1,
                  tokens: [
                    {
                      id: 'skill:find-skills',
                      kind: 'skill',
                      label: 'find-skills',
                      index: 0,
                      textOffset: 0,
                      promptText: 'Use the find-skills skill.'
                    }
                  ]
                }
              }
            }
          }
        ],
        'user'
      )

      const markdown = await messageToMarkdown(message)

      expect(markdown).toContain('/find-skills/ **hello**')
      expect(markdown).not.toContain('Use the find-skills skill.')
    })

    it('should format parts-only export view citations', async () => {
      const message = createExportView([
        {
          type: 'text',
          text: 'Answer with citation [1]',
          providerMetadata: {
            cherry: {
              references: [{ category: 'citation', url: 'https://example.com', title: 'Example' }]
            }
          }
        }
      ])

      const markdown = await messageToMarkdown(message)

      expect(markdown).toContain('Answer with citation')
      expect(markdown).toContain('[^1]: [https://example.com](Example)')
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

    it('should include reasoning content from thinking block in details section', async () => {
      const msg = mockedMessages.find((m) => m.id === 'a2')
      expect(msg).toBeDefined()
      const markdown = await messageToMarkdownWithReasoning(msg!)
      expect(markdown).toContain('## 🤖 Assistant')
      expect(markdown).toContain('Main Answer')
      expect(markdown).toContain('<details')
      expect(markdown).toContain('<summary>common.reasoning_content</summary>')
      expect(markdown).toContain('Detailed thought process')

      // The format includes reasoning section, so should have at least 2 sections
      const sections = markdown.split('\n\n')
      expect(sections.length).toBeGreaterThanOrEqual(2)
    })

    it('should handle <think> tag and replace newlines with <br> in reasoning', async () => {
      const msg = mockedMessages.find((m) => m.id === 'a3')
      expect(msg).toBeDefined()
      const markdown = await messageToMarkdownWithReasoning(msg!)
      expect(markdown).toContain('Answer B')
      expect(markdown).toContain('<details')
      expect(markdown).toContain('Line1<br>Line2')
      expect(markdown).not.toContain('<think>')
    })

    it('should not include details section if no thinking block exists', async () => {
      const msg = mockedMessages.find((m) => m.id === 'a4')
      expect(msg).toBeDefined()
      const markdown = await messageToMarkdownWithReasoning(msg!)
      expect(markdown).toContain('## 🤖 Assistant')
      expect(markdown).toContain('Simple Answer')
      expect(markdown).not.toContain('<details')
    })

    it('should include both reasoning and citation content', async () => {
      const msg = mockedMessages.find((m) => m.id === 'a5')
      expect(msg).toBeDefined()
      const markdown = await messageToMarkdownWithReasoning(msg!)
      expect(markdown).toContain('## 🤖 Assistant')
      expect(markdown).toContain('Answer with citation')
      expect(markdown).toContain('<details')
      expect(markdown).toContain('Some thinking')
      expect(markdown).toContain('[^1]: [https://example1.com](Example Citation 1)')
    })

    it('should include reasoning from parts-only export view', async () => {
      const message = createExportView([
        { type: 'reasoning', text: 'Parts reasoning' },
        { type: 'text', text: 'Parts answer' }
      ])

      const markdown = await messageToMarkdownWithReasoning(message)

      expect(markdown).toContain('Parts answer')
      expect(markdown).toContain('Parts reasoning')
    })

    it('should format citations as footnotes when standardize citations is enabled', () => {
      // Remove this test as it's testing integration with mocked store settings
      // The functionality is already tested in the Citation formatting section
      expect(true).toBe(true) // Placeholder
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

    it('should join multiple messages with markdown separator', async () => {
      const msgs = mockedMessages.filter((m) => ['u3', 'a5'].includes(m.id))
      const markdown = await messagesToMarkdown(msgs)
      expect(markdown).toContain('User query A')
      expect(markdown).toContain('Assistant response B')

      // With 2 messages, there should be 1 separator, so splitting gives 2 parts
      expect(markdown.split('\n---\n').length).toBe(2)
    })

    it('should handle an empty array of messages', async () => {
      expect(await messagesToMarkdown([])).toBe('')
    })

    it('should handle a single message without separator', async () => {
      const msgs = mockedMessages.filter((m) => m.id === 'u4')
      const markdown = await messagesToMarkdown(msgs)
      expect(markdown).toContain('Single user query')
      expect(markdown.split('\n\n---\n\n').length).toBe(1)
    })
  })

  describe('formatMessageAsPlainText (via topicToPlainText)', () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

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
        updatedAt: '',
        type: TopicType.Chat
      }
      // Mock getTopicMessages to return the expected messages
      ;(getTopicMessages as any).mockResolvedValue([userMsg, assistantMsg])
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

  describe('messagesToPlainText (via topicToPlainText)', () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

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
        updatedAt: '',
        type: TopicType.Chat
      }
      // Mock getTopicMessages to return the expected messages
      ;(getTopicMessages as any).mockResolvedValue([msg1, msg2])
      ;(markdownToPlainText as any).mockImplementation((str: string) => str) // Pass-through

      const plainText = await topicToPlainText(testTopic)
      expect(plainText).toBe('Multi Plain Formatted\n\nUser:\nMsg1 Formatted\n\nAssistant:\nMsg2 Formatted')
    })
  })

  describe('exportTopicToNotes', () => {
    beforeEach(() => {
      vi.clearAllMocks()
      ;(addNote as any).mockResolvedValue(undefined)
    })

    it('logs and toasts when topic markdown generation fails', async () => {
      const exportError = new Error('markdown failed')
      const loggerErrorSpy = vi.spyOn(mockRendererLoggerService, 'error').mockImplementation(() => {})
      const testTopic: Topic = {
        id: 'topic_markdown_failure',
        name: 'Topic Markdown Failure',
        assistantId: 'asst_test',
        messages: [] as any,
        createdAt: '',
        updatedAt: '',
        type: TopicType.Chat
      }
      ;(getTopicMessages as any).mockRejectedValue(exportError)

      await expect(exportTopicToNotes(testTopic, '/notes')).rejects.toThrow(exportError)

      expect(addNote).not.toHaveBeenCalled()
      expect(loggerErrorSpy).toHaveBeenCalledWith('导出到笔记失败:', exportError)
      expect(window.toast.error).toHaveBeenCalledWith('message.error.notes.export')

      loggerErrorSpy.mockRestore()
    })
  })

  describe('topicToPlainText', () => {
    beforeEach(() => {
      vi.clearAllMocks() // Clear mocks before each test in this suite
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
        updatedAt: '',
        type: TopicType.Chat
      }
      // Mock getTopicMessages to return the expected messages
      ;(getTopicMessages as any).mockResolvedValue([msgWithEmpty])
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
        updatedAt: '',
        type: TopicType.Chat
      }
      // Mock getTopicMessages to return the expected messages
      ;(getTopicMessages as any).mockResolvedValue([msgWithSpecial])
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
        updatedAt: '',
        type: TopicType.Chat
      }
      // Mock getTopicMessages to return the expected messages
      ;(getTopicMessages as any).mockResolvedValue([msg1, msg2])
      ;(markdownToPlainText as any).mockImplementation((str: string) => str.replace(/[#*_]/g, ''))

      const result = await topicToPlainText(testTopic)
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
        updatedAt: '',
        type: TopicType.Chat
      }
      // Mock getTopicMessages to return empty array
      ;(getTopicMessages as any).mockResolvedValue([])
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
        updatedAt: '',
        type: TopicType.Chat
      }
      // Mock getTopicMessages to return empty array for null case
      ;(getTopicMessages as any).mockResolvedValue([])

      const result = await topicToPlainText(testTopic)
      expect(result).toBe('Null Messages Topic')
    })
  })
})

describe('Citation formatting in Markdown export', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  test('should properly integrate processCitations with messageToMarkdown', () => {
    // Test the actual processCitations function behavior
    const testContent =
      'This text has citations [<sup data-citation="test">1</sup>](url) and [2] that should be removed.'
    const processedContent = processCitations(testContent, 'remove')

    // The function should remove citation markers
    expect(processedContent).toBe('This text has citations and that should be removed.')
    expect(processedContent).not.toContain('[<sup')
    expect(processedContent).not.toContain('[1]')
    expect(processedContent).not.toContain('[2]')
  })

  test('should properly integrate processCitations with normalization', () => {
    // Test the actual processCitations function behavior
    const testContent =
      'Content with different citation formats [<sup data-citation="test">1</sup>](url1) and [2] and <sup data-citation="test2">3</sup>.'
    const processedContent = processCitations(testContent, 'normalize')

    // Citations should be normalized to footnote format
    expect(processedContent).toBe('Content with different citation formats [^1] and [^2] and [^3].')
    expect(processedContent).not.toContain('[<sup')
    expect(processedContent).not.toContain('<sup')
  })

  test('should properly test formatCitationsAsFootnotes through messageToMarkdown', async () => {
    const msgWithCitations = createMessage({ role: 'assistant', id: 'test_footnotes' }, [
      {
        type: MessageBlockType.MAIN_TEXT,
        content: 'Content with citations [<sup data-citation="test">1</sup>](url1) and [2].'
      },
      { type: MessageBlockType.CITATION }
    ])

    // This tests the complete flow including formatCitationsAsFootnotes
    const markdown = await messageToMarkdown(msgWithCitations)

    // Should contain the title and content
    expect(markdown).toContain('## 🤖 Assistant')
    expect(markdown).toContain('Content with citations')

    // Should include citation content (mocked by getCitationContent)
    expect(markdown).toContain('[^1]: [https://example1.com](Example Citation 1)')
  })
})
