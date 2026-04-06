import type {
  CherryMessagePart,
  DynamicToolUIPart,
  FileUIPart,
  ReasoningUIPart,
  TextUIPart
} from '@shared/data/types/message'
import { describe, expect, it } from 'vitest'

import {
  buildMessageTree,
  type OldBlock,
  type OldCitationBlock,
  type OldMessage,
  transformBlocksToParts
} from '../ChatMappings'

/** Helper: create a minimal OldMessage stub */
function msg(id: string, role: 'user' | 'assistant' = 'assistant', extra: Partial<OldMessage> = {}): OldMessage {
  return {
    id,
    role,
    assistantId: 'a1',
    topicId: 't1',
    createdAt: '2025-01-01T00:00:00.000Z',
    status: 'success',
    blocks: ['block-1'],
    ...extra
  }
}

describe('buildMessageTree', () => {
  it('returns empty map for empty input', () => {
    expect(buildMessageTree([])).toEqual(new Map())
  })

  it('builds a linear chain for sequential messages', () => {
    const messages = [msg('u1', 'user'), msg('a1'), msg('u2', 'user'), msg('a2')]

    const tree = buildMessageTree(messages)

    expect(tree.get('u1')).toEqual({ parentId: null, siblingsGroupId: 0 })
    expect(tree.get('a1')).toEqual({ parentId: 'u1', siblingsGroupId: 0 })
    expect(tree.get('u2')).toEqual({ parentId: 'a1', siblingsGroupId: 0 })
    expect(tree.get('a2')).toEqual({ parentId: 'u2', siblingsGroupId: 0 })
  })

  it('groups multi-model responses under the user message', () => {
    const messages = [
      msg('u1', 'user'),
      msg('a1', 'assistant', { askId: 'u1', foldSelected: true }),
      msg('a2', 'assistant', { askId: 'u1' })
    ]

    const tree = buildMessageTree(messages)

    expect(tree.get('u1')).toEqual({ parentId: null, siblingsGroupId: 0 })
    // Both responses share the same parent (user message) and siblingsGroupId
    expect(tree.get('a1')!.parentId).toBe('u1')
    expect(tree.get('a2')!.parentId).toBe('u1')
    expect(tree.get('a1')!.siblingsGroupId).toBeGreaterThan(0)
    expect(tree.get('a1')!.siblingsGroupId).toBe(tree.get('a2')!.siblingsGroupId)
  })

  it('links user message after multi-model group to foldSelected response', () => {
    const messages = [
      msg('u1', 'user'),
      msg('a1', 'assistant', { askId: 'u1', foldSelected: true }),
      msg('a2', 'assistant', { askId: 'u1' }),
      msg('u2', 'user')
    ]

    const tree = buildMessageTree(messages)

    // u2 should link to the foldSelected response (a1)
    expect(tree.get('u2')!.parentId).toBe('a1')
  })

  // --- The fix: askId pointing to a deleted user message ---

  it('falls back to previousMessageId when askId points to deleted message', () => {
    // User message 'u1' was deleted, but assistant responses still have askId: 'u1'
    const messages = [msg('a1', 'assistant', { askId: 'u1' }), msg('a2', 'assistant', { askId: 'u1' })]

    const tree = buildMessageTree(messages)

    // askId 'u1' doesn't exist in messages, siblings share a common fallback parent
    expect(tree.get('a1')!.parentId).toBeNull() // first message, no previous → null
    expect(tree.get('a2')!.parentId).toBeNull() // same shared parent as a1
    expect(tree.get('a1')!.siblingsGroupId).toBeGreaterThan(0)
    expect(tree.get('a1')!.siblingsGroupId).toBe(tree.get('a2')!.siblingsGroupId)
  })

  it('falls back to previousMessageId when askId points to deleted message (with prior context)', () => {
    // There's a prior message, then the deleted user message's responses
    const messages = [
      msg('prev', 'assistant'),
      msg('a1', 'assistant', { askId: 'deleted-user-msg' }),
      msg('a2', 'assistant', { askId: 'deleted-user-msg' })
    ]

    const tree = buildMessageTree(messages)

    // Orphaned siblings share 'prev' as common parent and keep siblingsGroupId
    expect(tree.get('a1')!.parentId).toBe('prev')
    expect(tree.get('a2')!.parentId).toBe('prev')
    expect(tree.get('a1')!.siblingsGroupId).toBeGreaterThan(0)
    expect(tree.get('a1')!.siblingsGroupId).toBe(tree.get('a2')!.siblingsGroupId)
  })

  it('handles mixed: some askIds valid, some pointing to deleted messages', () => {
    const messages = [
      msg('u1', 'user'),
      // Valid multi-model group
      msg('a1', 'assistant', { askId: 'u1', foldSelected: true }),
      msg('a2', 'assistant', { askId: 'u1' }),
      // Orphaned group (user message deleted)
      msg('a3', 'assistant', { askId: 'deleted-msg' }),
      msg('a4', 'assistant', { askId: 'deleted-msg' })
    ]

    const tree = buildMessageTree(messages)

    // Valid group: siblings under u1
    expect(tree.get('a1')!.parentId).toBe('u1')
    expect(tree.get('a2')!.parentId).toBe('u1')
    expect(tree.get('a1')!.siblingsGroupId).toBeGreaterThan(0)

    // Orphaned group: siblings share common parent (a2, last before group) and keep groupId
    expect(tree.get('a3')!.parentId).toBe('a2')
    expect(tree.get('a4')!.parentId).toBe('a2')
    expect(tree.get('a3')!.siblingsGroupId).toBeGreaterThan(0)
    expect(tree.get('a3')!.siblingsGroupId).toBe(tree.get('a4')!.siblingsGroupId)
  })

  it('does not form a group for single askId reference even when valid', () => {
    // Only one response with askId — not a multi-model group (count == 1)
    const messages = [msg('u1', 'user'), msg('a1', 'assistant', { askId: 'u1' })]

    const tree = buildMessageTree(messages)

    // Single askId doesn't create a group, falls through to sequential
    expect(tree.get('a1')!.parentId).toBe('u1')
    expect(tree.get('a1')!.siblingsGroupId).toBe(0)
  })

  it('links user message after orphaned foldSelected group to the selected response', () => {
    const messages = [
      msg('prev', 'assistant'),
      msg('a1', 'assistant', { askId: 'deleted', foldSelected: true }),
      msg('a2', 'assistant', { askId: 'deleted' }),
      msg('u1', 'user')
    ]

    const tree = buildMessageTree(messages)

    // Orphaned siblings share 'prev' as parent
    expect(tree.get('a1')!.parentId).toBe('prev')
    expect(tree.get('a2')!.parentId).toBe('prev')
    // u1 should link to foldSelected response a1
    expect(tree.get('u1')!.parentId).toBe('a1')
  })
})

// ============================================================================
// transformBlocksToParts
// ============================================================================

/** Helper: create a minimal OldBlock stub */
function block(type: string, extra: Record<string, unknown> = {}): OldBlock {
  return {
    id: `block-${type}`,
    messageId: 'msg-1',
    type,
    createdAt: '2025-01-01T00:00:00.000Z',
    status: 'success',
    ...extra
  } as OldBlock
}

describe('transformBlocksToParts', () => {
  it('transforms main_text to TextUIPart', () => {
    const { parts, searchableText } = transformBlocksToParts([block('main_text', { content: 'Hello world' })])

    expect(parts).toHaveLength(1)
    const part = parts[0] as TextUIPart
    expect(part.type).toBe('text')
    expect(part.text).toBe('Hello world')
    expect(part.state).toBe('done')
    expect(part.providerMetadata?.cherry).toBeDefined()
    expect(searchableText).toBe('Hello world')
  })

  it('transforms thinking to ReasoningUIPart', () => {
    const { parts } = transformBlocksToParts([
      block('thinking', { content: 'Let me think...', thinking_millsec: 5000 })
    ])

    expect(parts).toHaveLength(1)
    const part = parts[0] as ReasoningUIPart
    expect(part.type).toBe('reasoning')
    expect(part.text).toBe('Let me think...')
    expect(part.state).toBe('done')
    expect(part.providerMetadata?.cherry.thinkingMs).toBe(5000)
  })

  it('transforms tool with rawMcpToolResponse to DynamicToolUIPart', () => {
    const { parts } = transformBlocksToParts([
      block('tool', {
        toolId: 'call-123',
        toolName: 'web_search',
        content: { content: [{ type: 'text', text: 'result' }], isError: false },
        metadata: {
          rawMcpToolResponse: {
            id: 'call-123',
            tool: { id: 'tool_web_search', name: 'web_search', type: 'mcp', serverId: 's1', serverName: 'search' },
            arguments: { query: 'test' },
            status: 'done',
            response: { content: [{ type: 'text', text: 'result' }] },
            toolCallId: 'call-123'
          }
        }
      })
    ])

    expect(parts).toHaveLength(1)
    const part = parts[0] as DynamicToolUIPart
    expect(part.type).toBe('dynamic-tool')
    // serverName + toolName merged: "search: web_search"
    expect(part.toolName).toBe('search: web_search')
    expect(part.toolCallId).toBe('call-123')
    expect(part.state).toBe('output-available')
    expect(part.input).toEqual({ query: 'test' })
    // output comes from rawMcpToolResponse.response
    expect(part.output).toEqual({ content: [{ type: 'text', text: 'result' }] })
  })

  it('falls back to block fields when rawMcpToolResponse is missing', () => {
    const { parts } = transformBlocksToParts([
      block('tool', {
        toolId: 'call-simple',
        toolName: 'calc',
        arguments: { expr: '1+1' },
        content: { content: [{ type: 'text', text: '2' }], isError: false }
      })
    ])

    const part = parts[0] as DynamicToolUIPart
    expect(part.toolName).toBe('calc')
    expect(part.input).toEqual({ expr: '1+1' })
    expect(part.state).toBe('output-available')
  })

  it('resolves toolName from rawMcpToolResponse when block.toolName is null', () => {
    const { parts } = transformBlocksToParts([
      block('tool', {
        toolId: 'call-no-name',
        // toolName is undefined
        metadata: {
          rawMcpToolResponse: {
            id: 'call-no-name',
            tool: { id: 'tool_fetch', name: 'fetch_url', type: 'mcp' },
            arguments: { url: 'https://example.com' },
            status: 'done',
            response: { content: [{ type: 'text', text: 'ok' }] },
            toolCallId: 'call-no-name'
          }
        }
      })
    ])

    const part = parts[0] as DynamicToolUIPart
    expect(part.toolName).toBe('fetch_url')
    expect(part.input).toEqual({ url: 'https://example.com' })
  })

  it('transforms tool with isError to output-error state', () => {
    const { parts } = transformBlocksToParts([
      block('tool', {
        toolId: 'call-456',
        toolName: 'fetch',
        content: { isError: true, content: [{ type: 'text', text: 'timeout' }] }
      })
    ])

    const part = parts[0] as DynamicToolUIPart
    expect(part.state).toBe('output-error')
    expect(part.errorText).toBeDefined()
  })

  it('transforms tool with rawMcpToolResponse status=error to output-error', () => {
    const { parts } = transformBlocksToParts([
      block('tool', {
        toolId: 'call-err',
        toolName: 'broken',
        content: { content: [], isError: false },
        metadata: {
          rawMcpToolResponse: {
            id: 'call-err',
            tool: { id: 'tool_broken', name: 'broken', type: 'mcp' },
            status: 'error',
            response: 'connection refused',
            toolCallId: 'call-err'
          }
        }
      })
    ])

    const part = parts[0] as DynamicToolUIPart
    expect(part.state).toBe('output-error')
    expect(part.errorText).toBe('connection refused')
  })

  it('transforms image to FileUIPart', () => {
    const { parts } = transformBlocksToParts([block('image', { url: 'https://example.com/img.png' })])

    expect(parts).toHaveLength(1)
    const part = parts[0] as FileUIPart
    expect(part.type).toBe('file')
    expect(part.mediaType).toBe('image/png')
    expect(part.url).toBe('https://example.com/img.png')
  })

  it('transforms image with file path to file:// URL', () => {
    const { parts } = transformBlocksToParts([
      block('image', {
        file: { id: 'abc-123', path: '/Users/test/files/photo.jpg', ext: '.jpg', origin_name: 'photo.jpg' }
      })
    ])

    const part = parts[0] as FileUIPart
    expect(part.url).toBe('file:///Users/test/files/photo.jpg')
    expect(part.mediaType).toBe('image/jpeg')
    expect(part.filename).toBe('photo.jpg')
  })

  it('transforms file to FileUIPart with path and inferred mediaType', () => {
    const { parts } = transformBlocksToParts([
      block('file', {
        file: { id: 'file-xyz', path: '/Users/test/files/doc.pdf', ext: '.pdf', origin_name: 'document.pdf' }
      })
    ])

    const part = parts[0] as FileUIPart
    expect(part.type).toBe('file')
    expect(part.mediaType).toBe('application/pdf')
    expect(part.url).toBe('file:///Users/test/files/doc.pdf')
    expect(part.filename).toBe('document.pdf')
  })

  it('transforms error to data-error DataUIPart', () => {
    const { parts } = transformBlocksToParts([block('error', { error: { name: 'AbortError', message: 'paused' } })])

    expect(parts).toHaveLength(1)
    const part = parts[0] as CherryMessagePart & { data: Record<string, unknown> }
    expect(part.type).toBe('data-error')
    expect(part.data.name).toBe('AbortError')
    expect(part.data.message).toBe('paused')
  })

  it('transforms translation to data-translation DataUIPart', () => {
    const { parts, searchableText } = transformBlocksToParts([
      block('translation', { content: '翻译内容', targetLanguage: 'chinese' })
    ])

    const part = parts[0] as CherryMessagePart & { data: Record<string, unknown> }
    expect(part.type).toBe('data-translation')
    expect(part.data.content).toBe('翻译内容')
    expect(part.data.targetLanguage).toBe('chinese')
    expect(searchableText).toBe('翻译内容')
  })

  it('transforms video to data-video DataUIPart', () => {
    const { parts } = transformBlocksToParts([block('video', { url: 'https://example.com/video.mp4' })])

    const part = parts[0] as CherryMessagePart & { data: Record<string, unknown> }
    expect(part.type).toBe('data-video')
    expect(part.data.url).toBe('https://example.com/video.mp4')
  })

  it('transforms compact to data-compact DataUIPart', () => {
    const { parts } = transformBlocksToParts([
      block('compact', { content: 'summary', compactedContent: 'original long text' })
    ])

    const part = parts[0] as CherryMessagePart & { data: Record<string, unknown> }
    expect(part.type).toBe('data-compact')
    expect(part.data.content).toBe('summary')
    expect(part.data.compactedContent).toBe('original long text')
  })

  it('transforms code to data-code DataUIPart', () => {
    const { parts } = transformBlocksToParts([block('code', { content: 'console.log("hi")', language: 'javascript' })])

    const part = parts[0] as CherryMessagePart & { data: Record<string, unknown> }
    expect(part.type).toBe('data-code')
    expect(part.data.content).toBe('console.log("hi")')
    expect(part.data.language).toBe('javascript')
  })

  it('extracts web citation results as SourceUrlUIPart', () => {
    const citationBlock: OldCitationBlock = {
      ...block('citation'),
      type: 'citation',
      response: {
        results: [
          { title: 'Result 1', url: 'https://example.com/1', content: 'content 1' },
          { title: 'Result 2', url: 'https://example.com/2', content: 'content 2' }
        ],
        source: 'websearch'
      },
      knowledge: [{ id: 1, content: 'fact', sourceUrl: 'https://kb.com', type: 'text' }]
    }

    const { parts, citationReferences } = transformBlocksToParts([citationBlock])

    // Web results → SourceUrlUIPart
    expect(parts).toHaveLength(2)
    expect(parts[0].type).toBe('source-url')
    expect((parts[0] as any).url).toBe('https://example.com/1')
    expect((parts[0] as any).title).toBe('Result 1')
    expect(parts[1].type).toBe('source-url')

    // Knowledge/memory → still in citationReferences for providerMetadata
    expect(citationReferences).toHaveLength(2) // web + knowledge
  })

  it('skips citation results without URL', () => {
    const citationBlock: OldCitationBlock = {
      ...block('citation'),
      type: 'citation',
      response: { results: ['r1', 'r2'], source: 'google' }
    }

    const { parts } = transformBlocksToParts([citationBlock])

    // String results have no url → no source parts
    expect(parts).toHaveLength(0)
  })

  it('skips unknown blocks', () => {
    const { parts } = transformBlocksToParts([block('unknown')])
    expect(parts).toHaveLength(0)
  })

  it('handles mixed block types in order', () => {
    const { parts } = transformBlocksToParts([
      block('main_text', { content: 'Hello' }),
      block('thinking', { content: 'Thinking...', thinking_millsec: 1000 }),
      block('main_text', { content: 'Answer' })
    ])

    expect(parts).toHaveLength(3)
    expect(parts[0].type).toBe('text')
    expect(parts[1].type).toBe('reasoning')
    expect(parts[2].type).toBe('text')
  })
})
