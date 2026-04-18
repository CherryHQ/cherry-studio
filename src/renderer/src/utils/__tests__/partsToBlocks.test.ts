import { MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import type { CherryMessagePart } from '@shared/data/types/message'
import { describe, expect, it } from 'vitest'

import { convertReferencesToCitations, mapMessageStatusToBlockStatus, partToBlock } from '../partsToBlocks'

const BASE_ARGS = {
  blockId: 'msg-1-block-0',
  messageId: 'msg-1',
  createdAt: '2026-04-07T00:00:00.000Z',
  status: MessageBlockStatus.SUCCESS
}

function callPartToBlock(part: CherryMessagePart) {
  return partToBlock(part, BASE_ARGS.blockId, BASE_ARGS.messageId, BASE_ARGS.createdAt, BASE_ARGS.status)
}

describe('partToBlock', () => {
  describe('text parts', () => {
    it('should convert text part to MainTextBlock', () => {
      const part = { type: 'text', text: 'Hello world' } as CherryMessagePart
      const block = callPartToBlock(part)

      expect(block).toMatchObject({
        id: BASE_ARGS.blockId,
        messageId: BASE_ARGS.messageId,
        type: MessageBlockType.MAIN_TEXT,
        content: 'Hello world',
        status: MessageBlockStatus.SUCCESS
      })
    })

    it('should handle empty text', () => {
      const part = { type: 'text', text: '' } as CherryMessagePart
      const block = callPartToBlock(part)
      expect((block as any).content).toBe('')
    })

    it('should convert text part with cherry references to citationReferences', () => {
      const part = {
        type: 'text',
        text: 'Hello [1]',
        providerMetadata: {
          cherry: {
            references: [
              {
                category: 'citation',
                citationType: 'web',
                content: { source: 'google' }
              }
            ]
          }
        }
      } as unknown as CherryMessagePart

      const block = callPartToBlock(part)
      expect(block).toHaveProperty('citationReferences')
      expect((block as any).citationReferences).toHaveLength(1)
      expect((block as any).citationReferences[0].citationBlockSource).toBe('google')
    })

    it('should drop non-web citations with warning', () => {
      const part = {
        type: 'text',
        text: 'Content',
        providerMetadata: {
          cherry: {
            references: [
              {
                category: 'citation',
                citationType: 'knowledge',
                content: [{ id: 1, content: 'kb data', sourceUrl: '', type: 'text' }]
              }
            ]
          }
        }
      } as unknown as CherryMessagePart

      const block = callPartToBlock(part)
      // Knowledge citations are dropped — only web citations produce citationReferences
      // Returns empty array since citations exist but none are web type
      expect((block as any).citationReferences).toEqual([])
    })
  })

  describe('providerMetadata', () => {
    it('should use cherry createdAt from providerMetadata when available', () => {
      const cherryTimestamp = 1712448000000
      const part = {
        type: 'text',
        text: 'test',
        providerMetadata: {
          cherry: { createdAt: cherryTimestamp }
        }
      } as unknown as CherryMessagePart

      const block = callPartToBlock(part)
      expect(block?.createdAt).toBe(new Date(cherryTimestamp).toISOString())
    })

    it('should fall back to provided createdAt when no providerMetadata', () => {
      const part = { type: 'text', text: 'test' } as CherryMessagePart
      const block = callPartToBlock(part)
      expect(block?.createdAt).toBe(BASE_ARGS.createdAt)
    })
  })

  describe('source-url', () => {
    it('should return null for source-url parts', () => {
      const part = { type: 'source-url', url: 'https://example.com', sourceId: 'src-1' } as unknown as CherryMessagePart
      expect(callPartToBlock(part)).toBeNull()
    })
  })

  describe('reasoning parts', () => {
    it('should convert reasoning part with thinkingMs from providerMetadata', () => {
      const part = {
        type: 'reasoning',
        text: 'Let me think...',
        providerMetadata: {
          cherry: { thinkingMs: 1500 }
        }
      } as unknown as CherryMessagePart

      const block = callPartToBlock(part)
      expect(block).toMatchObject({
        type: MessageBlockType.THINKING,
        content: 'Let me think...',
        thinking_millsec: 1500
      })
    })

    it('should default thinkingMs to 0 when no providerMetadata', () => {
      const part = { type: 'reasoning', text: 'thinking' } as CherryMessagePart
      const block = callPartToBlock(part)
      expect((block as any).thinking_millsec).toBe(0)
    })
  })

  describe('dynamic-tool parts', () => {
    it('should convert dynamic-tool part to ToolBlock with rawMcpToolResponse', () => {
      const part = {
        type: 'dynamic-tool',
        toolCallId: 'tc-1',
        toolName: 'search',
        state: 'output-available',
        input: { query: 'test' },
        output: { results: [] }
      } as unknown as CherryMessagePart

      const block = callPartToBlock(part)
      expect(block).toMatchObject({
        type: MessageBlockType.TOOL,
        toolId: 'tc-1',
        toolName: 'search',
        status: MessageBlockStatus.SUCCESS
      })
      expect((block as any).metadata.rawMcpToolResponse).toBeDefined()
      expect((block as any).metadata.rawMcpToolResponse.tool.type).toBe('mcp')
    })

    it('should handle dynamic-tool error state', () => {
      const part = {
        type: 'dynamic-tool',
        toolCallId: 'tc-2',
        toolName: 'fail-tool',
        state: 'output-error',
        errorText: 'Something went wrong'
      } as unknown as CherryMessagePart

      const block = callPartToBlock(part)
      expect(block).toMatchObject({
        type: MessageBlockType.TOOL,
        status: MessageBlockStatus.ERROR
      })
      expect((block as any).content).toMatchObject({
        isError: true,
        content: [{ type: 'text', text: 'Something went wrong' }]
      })
    })

    it('should fall back to blockId when toolCallId is empty', () => {
      const part = {
        type: 'dynamic-tool',
        toolCallId: '',
        toolName: 'test',
        state: 'output-available'
      } as unknown as CherryMessagePart

      const block = callPartToBlock(part)
      expect((block as any).toolId).toBe(BASE_ARGS.blockId)
    })
  })

  describe('file parts', () => {
    it('should convert file part with image mediaType to ImageBlock', () => {
      const part = {
        type: 'file',
        mediaType: 'image/png',
        url: 'https://example.com/image.png',
        filename: 'image.png'
      } as unknown as CherryMessagePart

      const block = callPartToBlock(part)
      expect(block).toMatchObject({
        type: MessageBlockType.IMAGE,
        url: 'https://example.com/image.png'
      })
    })

    it('should convert file part with non-image mediaType to FileBlock', () => {
      const part = {
        type: 'file',
        mediaType: 'application/pdf',
        url: 'file:///path/to/doc.pdf',
        filename: 'doc.pdf'
      } as unknown as CherryMessagePart

      const block = callPartToBlock(part)
      expect(block).toMatchObject({
        type: MessageBlockType.FILE
      })
      expect((block as any).file.path).toBe('/path/to/doc.pdf')
      expect((block as any).file.origin_name).toBe('doc.pdf')
      expect((block as any).file.type).toBe('other')
    })

    it('should return null for file part with no url (non-image)', () => {
      const part = {
        type: 'file',
        mediaType: 'application/pdf',
        filename: 'doc.pdf'
      } as unknown as CherryMessagePart

      const block = callPartToBlock(part)
      expect(block).toBeNull()
    })

    it('should convert file part with undefined mediaType to FileBlock', () => {
      const part = {
        type: 'file',
        url: 'file:///path/to/file.bin',
        filename: 'file.bin'
      } as unknown as CherryMessagePart

      const block = callPartToBlock(part)
      // mediaType undefined → does not start with 'image/' → FileBlock path
      // But url exists so should produce a block
      expect(block).toMatchObject({
        type: MessageBlockType.FILE
      })
    })
  })

  describe('tool-* parts (streaming)', () => {
    it('should convert tool-* parts from streaming', () => {
      const part = {
        type: 'tool-search',
        toolCallId: 'tc-3',
        state: 'output-available',
        toolName: 'search',
        input: { q: 'test' },
        output: { data: 'result' }
      } as unknown as CherryMessagePart

      const block = callPartToBlock(part)
      expect(block).toMatchObject({
        type: MessageBlockType.TOOL,
        toolId: 'tc-3',
        toolName: 'search',
        status: MessageBlockStatus.SUCCESS
      })
    })

    it('should map input-available state to PROCESSING', () => {
      const part = {
        type: 'tool-calc',
        toolCallId: 'tc-4',
        state: 'input-available',
        input: { x: 1 }
      } as unknown as CherryMessagePart

      const block = callPartToBlock(part)
      expect(block?.status).toBe(MessageBlockStatus.PROCESSING)
    })

    it('should extract toolName from type prefix when toolName not provided', () => {
      const part = {
        type: 'tool-my-custom-tool',
        toolCallId: 'tc-5',
        state: 'output-available'
      } as unknown as CherryMessagePart

      const block = callPartToBlock(part)
      expect((block as any).toolName).toBe('my-custom-tool')
    })
  })

  describe('data-error parts', () => {
    it('should convert data-error part to ErrorBlock', () => {
      const part = {
        type: 'data-error',
        data: { name: 'ApiError', message: 'Rate limited' }
      } as unknown as CherryMessagePart

      const block = callPartToBlock(part)
      expect(block).toMatchObject({
        type: MessageBlockType.ERROR
      })
      expect((block as any).error).toMatchObject({
        name: 'ApiError',
        message: 'Rate limited'
      })
    })

    it('should forward error code when present', () => {
      const part = {
        type: 'data-error',
        data: { name: 'ApiError', message: 'Rate limited', code: '429' }
      } as unknown as CherryMessagePart

      const block = callPartToBlock(part)
      expect((block as any).error.code).toBe('429')
    })

    it('should preserve structured API error details when present', () => {
      const part = {
        type: 'data-error',
        data: {
          name: 'AI_APICallError',
          message: 'Unauthorized',
          stack: 'stack',
          cause: 'null',
          url: 'https://api.example.com/chat/completions',
          requestBodyValues: { model: 'qwen' },
          statusCode: 401,
          responseHeaders: { 'content-type': 'application/json' },
          responseBody: '{"error":"Invalid signature"}',
          isRetryable: false,
          data: null
        }
      } as unknown as CherryMessagePart

      const block = callPartToBlock(part)
      expect((block as any).error.statusCode).toBe(401)
      expect((block as any).error.responseBody).toBe('{"error":"Invalid signature"}')
      expect((block as any).error.url).toBe('https://api.example.com/chat/completions')
    })

    it('should not include code key when code is undefined', () => {
      const part = {
        type: 'data-error',
        data: { name: 'Error', message: 'Oops' }
      } as unknown as CherryMessagePart

      const block = callPartToBlock(part)
      expect((block as any).error).not.toHaveProperty('code')
    })
  })

  describe('data-translation parts', () => {
    it('should convert data-translation part', () => {
      const part = {
        type: 'data-translation',
        data: { content: 'Translated text', targetLanguage: 'zh', sourceLanguage: 'en' }
      } as unknown as CherryMessagePart

      const block = callPartToBlock(part)
      expect(block).toMatchObject({
        type: MessageBlockType.TRANSLATION,
        content: 'Translated text',
        targetLanguage: 'zh'
      })
      expect((block as any).sourceLanguage).toBe('en')
    })
  })

  describe('data-video parts', () => {
    it('should convert data-video part', () => {
      const part = {
        type: 'data-video',
        data: { url: 'https://example.com/video.mp4' }
      } as unknown as CherryMessagePart

      const block = callPartToBlock(part)
      expect(block).toMatchObject({
        type: MessageBlockType.VIDEO,
        url: 'https://example.com/video.mp4'
      })
    })
  })

  describe('data-compact parts', () => {
    it('should convert data-compact part', () => {
      const part = {
        type: 'data-compact',
        data: { content: 'Summary', compactedContent: 'Full content here' }
      } as unknown as CherryMessagePart

      const block = callPartToBlock(part)
      expect(block).toMatchObject({
        type: MessageBlockType.COMPACT,
        content: 'Summary',
        compactedContent: 'Full content here'
      })
    })
  })

  describe('data-code parts', () => {
    it('should convert data-code part', () => {
      const part = {
        type: 'data-code',
        data: { content: 'console.log("hi")', language: 'javascript' }
      } as unknown as CherryMessagePart

      const block = callPartToBlock(part)
      expect(block).toMatchObject({
        type: MessageBlockType.CODE,
        content: 'console.log("hi")',
        language: 'javascript'
      })
    })
  })

  describe('data-citation parts', () => {
    it('should convert data-citation part to empty CitationBlock', () => {
      const part = {
        type: 'data-citation',
        data: {}
      } as unknown as CherryMessagePart

      const block = callPartToBlock(part)
      expect(block).toMatchObject({
        type: MessageBlockType.CITATION
      })
    })
  })

  describe('unknown parts', () => {
    it('should return null for unknown part types', () => {
      const part = { type: 'unknown-future-type' } as unknown as CherryMessagePart
      expect(callPartToBlock(part)).toBeNull()
    })

    it('should return null for unknown data-* part types', () => {
      const part = { type: 'data-unknown', data: {} } as unknown as CherryMessagePart
      expect(callPartToBlock(part)).toBeNull()
    })

    it('should return null for data-* parts with missing data field', () => {
      const part = { type: 'data-error' } as unknown as CherryMessagePart
      expect(callPartToBlock(part)).toBeNull()
    })
  })
})

describe('convertReferencesToCitations', () => {
  it('should build web citations and dedupe by url', () => {
    const references = [
      {
        category: 'citation',
        citationType: 'web',
        content: {
          source: 'websearch',
          results: [
            { url: 'https://a.com', title: 'A' },
            { url: 'https://a.com', title: 'A-dup' },
            { link: 'https://b.com', title: 'B' }
          ]
        }
      }
    ] as any

    const citations = convertReferencesToCitations(references)
    expect(citations).toHaveLength(2)
    expect(citations[0]).toMatchObject({ number: 1, url: 'https://a.com', title: 'A' })
    expect(citations[1]).toMatchObject({ number: 2, url: 'https://b.com', title: 'B' })
  })

  it('should include knowledge and memory citations', () => {
    const references = [
      {
        category: 'citation',
        citationType: 'knowledge',
        content: [{ id: 1, content: 'kb text', sourceUrl: 'https://kb.com/doc', type: 'text' }]
      },
      {
        category: 'citation',
        citationType: 'memory',
        content: [{ id: 'm1', memory: 'remember this', hash: '12345678abcdef' }]
      }
    ] as any

    const citations = convertReferencesToCitations(references)
    expect(citations).toHaveLength(2)
    expect(citations[0]).toMatchObject({ number: 1, type: 'knowledge', url: 'https://kb.com/doc' })
    expect(citations[1]).toMatchObject({ number: 2, type: 'memory', title: 'Memory 12345678' })
  })
})

describe('mapMessageStatusToBlockStatus', () => {
  it.each([
    ['success', MessageBlockStatus.SUCCESS],
    ['error', MessageBlockStatus.ERROR],
    ['paused', MessageBlockStatus.PAUSED],
    ['pending', MessageBlockStatus.PENDING],
    ['unknown', MessageBlockStatus.SUCCESS]
  ] as const)('should map "%s" to %s', (input, expected) => {
    expect(mapMessageStatusToBlockStatus(input)).toBe(expected)
  })
})
