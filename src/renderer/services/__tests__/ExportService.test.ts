// Import Message, MessageBlock, and necessary enums
import { getTopicMessages } from '@renderer/hooks/useTopic'
import { addNote } from '@renderer/services/NotesService'
import { toast } from '@renderer/services/toast'
import type { MessageExportView } from '@renderer/types/messageExport'
import type { Message, MessageBlock } from '@renderer/types/newMessage'
import { AssistantMessageStatus, MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import type * as MessageFind from '@renderer/utils/message/find'
import { mockRendererLoggerService } from '@test-mocks/RendererLoggerService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
})

// Mock i18n at the top level using vi.mock
vi.mock('@renderer/i18n/resolver', () => ({
  default: {
    t: vi.fn((k: string) => k) // Pass-through mock using vi.fn
  }
}))

// Mock getProviderLabelKey
vi.mock('@renderer/i18n/label', () => ({
  getProviderLabelKey: vi.fn((providerId: string) => providerId || 'Unknown Provider')
}))

// Mock the find utility functions - crucial for the test
vi.mock('@renderer/utils/message/find', async (importOriginal) => ({
  // `[cite:id]` resolution is the behaviour under test in the tool-part cases below,
  // so keep the real implementation rather than restating it as a mock.
  getToolCitationExport: (await importOriginal<typeof MessageFind>()).getToolCitationExport,
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
    const citations = message.parts?.flatMap((part) => (part as any).providerMetadata?.cherry?.references || []) ?? []
    if (citations.length === 0) return ''
    return citations
      .map(
        (ref, index) =>
          // Mirrors the real `getCitationContent`: `[N] [title](url)`, title first.
          `[${index + 1}] [${ref.title || `Example Citation ${index + 1}`}](${ref.url || `https://example${index + 1}.com`})`
      )
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
import { markdownToPlainText } from '@renderer/utils/markdown'

import {
  exportMarkdownToObsidian,
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

function createTopic(partial: Partial<Topic> = {}): Topic {
  return {
    id: 'topic_default',
    name: 'Test Topic',
    assistantId: 'asst_default',
    messages: [],
    createdAt: '',
    updatedAt: '',
    type: TopicType.Chat,
    ...partial
  }
}

function toolSearchPart(results: unknown[]): any {
  return {
    type: 'tool-web_search',
    toolCallId: 'search-1',
    state: 'output-available',
    input: { query: 'q' },
    output: results
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

    it('should format user and assistant message roles', async () => {
      const userMarkdown = await messageToMarkdown(mockedMessages.find((message) => message.id === 'u1')!)
      const assistantMarkdown = await messageToMarkdown(mockedMessages.find((message) => message.id === 'a1')!)

      expect(userMarkdown).toContain('## 🧑‍💻 User')
      expect(userMarkdown).toContain('hello user')
      expect(assistantMarkdown).toContain('## 🤖 Assistant')
      expect(assistantMarkdown).toContain('hi assistant')
    })

    it('should format parts-only export view text', async () => {
      const message = createExportView([{ type: 'text', text: 'Parts-only content' }])

      const markdown = await messageToMarkdown(message)

      expect(markdown).toContain('## 🤖 Assistant')
      expect(markdown).toContain('Parts-only content')
    })

    it('uses the frozen producing author for the header, surviving rename/delete', async () => {
      const message = createExportView([{ type: 'text', text: 'snapshotted reply' }])
      message.messageSnapshot = {
        id: 'a1',
        name: 'My Assistant',
        emoji: '🎯',
        model: { id: 'gpt-5', name: 'GPT-5', provider: 'openai' }
      }

      const markdown = await messageToMarkdown(message)

      expect(markdown).toContain('## 🎯 My Assistant')
      expect(markdown).not.toContain('## 🤖 Assistant')
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
      expect(markdown).toContain('[^1]: [Example](https://example.com)')
    })

    it('should resolve tool-part [cite:id] markers and list their sources', async () => {
      // Tool-derived citations carry no `cherry.references`; the marker lives in the
      // text, so an unresolved export leaks the internal id and lists no sources.
      const message = createExportView([
        toolSearchPart([{ id: '3f2a1b9c-1', title: 'Example', url: 'https://example.com', content: 'snippet' }]),
        { type: 'text', text: 'Prices rose 3%. [cite:3f2a1b9c-1]' }
      ])

      const markdown = await messageToMarkdown(message)

      expect(markdown).not.toContain('[cite:')
      expect(markdown).toContain('Prices rose 3%. [^1]')
      expect(markdown).toContain('[^1]: [Example](https://example.com)')
    })

    it('should list a URL-less knowledge citation by title', async () => {
      const message = createExportView([
        {
          type: 'tool-kb_search',
          toolCallId: 'kb1',
          state: 'output-available',
          input: { query: 'q', baseIds: ['b'] },
          output: [
            { id: '3f2a1b9c-1', baseId: 'b', conceptId: 'notes/one.md', title: 'One.md', content: 'kb', score: 0.9 }
          ]
        },
        { type: 'text', text: 'From my notes. [cite:3f2a1b9c-1]' }
      ])

      const markdown = await messageToMarkdown(message)

      expect(markdown).not.toContain('[cite:')
      expect(markdown).toContain('[^1]: One.md')
    })

    it('should strip tool-part markers entirely when citations are excluded', async () => {
      const message = createExportView([
        toolSearchPart([{ id: '3f2a1b9c-1', title: 'Example', url: 'https://example.com', content: 'snippet' }]),
        { type: 'text', text: 'Prices rose 3%. [cite:3f2a1b9c-1]' }
      ])

      const markdown = await messageToMarkdown(message, true)

      expect(markdown).not.toContain('[cite:')
      expect(markdown).not.toContain('example.com')
      expect(markdown).toContain('Prices rose 3%.')
    })

    it('should drop a marker whose id resolves to nothing', async () => {
      const message = createExportView([{ type: 'text', text: 'Unbacked claim. [cite:3f2a1b9c-9]' }])

      const markdown = await messageToMarkdown(message)

      expect(markdown).not.toContain('[cite:')
      expect(markdown).toContain('Unbacked claim.')
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
      const msgWithReasoningAndCitation = createMessage({
        role: 'assistant',
        id: 'a5',
        parts: [
          { type: 'reasoning', text: 'Some thinking' },
          {
            type: 'text',
            text: 'Answer with citation',
            providerMetadata: {
              cherry: {
                references: [{ category: 'citation', url: 'https://example1.com', title: 'Example Citation 1' }]
              }
            }
          }
        ] as any
      })
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
      expect(markdown).toContain('[^1]: [Example Citation 1](https://example1.com)')
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

    // The model cites while reasoning too. Those markers get stripped rather than resolved: the
    // `[N]` sequence belongs to the answer body, so numbering them here would contradict it.
    it('strips citation markers from reasoning instead of leaking them into the export', async () => {
      const message = createExportView([
        toolSearchPart([{ id: '3f2a1b9c-1', title: 'Example', url: 'https://example.com', content: 'snippet' }]),
        { type: 'reasoning', text: 'The source says prices rose. [cite:3f2a1b9c-1] So the answer is 3%.' },
        { type: 'text', text: 'Prices rose 3%. [cite:3f2a1b9c-1]' }
      ])

      const markdown = await messageToMarkdownWithReasoning(message)

      expect(markdown).not.toContain('[cite:')
      expect(markdown).toContain('The source says prices rose. So the answer is 3%.')
      // The answer body still resolves to a real number, so stripping is scoped to the trace.
      expect(markdown).toContain('Prices rose 3%. [^1]')
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
      mockedMessages = [userMsg, assistantMsg]
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
  })

  describe('exportTopicToNotes', () => {
    beforeEach(() => {
      vi.clearAllMocks()
      ;(addNote as any).mockResolvedValue(undefined)
    })

    it('logs and toasts when topic markdown generation fails', async () => {
      const exportError = new Error('markdown failed')
      const loggerErrorSpy = vi.spyOn(mockRendererLoggerService, 'error').mockImplementation(() => {})
      const testTopic = createTopic({
        id: 'topic_markdown_failure',
        name: 'Topic Markdown Failure',
        assistantId: 'asst_test'
      })
      ;(getTopicMessages as any).mockRejectedValue(exportError)

      await expect(exportTopicToNotes(testTopic, '/notes')).rejects.toThrow(exportError)

      expect(addNote).not.toHaveBeenCalled()
      expect(loggerErrorSpy).toHaveBeenCalledWith('导出到笔记失败:', exportError)
      expect(toast.error).toHaveBeenCalledWith('message.error.notes.export')

      loggerErrorSpy.mockRestore()
    })
  })

  describe('exportMarkdownToObsidian', () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    it('returns false and toasts an error when the title is empty', async () => {
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)

      const result = await exportMarkdownToObsidian({ vault: 'MyVault', title: '' })

      expect(result).toBe(false)
      expect(toast.error).toHaveBeenCalledWith('chat.topics.export.obsidian_title_required')
      expect(openSpy).not.toHaveBeenCalled()

      openSpy.mockRestore()
    })

    it('returns false and toasts an error when no vault is selected', async () => {
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)

      const result = await exportMarkdownToObsidian({ vault: '', title: 'Note' })

      expect(result).toBe(false)
      expect(toast.error).toHaveBeenCalledWith('chat.topics.export.obsidian_no_vault_selected')
      expect(openSpy).not.toHaveBeenCalled()

      openSpy.mockRestore()
    })

    it('returns true and opens Obsidian when the export succeeds', async () => {
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)

      const result = await exportMarkdownToObsidian({ vault: 'MyVault', title: 'Note' })

      expect(result).toBe(true)
      expect(openSpy).toHaveBeenCalledTimes(1)
      expect(openSpy.mock.calls[0][0]).toContain('obsidian://new')
      expect(toast.success).toHaveBeenCalledWith('chat.topics.export.obsidian_export_success')

      openSpy.mockRestore()
    })
  })

  describe('topicToPlainText', () => {
    beforeEach(() => {
      vi.clearAllMocks() // Clear mocks before each test in this suite
    })

    it('should return plain text for a topic with messages', async () => {
      const msg1 = createMessage({ role: 'user', id: 'tp_u1' }, [
        { type: MessageBlockType.MAIN_TEXT, content: '**Hello**' }
      ])
      const msg2 = createMessage({ role: 'assistant', id: 'tp_a1' }, [
        { type: MessageBlockType.MAIN_TEXT, content: '_World_' }
      ])
      const testTopic = createTopic({
        id: 'topic1_plain',
        name: '# Topic One',
        assistantId: 'asst_test',
        messages: [msg1, msg2] as any
      })
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
      const testTopic = createTopic({
        id: 'topic_empty_plain',
        name: '## Empty Topic',
        assistantId: 'asst_test'
      })
      // Mock getTopicMessages to return empty array
      ;(getTopicMessages as any).mockResolvedValue([])
      ;(markdownToPlainText as any).mockImplementation((str: string) => str.replace(/[#*_]/g, ''))

      const result = await topicToPlainText(testTopic)
      expect(result).toBe('Empty Topic')
      expect(markdownToPlainText).toHaveBeenCalledWith('## Empty Topic')
    })
  })
})
