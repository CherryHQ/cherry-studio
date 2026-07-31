import { beforeEach, describe, expect, it, test, vi } from 'vitest'

// Import Message, MessageBlock, and necessary enums
import type { MessageExportView } from '@renderer/types/messageExport'
import type { Message, MessageBlock } from '@renderer/types/newMessage'
import { AssistantMessageStatus, MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import type * as MessageFind from '@renderer/utils/message/find'

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

// Mock the find utility functions - crucial for the test
vi.mock('@renderer/utils/message/find', async (importOriginal) => ({
  // `[cite:id]` resolution is the behaviour under test in the copy case below,
  // so keep the real implementation rather than restating it as a mock.
  getToolCitationExport: (await importOriginal<typeof MessageFind>()).getToolCitationExport,
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
  })
}))

vi.mock('@renderer/utils/markdown', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...(actual as any),
    markdownToPlainText: vi.fn((str: string) => str) // Simple pass-through for testing export logic
  }
})

// Import the functions to test AFTER setting up mocks
import { markdownToPlainText } from '@renderer/utils/markdown'

import { getTitleFromString, messagesToPlainText, messageToPlainText, processCitations } from '../export'

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

    it('should fall back to the original input when no title remains', () => {
      expect(getTitleFromString('', 5)).toBe('')
      expect(getTitleFromString('。', 5)).toBe('。')
      expect(getTitleFromString('   ', 2)).toBe('  ')
    })
  })

  describe('messageToPlainText', () => {
    it('should convert a single message content to plain text without role prefix', async () => {
      const testMessage = createMessage({ role: 'user', id: 'single_msg_plain' }, [
        { type: MessageBlockType.MAIN_TEXT, content: '### Single Message Content' }
      ])
      ;(markdownToPlainText as any).mockImplementation((str: string) => str.replace(/[#*_]/g, ''))

      const result = messageToPlainText(testMessage)
      expect(result).toBe('Single Message Content')
      expect(markdownToPlainText).toHaveBeenCalledWith('### Single Message Content')
    })

    it('should copy composer skill tokens as pasteable markers instead of hidden prompt text', () => {
      const testMessage = createExportView(
        [
          {
            type: 'text',
            text: 'Use the pdf skill. hello',
            providerMetadata: {
              cherry: {
                composer: {
                  version: 1,
                  tokens: [
                    {
                      id: 'skill:pdf',
                      kind: 'skill',
                      label: 'pdf',
                      index: 0,
                      textOffset: 0,
                      promptText: 'Use the pdf skill.'
                    }
                  ]
                }
              }
            }
          }
        ],
        'user'
      )
      ;(markdownToPlainText as any).mockImplementation((str: string) => str)

      const result = messageToPlainText(testMessage)

      expect(result).toBe('/pdf/ hello')
      expect(markdownToPlainText).toHaveBeenCalledWith('/pdf/ hello')
    })

    it('should resolve tool citation markers to plain numbers before copying', () => {
      // Left in place, `remove-markdown` mangles a chain of markers down to a bare
      // `cite:<id>` and the internal id lands on the clipboard.
      const testMessage = createExportView([
        {
          type: 'tool-web_search',
          toolCallId: 'search-1',
          state: 'output-available',
          input: { query: 'q' },
          output: [
            { id: '3f2a1b9c-1', title: 'First', url: 'https://a.com/x', content: 'alpha' },
            { id: '3f2a1b9c-2', title: 'Second', url: 'https://b.com/y', content: 'beta' }
          ]
        },
        { type: 'text', text: 'Prices rose. [cite:3f2a1b9c-1][cite:3f2a1b9c-2]' }
      ])
      ;(markdownToPlainText as any).mockImplementation((str: string) => str)

      const result = messageToPlainText(testMessage)

      expect(result).toBe('Prices rose. [1][2]')
      expect(result).not.toContain('cite:')
    })
  })

  describe('messagesToPlainText', () => {
    it('labels an assistant row with the frozen snapshot author, not a generic "Assistant"', () => {
      const message = createExportView([{ type: 'text', text: 'hi' }])
      message.messageSnapshot = {
        id: 'a1',
        name: 'My Assistant',
        emoji: '🤖',
        model: { id: 'gpt-5', name: 'GPT-5', provider: 'openai' }
      }
      expect(messagesToPlainText([message])).toContain('My Assistant:')
    })

    it('falls back to "Assistant:" for a snapshot-less assistant row', () => {
      expect(messagesToPlainText([createExportView([{ type: 'text', text: 'hi' }])])).toContain('Assistant:')
    })
  })
})

describe('processCitations', () => {
  // Tests for 'remove' mode
  test('should remove basic citation format [<sup data-citation="...">...</sup>](...)', () => {
    const input = "This is a test with a citation [<sup data-citation='test'>1</sup>](http://example.com)"
    const expected = 'This is a test with a citation'
    expect(processCitations(input, 'remove')).toBe(expected)
  })

  test('should remove citation format [<sup>...</sup>](...)', () => {
    const input = 'Another test with [<sup>2</sup>](http://example.com)'
    const expected = 'Another test with'
    expect(processCitations(input, 'remove')).toBe(expected)
  })

  test('should remove standalone sup tag <sup data-citation="...">...</sup>', () => {
    const input = "A third test with a standalone <sup data-citation='test'>3</sup> citation."
    const expected = 'A third test with a standalone citation.'
    expect(processCitations(input, 'remove')).toBe(expected)
  })

  test('should remove simple bracketed number format [1]', () => {
    const input = 'This is a test with a simple citation [1].'
    const expected = 'This is a test with a simple citation .'
    expect(processCitations(input, 'remove')).toBe(expected)
  })

  test('should not remove bracketed numbers that are not citations, e.g., part of a link', () => {
    const input = 'This is a link to [a document](http://example.com/doc[1])'
    const expected = 'This is a link to [a document](http://example.com/doc)'
    expect(processCitations(input, 'remove')).toBe(expected)
  })

  // Tests for 'normalize' mode
  test('should normalize basic citation format to [^1]', () => {
    const input = "This is a test with a citation [<sup data-citation='test'>1</sup>](http://example.com)"
    const expected = 'This is a test with a citation [^1]'
    expect(processCitations(input, 'normalize')).toBe(expected)
  })

  test('should normalize [<sup>...</sup>](...) format to [^2]', () => {
    const input = 'Another test with [<sup>2</sup>](http://example.com)'
    const expected = 'Another test with [^2]'
    expect(processCitations(input, 'normalize')).toBe(expected)
  })

  test('should normalize standalone sup tag to [^3]', () => {
    const input = "A third test with a standalone <sup data-citation='test'>3</sup> citation."
    const expected = 'A third test with a standalone [^3] citation.'
    expect(processCitations(input, 'normalize')).toBe(expected)
  })

  test('should normalize simple bracketed number format [1] to [^1]', () => {
    const input = 'This is a test with a simple citation [1].'
    const expected = 'This is a test with a simple citation [^1].'
    expect(processCitations(input, 'normalize')).toBe(expected)
  })

  test('should not normalize bracketed numbers in links', () => {
    const input = 'This is a link to [a document](http://example.com/doc[1])'
    const expected = 'This is a link to [a document](http://example.com/doc[^1])'
    expect(processCitations(input, 'normalize')).toBe(expected)
  })

  // Test for multiple citations
  test('should handle multiple citations in a single string', () => {
    const input =
      "This is a test with multiple citations [<sup data-citation='test'>1</sup>](http://example.com) and [2]."
    const expectedRemove = 'This is a test with multiple citations and .'
    const expectedNormalize = 'This is a test with multiple citations [^1] and [^2].'
    expect(processCitations(input, 'remove')).toBe(expectedRemove)
    expect(processCitations(input, 'normalize')).toBe(expectedNormalize)
  })

  // Test for no citations
  test('should return the original string if no citations are present', () => {
    const input = 'This is a string with no citations.'
    expect(processCitations(input, 'remove')).toBe(input)
    expect(processCitations(input, 'normalize')).toBe(input)
  })

  // Test with code blocks
  test('should correctly process citations within and outside code blocks', () => {
    const input =
      "Some text [<sup data-citation='test'>1</sup>](http://example.com)\n```javascript\nconst a = [1]; // This [1] should not be touched\n```\nMore text [2]."
    const expectedRemove =
      'Some text\n```javascript\nconst a = [1]; // This [1] should not be touched\n```\nMore text .'
    const expectedNormalize =
      'Some text [^1]\n```javascript\nconst a = [1]; // This [1] should not be touched\n```\nMore text [^2].'

    expect(processCitations(input, 'remove')).toBe(expectedRemove)
    expect(processCitations(input, 'normalize')).toBe(expectedNormalize)
  })

  test('should handle multiple code blocks and citations', () => {
    const input =
      "Text [1].\n```python\nprint('hello [2]')\n```\nMore text [3].\n```typescript\nconst b = [4];\n```\nFinal text [5]."
    const expectedRemove =
      "Text .\n```python\nprint('hello [2]')\n```\nMore text .\n```typescript\nconst b = [4];\n```\nFinal text ."
    const expectedNormalize =
      "Text [^1].\n```python\nprint('hello [2]')\n```\nMore text [^3].\n```typescript\nconst b = [4];\n```\nFinal text [^5]."

    expect(processCitations(input, 'remove')).toBe(expectedRemove)
    expect(processCitations(input, 'normalize')).toBe(expectedNormalize)
  })

  test('should preserve line breaks and formatting in markdown structures', () => {
    const input = `# Header [1]

> Quote with citation [<sup data-citation='test'>2</sup>](url)

- List item [3]
  - Nested item [4]

Text with **bold** [5] and *italic* [6] formatting.

    Code block with [7] should not be processed

Final paragraph [8].`

    const expectedRemove = `# Header

> Quote with citation

- List item
 - Nested item

Text with **bold** and *italic* formatting.

 Code block with should not be processed

Final paragraph .`

    const expectedNormalize = `# Header [^1]

> Quote with citation [^2]

- List item [^3]
 - Nested item [^4]

Text with **bold** [^5] and *italic* [^6] formatting.

 Code block with [^7] should not be processed

Final paragraph [^8].`

    expect(processCitations(input, 'remove')).toBe(expectedRemove)
    expect(processCitations(input, 'normalize')).toBe(expectedNormalize)
  })

  test('should handle complex nested HTML-like citation formats', () => {
    const input = `Text with [<sup data-citation='{"source": "test", "page": 1}'>1</sup>](http://example.com) citation.`
    const expectedRemove = 'Text with citation.'
    const expectedNormalize = 'Text with [^1] citation.'

    expect(processCitations(input, 'remove')).toBe(expectedRemove)
    expect(processCitations(input, 'normalize')).toBe(expectedNormalize)
  })

  test('should handle whitespace around citations correctly', () => {
    const input = `Text before [1] text after.\nNew line [2] more text.\n\nNew paragraph [3] end.`
    const expectedRemove = `Text before text after.\nNew line more text.\n\nNew paragraph end.`
    const expectedNormalize = `Text before [^1] text after.\nNew line [^2] more text.\n\nNew paragraph [^3] end.`

    expect(processCitations(input, 'remove')).toBe(expectedRemove)
    expect(processCitations(input, 'normalize')).toBe(expectedNormalize)
  })

  test('should handle edge case with only code blocks and no regular content', () => {
    const input = `\`\`\`python
# Code with [1] citation
def test():
    return [2]
\`\`\`

\`\`\`javascript
const arr = [3, 4, 5];
\`\`\``

    // Content inside code blocks should remain unchanged
    expect(processCitations(input, 'remove')).toBe(input)
    expect(processCitations(input, 'normalize')).toBe(input)
  })
})
