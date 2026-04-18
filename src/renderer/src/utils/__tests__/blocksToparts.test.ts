import type { MessageBlock } from '@renderer/types/newMessage'
import { MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import { describe, expect, it } from 'vitest'

import { blocksToParts, blockToPart } from '../blocksToparts'

const BASE = {
  id: 'block-1',
  messageId: 'msg-1',
  createdAt: '2026-04-08T00:00:00.000Z',
  status: MessageBlockStatus.SUCCESS
}

function makeBlock(overrides: Partial<MessageBlock> & { type: MessageBlock['type'] }): MessageBlock {
  return { ...BASE, ...overrides } as MessageBlock
}

describe('blockToPart', () => {
  describe('MAIN_TEXT', () => {
    it('should convert to text part', () => {
      const block = makeBlock({ type: MessageBlockType.MAIN_TEXT, content: 'Hello' })
      const part = blockToPart(block)

      expect(part).toMatchObject({ type: 'text', text: 'Hello' })
    })

    it('should handle empty content', () => {
      const block = makeBlock({ type: MessageBlockType.MAIN_TEXT, content: '' })
      const part = blockToPart(block)

      expect(part).toMatchObject({ type: 'text', text: '' })
    })
  })

  describe('THINKING', () => {
    it('should convert to reasoning part', () => {
      const block = makeBlock({ type: MessageBlockType.THINKING, content: 'Let me think...' })
      const part = blockToPart(block)

      expect(part).toMatchObject({ type: 'reasoning', text: 'Let me think...' })
    })
  })

  describe('IMAGE', () => {
    it('should convert to file part with image mediaType', () => {
      const block = makeBlock({ type: MessageBlockType.IMAGE, url: 'file:///img.png' })
      const part = blockToPart(block)

      expect(part).toMatchObject({ type: 'file', mediaType: 'image/png', url: 'file:///img.png' })
    })
  })

  describe('FILE', () => {
    it('should convert to file part with file path', () => {
      const block = makeBlock({
        type: MessageBlockType.FILE,
        file: {
          id: 'f1',
          name: 'doc.pdf',
          origin_name: 'doc.pdf',
          path: '/tmp/doc.pdf',
          size: 100,
          ext: 'pdf',
          type: 'other' as any,
          count: 0,
          created_at: '2026-04-08'
        }
      })
      const part = blockToPart(block)

      expect(part).toMatchObject({
        type: 'file',
        mediaType: 'application/octet-stream',
        url: 'file:///tmp/doc.pdf',
        filename: 'doc.pdf'
      })
    })
  })

  describe('TOOL', () => {
    it('should convert to tool-* part preserving toolCallId and data', () => {
      const block = makeBlock({
        type: MessageBlockType.TOOL,
        toolId: 'call_abc',
        toolName: 'web_search',
        arguments: { query: 'test' },
        content: { results: ['r1'] }
      })
      const part = blockToPart(block) as any

      expect(part.type).toBe('tool-web_search')
      expect(part.toolCallId).toBe('call_abc')
      expect(part.toolName).toBe('web_search')
      expect(part.state).toBe('output-available')
      expect(part.input).toEqual({ query: 'test' })
      expect(part.output).toEqual({ results: ['r1'] })
    })

    it('should set state to output-error when block status is error', () => {
      const block = makeBlock({
        type: MessageBlockType.TOOL,
        toolId: 'call_err',
        toolName: 'failing_tool',
        status: MessageBlockStatus.ERROR
      })
      const part = blockToPart(block) as any

      expect(part.state).toBe('output-error')
    })

    it('should default toolName to unknown when missing', () => {
      const block = makeBlock({
        type: MessageBlockType.TOOL,
        toolId: 'call_no_name'
      })
      const part = blockToPart(block) as any

      expect(part.type).toBe('tool-unknown')
      expect(part.toolName).toBe('unknown')
    })
  })

  describe('CITATION', () => {
    it('should convert to data-citation part preserving all fields', () => {
      const block = makeBlock({
        type: MessageBlockType.CITATION,
        response: { results: [{ title: 'Page', url: 'https://example.com' }] } as any,
        knowledge: [{ id: 'k1' }] as any,
        memories: [{ id: 'm1' }] as any
      })
      const part = blockToPart(block) as any

      expect(part.type).toBe('data-citation')
      expect(part.data.response.results).toHaveLength(1)
      expect(part.data.knowledge).toHaveLength(1)
      expect(part.data.memories).toHaveLength(1)
    })

    it('should handle empty citation block', () => {
      const block = makeBlock({ type: MessageBlockType.CITATION })
      const part = blockToPart(block) as any

      expect(part.type).toBe('data-citation')
      expect(part.data.response).toBeUndefined()
    })
  })

  describe('ERROR', () => {
    it('should convert to data-error part', () => {
      const block = makeBlock({
        type: MessageBlockType.ERROR,
        error: { name: 'RateLimit', message: 'Too many requests', stack: null }
      })
      const part = blockToPart(block) as any

      expect(part.type).toBe('data-error')
      expect(part.data.name).toBe('RateLimit')
      expect(part.data.message).toBe('Too many requests')
    })

    it('should preserve structured API error fields', () => {
      const block = makeBlock({
        type: MessageBlockType.ERROR,
        error: {
          name: 'AI_APICallError',
          message: 'Unauthorized',
          stack: 'stack',
          cause: 'null',
          statusCode: 401,
          responseBody: '{"error":"Invalid signature"}',
          responseHeaders: { 'content-type': 'application/json' },
          requestBodyValues: { model: 'qwen' },
          url: 'https://api.example.com/chat/completions',
          isRetryable: false,
          data: null
        }
      })
      const part = blockToPart(block) as any

      expect(part.type).toBe('data-error')
      expect(part.data.statusCode).toBe(401)
      expect(part.data.responseBody).toBe('{"error":"Invalid signature"}')
      expect(part.data.url).toBe('https://api.example.com/chat/completions')
    })
  })

  describe('TRANSLATION', () => {
    it('should convert to data-translation part', () => {
      const block = makeBlock({
        type: MessageBlockType.TRANSLATION,
        content: '翻译内容',
        targetLanguage: 'chinese',
        sourceLanguage: 'english'
      })
      const part = blockToPart(block) as any

      expect(part.type).toBe('data-translation')
      expect(part.data.content).toBe('翻译内容')
      expect(part.data.targetLanguage).toBe('chinese')
      expect(part.data.sourceLanguage).toBe('english')
    })
  })

  describe('VIDEO', () => {
    it('should convert to data-video part', () => {
      const block = makeBlock({
        type: MessageBlockType.VIDEO,
        url: 'https://example.com/video.mp4'
      })
      const part = blockToPart(block) as any

      expect(part.type).toBe('data-video')
      expect(part.data.url).toBe('https://example.com/video.mp4')
    })
  })

  describe('COMPACT', () => {
    it('should convert to data-compact part', () => {
      const block = makeBlock({
        type: MessageBlockType.COMPACT,
        content: '摘要',
        compactedContent: '原始长文'
      })
      const part = blockToPart(block) as any

      expect(part.type).toBe('data-compact')
      expect(part.data.content).toBe('摘要')
      expect(part.data.compactedContent).toBe('原始长文')
    })
  })

  describe('CODE', () => {
    it('should convert to data-code part', () => {
      const block = makeBlock({
        type: MessageBlockType.CODE,
        content: 'print("hi")',
        language: 'python'
      })
      const part = blockToPart(block) as any

      expect(part.type).toBe('data-code')
      expect(part.data.content).toBe('print("hi")')
      expect(part.data.language).toBe('python')
    })
  })

  describe('unknown types', () => {
    it('should return null for unknown block types', () => {
      const block = makeBlock({ type: 'unknown_block_type' as any })
      expect(blockToPart(block)).toBeNull()
    })
  })
})

describe('blocksToParts', () => {
  it('should convert multiple blocks and filter nulls', () => {
    const blocks: MessageBlock[] = [
      makeBlock({ type: MessageBlockType.MAIN_TEXT, content: 'Hello' }),
      makeBlock({ type: 'unknown_type' as any }),
      makeBlock({ type: MessageBlockType.THINKING, content: 'Hmm' })
    ]

    const parts = blocksToParts(blocks)
    expect(parts).toHaveLength(2)
    expect(parts[0]).toMatchObject({ type: 'text', text: 'Hello' })
    expect(parts[1]).toMatchObject({ type: 'reasoning', text: 'Hmm' })
  })

  it('should return empty array for empty input', () => {
    expect(blocksToParts([])).toEqual([])
  })

  it('should preserve tool and citation parts during round-trip edit', () => {
    const blocks: MessageBlock[] = [
      makeBlock({ type: MessageBlockType.MAIN_TEXT, content: 'Edited text' }),
      makeBlock({
        type: MessageBlockType.TOOL,
        toolId: 'call_1',
        toolName: 'search',
        arguments: { q: 'test' },
        content: { r: 1 }
      }),
      makeBlock({ type: MessageBlockType.CITATION, response: { results: [] } as any })
    ]

    const parts = blocksToParts(blocks)
    expect(parts).toHaveLength(3)
    expect(parts[0]).toMatchObject({ type: 'text' })
    expect((parts[1] as any).type).toBe('tool-search')
    expect((parts[2] as any).type).toBe('data-citation')
  })
})
