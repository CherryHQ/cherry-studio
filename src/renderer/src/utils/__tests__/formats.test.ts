import { isReasoningModel } from '@renderer/config/models'
import { getAssistantById } from '@renderer/services/AssistantService'
import { Message } from '@renderer/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  addImageFileToContents,
  escapeBrackets,
  escapeDollarNumber,
  extractTitle,
  removeSvgEmptyLines,
  withGeminiGrounding,
  withGenerateImage,
  withMessageThought
} from '../formats'

// 模拟依赖
vi.mock('@renderer/config/models', () => ({
  isReasoningModel: vi.fn()
}))

vi.mock('@renderer/services/AssistantService', () => ({
  getAssistantById: vi.fn()
}))

describe('formats', () => {
  describe('escapeDollarNumber', () => {
    it('should escape dollar signs followed by numbers', () => {
      expect(escapeDollarNumber('The cost is $5')).toBe('The cost is \\$5')
      expect(escapeDollarNumber('$1, $2, and $3')).toBe('\\$1, \\$2, and \\$3')
    })

    it('should not escape dollar signs not followed by numbers', () => {
      expect(escapeDollarNumber('The $ symbol')).toBe('The $ symbol')
      expect(escapeDollarNumber('$symbol')).toBe('$symbol')
    })

    it('should handle empty string', () => {
      expect(escapeDollarNumber('')).toBe('')
    })

    it('should handle string with only dollar signs', () => {
      expect(escapeDollarNumber('$$$')).toBe('$$$')
    })

    it('should handle dollar sign at the end of string', () => {
      expect(escapeDollarNumber('The cost is $')).toBe('The cost is $')
    })
  })

  describe('escapeBrackets', () => {
    it('should convert \\[...\\] to display math format', () => {
      expect(escapeBrackets('The formula is \\[a+b=c\\]')).toBe('The formula is \n$$\na+b=c\n$$\n')
    })

    it('should convert \\(...\\) to inline math format', () => {
      expect(escapeBrackets('The formula is \\(a+b=c\\)')).toBe('The formula is $a+b=c$')
    })

    it('should not affect code blocks', () => {
      const codeBlock = 'This is text with a code block ```const x = \\[1, 2, 3\\]```'
      expect(escapeBrackets(codeBlock)).toBe(codeBlock)
    })

    it('should not affect inline code', () => {
      const inlineCode = 'This is text with `const x = \\[1, 2, 3\\]` inline code'
      expect(escapeBrackets(inlineCode)).toBe(inlineCode)
    })

    it('should handle multiple occurrences', () => {
      const input = 'Formula 1: \\[a+b=c\\] and formula 2: \\(x+y=z\\)'
      const expected = 'Formula 1: \n$$\na+b=c\n$$\n and formula 2: $x+y=z$'
      expect(escapeBrackets(input)).toBe(expected)
    })

    it('should handle empty string', () => {
      expect(escapeBrackets('')).toBe('')
    })
  })

  describe('extractTitle', () => {
    it('should extract title from HTML string', () => {
      const html = '<html><head><title>Page Title</title></head><body>Content</body></html>'
      expect(extractTitle(html)).toBe('Page Title')
    })

    it('should extract title with case insensitivity', () => {
      const html = '<html><head><TITLE>Page Title</TITLE></head><body>Content</body></html>'
      expect(extractTitle(html)).toBe('Page Title')
    })

    it('should handle HTML without title tag', () => {
      const html = '<html><head></head><body>Content</body></html>'
      expect(extractTitle(html)).toBeNull()
    })

    it('should handle empty title tag', () => {
      const html = '<html><head><title></title></head><body>Content</body></html>'
      expect(extractTitle(html)).toBe('')
    })

    it('should handle malformed HTML', () => {
      const html = '<title>Partial HTML'
      expect(extractTitle(html)).toBe('Partial HTML')
    })

    it('should handle empty string', () => {
      expect(extractTitle('')).toBeNull()
    })
  })

  describe('removeSvgEmptyLines', () => {
    it('should remove empty lines from within SVG tags', () => {
      const svg = '<svg>\n\n<circle></circle>\n\n<rect></rect>\n\n</svg>'
      const expected = '<svg>\n<circle></circle>\n<rect></rect>\n</svg>'
      expect(removeSvgEmptyLines(svg)).toBe(expected)
    })

    it('should handle SVG with only whitespace lines', () => {
      const svg = '<svg>\n  \n\t\n</svg>'
      const expected = '<svg>\n</svg>'
      expect(removeSvgEmptyLines(svg)).toBe(expected)
    })

    it('should handle multiple SVG tags', () => {
      const content = 'Text <svg>\n\n<circle></circle>\n\n</svg> More <svg>\n\n<rect></rect>\n\n</svg>'
      const expected = 'Text <svg>\n<circle></circle>\n</svg> More <svg>\n<rect></rect>\n</svg>'
      expect(removeSvgEmptyLines(content)).toBe(expected)
    })

    it('should not affect content outside SVG tags', () => {
      const content = 'Line 1\n\nLine 2\n\n<svg>\n<circle></circle>\n</svg>\n\nLine 3'
      expect(removeSvgEmptyLines(content)).toBe(content)
    })

    it('should handle multiline SVG with attributes', () => {
      const svg = '<svg width="100" height="100"\n\nviewBox="0 0 100 100">\n\n<circle></circle>\n\n</svg>'
      const expected = '<svg width="100" height="100"\nviewBox="0 0 100 100">\n<circle></circle>\n</svg>'
      expect(removeSvgEmptyLines(svg)).toBe(expected)
    })

    it('should handle string without SVG tags', () => {
      const content = 'Text without SVG'
      expect(removeSvgEmptyLines(content)).toBe(content)
    })
  })

  describe('withGeminiGrounding', () => {
    it('should add citation numbers to text segments', () => {
      const message = {
        id: '1',
        role: 'assistant' as const,
        content: 'Paris is the capital of France.',
        metadata: {
          groundingMetadata: {
            groundingSupports: [
              {
                segment: { text: 'Paris is the capital of France' },
                groundingChunkIndices: [0, 1]
              }
            ]
          }
        }
      } as unknown as Message

      const result = withGeminiGrounding(message)
      expect(result).toBe('Paris is the capital of France <sup>1</sup> <sup>2</sup>.')
    })

    it('should handle messages without groundingMetadata', () => {
      const message = {
        id: '1',
        role: 'assistant' as const,
        content: 'Paris is the capital of France.'
      } as unknown as Message

      const result = withGeminiGrounding(message)
      expect(result).toBe('Paris is the capital of France.')
    })

    it('should handle messages with empty groundingSupports', () => {
      const message = {
        id: '1',
        role: 'assistant' as const,
        content: 'Paris is the capital of France.',
        metadata: {
          groundingMetadata: {
            groundingSupports: []
          }
        }
      } as unknown as Message

      const result = withGeminiGrounding(message)
      expect(result).toBe('Paris is the capital of France.')
    })

    it('should handle supports without text or indices', () => {
      const message = {
        id: '1',
        role: 'assistant' as const,
        content: 'Paris is the capital of France.',
        metadata: {
          groundingMetadata: {
            groundingSupports: [
              {
                segment: {},
                groundingChunkIndices: [0]
              },
              {
                segment: { text: 'Paris' },
                groundingChunkIndices: undefined
              }
            ]
          }
        }
      } as unknown as Message

      const result = withGeminiGrounding(message)
      expect(result).toBe('Paris is the capital of France.')
    })
  })

  describe('withMessageThought', () => {
    beforeEach(() => {
      vi.resetAllMocks()
    })

    it('should extract thought content from GLM Zero Preview model messages', () => {
      // 模拟 isReasoningModel 返回 true
      vi.mocked(isReasoningModel).mockReturnValue(true)

      const message = {
        id: '1',
        role: 'assistant' as const,
        content: '###Thinking\nThis is my reasoning.\n###Response\nThis is my answer.',
        modelId: 'glm-zero-preview',
        model: { id: 'glm-zero-preview', name: 'GLM Zero Preview' }
      } as unknown as Message

      const result = withMessageThought(message)
      expect(result.reasoning_content).toBe('This is my reasoning.')
      expect(result.content).toBe('This is my answer.')
    })

    it('should extract thought content from <think> tags', () => {
      // 模拟 isReasoningModel 返回 true
      vi.mocked(isReasoningModel).mockReturnValue(true)

      const message = {
        id: '1',
        role: 'assistant' as const,
        content: '<think>This is my reasoning.</think>This is my answer.',
        model: { id: 'some-model' }
      } as unknown as Message

      const result = withMessageThought(message)
      expect(result.reasoning_content).toBe('This is my reasoning.')
      expect(result.content).toBe('This is my answer.')
    })

    it('should handle content with only opening <think> tag', () => {
      vi.mocked(isReasoningModel).mockReturnValue(true)

      const message = {
        id: '1',
        role: 'assistant' as const,
        content: '<think>This is all reasoning content',
        model: { id: 'some-model' }
      } as unknown as Message

      const result = withMessageThought(message)
      expect(result.reasoning_content).toBe('This is all reasoning content')
      expect(result.content).toBe('')
    })

    it('should handle content with only closing </think> tag', () => {
      vi.mocked(isReasoningModel).mockReturnValue(true)

      const message = {
        id: '1',
        role: 'assistant' as const,
        content: 'This is reasoning</think>This is my answer.',
        model: { id: 'some-model' }
      } as unknown as Message

      const result = withMessageThought(message)
      expect(result.reasoning_content).toBe('This is reasoning')
      expect(result.content).toBe('This is my answer.')
    })

    it('should not process content if model is not a reasoning model', () => {
      vi.mocked(isReasoningModel).mockReturnValue(false)

      const message = {
        id: '1',
        role: 'assistant' as const,
        content: '<think>Reasoning</think>Answer',
        model: { id: 'some-model' }
      } as unknown as Message

      const result = withMessageThought(message)
      expect(result).toEqual(message)
      expect(result.reasoning_content).toBeUndefined()
    })

    it('should not process user messages', () => {
      const message = {
        id: '1',
        role: 'user' as const,
        content: '<think>Reasoning</think>Answer'
      } as unknown as Message

      const result = withMessageThought(message)
      expect(result).toEqual(message)
    })

    it('should check reasoning_effort for Claude 3.7 Sonnet', () => {
      vi.mocked(isReasoningModel).mockReturnValue(true)
      vi.mocked(getAssistantById).mockReturnValue({ settings: { reasoning_effort: 'auto' } } as any)

      const message = {
        id: '1',
        role: 'assistant' as const,
        content: '<think>Reasoning</think>Answer',
        model: { id: 'claude-3-7-sonnet' },
        assistantId: 'assistant-1'
      } as unknown as Message

      const result = withMessageThought(message)
      expect(result.reasoning_content).toBe('Reasoning')
      expect(result.content).toBe('Answer')
      expect(getAssistantById).toHaveBeenCalledWith('assistant-1')
    })
  })

  describe('withGenerateImage', () => {
    it('should extract image URLs from markdown image syntax', () => {
      const message = {
        id: '1',
        role: 'assistant' as const,
        content: 'Here is an image: ![image](https://example.com/image.png)\nSome text after.',
        metadata: {}
      } as unknown as Message

      const result = withGenerateImage(message)
      expect(result.content).toBe('Here is an image: \nSome text after.')
      expect(result.metadata?.generateImage).toEqual({
        type: 'url',
        images: ['https://example.com/image.png']
      })
    })

    it('should also clean up download links', () => {
      const message = {
        id: '1',
        role: 'assistant' as const,
        content:
          'Here is an image: ![image](https://example.com/image.png)\nYou can [download it](https://example.com/download)',
        metadata: {}
      } as unknown as Message

      const result = withGenerateImage(message)
      expect(result.content).toBe('Here is an image:')
      expect(result.metadata?.generateImage).toEqual({
        type: 'url',
        images: ['https://example.com/image.png']
      })
    })

    it('should handle messages without image markdown', () => {
      const message = {
        id: '1',
        role: 'assistant' as const,
        content: 'This is just text without any images.',
        metadata: {}
      } as unknown as Message

      const result = withGenerateImage(message)
      expect(result).toEqual(message)
    })

    it('should handle image markdown with title attribute', () => {
      const message = {
        id: '1',
        role: 'assistant' as const,
        content: 'Here is an image: ![alt text](https://example.com/image.png "Image Title")',
        metadata: {}
      } as unknown as Message

      const result = withGenerateImage(message)
      expect(result.content).toBe('Here is an image:')
      expect(result.metadata?.generateImage).toEqual({
        type: 'url',
        images: ['https://example.com/image.png']
      })
    })
  })

  describe('addImageFileToContents', () => {
    it('should add image files to the assistant message', () => {
      const messages = [
        { id: '1', role: 'user' as const, content: 'Generate an image' },
        {
          id: '2',
          role: 'assistant' as const,
          content: 'Here is your image.',
          metadata: {
            generateImage: {
              images: ['image1.png', 'image2.png']
            }
          }
        }
      ] as unknown as Message[]

      const result = addImageFileToContents(messages)
      expect(result[1].images).toEqual(['image1.png', 'image2.png'])
    })

    it('should not modify messages if no assistant message with generateImage', () => {
      const messages = [
        { id: '1', role: 'user' as const, content: 'Hello' },
        { id: '2', role: 'assistant' as const, content: 'Hi there', metadata: {} }
      ] as unknown as Message[]

      const result = addImageFileToContents(messages)
      expect(result).toEqual(messages)
    })

    it('should handle messages without metadata', () => {
      const messages = [
        { id: '1', role: 'user' as const, content: 'Hello' },
        { id: '2', role: 'assistant' as const, content: 'Hi there' }
      ] as unknown as Message[]

      const result = addImageFileToContents(messages)
      expect(result).toEqual(messages)
    })

    it('should update only the last assistant message', () => {
      const messages = [
        {
          id: '1',
          role: 'assistant' as const,
          content: 'First response',
          metadata: {
            generateImage: {
              images: ['old.png']
            }
          }
        },
        { id: '2', role: 'user' as const, content: 'Another request' },
        {
          id: '3',
          role: 'assistant' as const,
          content: 'New response',
          metadata: {
            generateImage: {
              images: ['new.png']
            }
          }
        }
      ] as unknown as Message[]

      const result = addImageFileToContents(messages)
      expect(result[0].images).toBeUndefined()
      expect(result[2].images).toEqual(['new.png'])
    })
  })
})
