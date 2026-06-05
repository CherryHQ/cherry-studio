import type * as FsPromises from 'node:fs/promises'

import { fileEntryTable } from '@data/db/schemas/file'
import type {
  CherryMessagePart,
  DynamicToolUIPart,
  FileUIPart,
  ReasoningUIPart,
  TextUIPart
} from '@shared/data/types/message'
import { readCherryMeta } from '@shared/data/types/uiParts'
import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it, vi } from 'vitest'

// Use the repo-wide application mock; the default `getPath` already
// returns deterministic `/mock/<key>/<filename>` paths.
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

// Neutralize fs writes for the base64-promotion path — the unit tests
// assert on the real DB row produced by setupTestDatabase, not on the
// physical bytes. Keep the rest of node:fs/promises real for unrelated
// imports.
vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof FsPromises>('node:fs/promises')
  const stub = {
    ...actual,
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    unlink: vi.fn().mockResolvedValue(undefined)
  }
  return { ...stub, default: stub }
})

import {
  buildMessageTree,
  extractCitationReferences,
  mergeStats,
  normalizeStatus,
  type OldBlock,
  type OldCitationBlock,
  type OldMainTextBlock as OldMainTextBlockType,
  type OldMessage,
  transformBlocksToParts,
  transformMessage
} from '../ChatMappings'

const MIGRATION_FILES_DIR = '/mock/migration-userdata/Data/Files'

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
  it('returns empty map for empty input', async () => {
    expect(buildMessageTree([])).toEqual(new Map())
  })

  it('builds a linear chain for sequential messages', async () => {
    const messages = [msg('u1', 'user'), msg('a1'), msg('u2', 'user'), msg('a2')]

    const tree = buildMessageTree(messages)

    expect(tree.get('u1')).toEqual({ parentId: null, siblingsGroupId: 0 })
    expect(tree.get('a1')).toEqual({ parentId: 'u1', siblingsGroupId: 0 })
    expect(tree.get('u2')).toEqual({ parentId: 'a1', siblingsGroupId: 0 })
    expect(tree.get('a2')).toEqual({ parentId: 'u2', siblingsGroupId: 0 })
  })

  it('groups multi-model responses under the user message', async () => {
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

  it('links user message after multi-model group to foldSelected response', async () => {
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

  it('falls back to previousMessageId when askId points to deleted message', async () => {
    // User message 'u1' was deleted, but assistant responses still have askId: 'u1'
    const messages = [msg('a1', 'assistant', { askId: 'u1' }), msg('a2', 'assistant', { askId: 'u1' })]

    const tree = buildMessageTree(messages)

    // askId 'u1' doesn't exist in messages, siblings share a common fallback parent
    expect(tree.get('a1')!.parentId).toBeNull() // first message, no previous → null
    expect(tree.get('a2')!.parentId).toBeNull() // same shared parent as a1
    expect(tree.get('a1')!.siblingsGroupId).toBeGreaterThan(0)
    expect(tree.get('a1')!.siblingsGroupId).toBe(tree.get('a2')!.siblingsGroupId)
  })

  it('falls back to previousMessageId when askId points to deleted message (with prior context)', async () => {
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

  it('handles mixed: some askIds valid, some pointing to deleted messages', async () => {
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

  it('does not form a group for single askId reference even when valid', async () => {
    // Only one response with askId — not a multi-model group (count == 1)
    const messages = [msg('u1', 'user'), msg('a1', 'assistant', { askId: 'u1' })]

    const tree = buildMessageTree(messages)

    // Single askId doesn't create a group, falls through to sequential
    expect(tree.get('a1')!.parentId).toBe('u1')
    expect(tree.get('a1')!.siblingsGroupId).toBe(0)
  })

  it('links user message after multi-model group with no foldSelected to last group member', async () => {
    const messages = [
      msg('u1', 'user'),
      msg('a1', 'assistant', { askId: 'u1' }),
      msg('a2', 'assistant', { askId: 'u1' }),
      msg('u2', 'user')
    ]

    const tree = buildMessageTree(messages)

    // Both responses are siblings under u1
    expect(tree.get('a1')!.parentId).toBe('u1')
    expect(tree.get('a2')!.parentId).toBe('u1')
    // u2 should link to the last group member (a2), NOT to u1
    expect(tree.get('u2')!.parentId).toBe('a2')
  })

  it('links user message after orphaned foldSelected group to the selected response', async () => {
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
  it('transforms main_text to TextUIPart', async () => {
    const { parts, searchableText } = await transformBlocksToParts([block('main_text', { content: 'Hello world' })])

    expect(parts).toHaveLength(1)
    const part = parts[0] as TextUIPart
    expect(part.type).toBe('text')
    expect(part.text).toBe('Hello world')
    expect(part.state).toBe('done')
    // Text parts only carry cherry meta when citations merge in via transformMessage;
    // standalone text blocks have no providerMetadata.
    expect(part.providerMetadata).toBeUndefined()
    expect(searchableText).toBe('Hello world')
  })

  it('transforms thinking to ReasoningUIPart with thinkingMs', async () => {
    const { parts } = await transformBlocksToParts([
      block('thinking', { content: 'Let me think...', thinking_millsec: 5000 })
    ])

    expect(parts).toHaveLength(1)
    const part = parts[0] as ReasoningUIPart
    expect(part.type).toBe('reasoning')
    expect(part.text).toBe('Let me think...')
    expect(part.state).toBe('done')
    expect(readCherryMeta(part)?.thinkingMs).toBe(5000)
  })

  it('transforms tool with rawMcpToolResponse to DynamicToolUIPart', async () => {
    const { parts } = await transformBlocksToParts([
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

  it('falls back to block fields when rawMcpToolResponse is missing', async () => {
    const { parts } = await transformBlocksToParts([
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

  it('resolves toolName from rawMcpToolResponse when block.toolName is null', async () => {
    const { parts } = await transformBlocksToParts([
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

  it('transforms tool with isError to output-error state', async () => {
    const { parts } = await transformBlocksToParts([
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

  it('transforms tool with rawMcpToolResponse status=error to output-error', async () => {
    const { parts } = await transformBlocksToParts([
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

  it('transforms image to FileUIPart', async () => {
    const { parts } = await transformBlocksToParts([block('image', { url: 'https://example.com/img.png' })])

    expect(parts).toHaveLength(1)
    const part = parts[0] as FileUIPart
    expect(part.type).toBe('file')
    expect(part.mediaType).toBe('image/png')
    expect(part.url).toBe('https://example.com/img.png')
  })

  it('transforms image with file path to file:// URL', async () => {
    const { parts } = await transformBlocksToParts([
      block('image', {
        file: { id: 'abc-123', path: '/Users/test/files/photo.jpg', ext: '.jpg', origin_name: 'photo.jpg' }
      })
    ])

    const part = parts[0] as FileUIPart
    expect(part.url).toBe('file:///Users/test/files/photo.jpg')
    expect(part.mediaType).toBe('image/jpeg')
    expect(part.filename).toBe('photo.jpg')
  })

  describe('base64 → file_entry promotion', () => {
    const dbh = setupTestDatabase()

    it('passes inline data: URL through unchanged when no db dep is provided', async () => {
      const dataUrl = 'data:image/png;base64,iVBORw0KGgo'
      const { parts } = await transformBlocksToParts([block('image', { url: dataUrl })])

      expect(parts).toHaveLength(1)
      const part = parts[0] as FileUIPart
      expect(part.url).toBe(dataUrl)
      expect(part.mediaType).toBe('image/png')
      // No fileEntryId — not promoted to v2 entry
      expect(part.providerMetadata?.cherry).toBeUndefined()
    })

    it('promotes inline data: URL to v2 file_entry when db dep is provided', async () => {
      const dataUrl = 'data:image/png;base64,iVBORw0KGgo='
      const { parts } = await transformBlocksToParts([block('image', { url: dataUrl })], {
        db: dbh.db,
        filesDataDir: MIGRATION_FILES_DIR
      })

      expect(parts).toHaveLength(1)
      const part = parts[0] as FileUIPart
      expect(part.url).toMatch(/^file:\/\/\/mock\/migration-userdata\/Data\/Files\/.+\.png$/)
      expect(part.mediaType).toBe('image/png')
      const fileEntryId = readCherryMeta(part)?.fileEntryId
      expect(fileEntryId).toBeTruthy()

      // Real file_entry row written
      const rows = await dbh.db.select().from(fileEntryTable)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        id: fileEntryId,
        origin: 'internal',
        name: 'migrated-image',
        ext: 'png',
        externalPath: null
      })
    })

    it('promotes each image in metadata.generateImageResponse.images to its own file_entry', async () => {
      const img1 = 'data:image/png;base64,AAA='
      const img2 = 'BBB=' // raw base64, no data: prefix — helper should wrap
      const { parts } = await transformBlocksToParts(
        [
          block('image', {
            metadata: { generateImageResponse: { type: 'base64', images: [img1, img2] } }
          })
        ],
        { db: dbh.db, filesDataDir: MIGRATION_FILES_DIR }
      )

      expect(parts).toHaveLength(2)
      const id1 = readCherryMeta(parts[0] as FileUIPart)?.fileEntryId
      const id2 = readCherryMeta(parts[1] as FileUIPart)?.fileEntryId
      expect(id1).toBeTruthy()
      expect(id2).toBeTruthy()
      expect(id1).not.toBe(id2)

      const rows = await dbh.db.select().from(fileEntryTable)
      expect(rows).toHaveLength(2)
      const idSet = new Set(rows.map((r) => r.id))
      expect(idSet.has(id1!)).toBe(true)
      expect(idSet.has(id2!)).toBe(true)
      for (const row of rows) {
        expect(row.origin).toBe('internal')
        expect(row.ext).toBe('png')
      }
    })

    it('drops metadata.generateImageResponse base64 images when no db dep is provided (parity with pre-helper behavior)', async () => {
      const { parts } = await transformBlocksToParts([
        block('image', {
          metadata: { generateImageResponse: { type: 'base64', images: ['AAA='] } }
        })
      ])

      expect(parts).toHaveLength(0)
    })

    it('ignores metadata.generateImageResponse when type is url (remote URLs, not base64)', async () => {
      const { parts } = await transformBlocksToParts(
        [
          block('image', {
            metadata: {
              generateImageResponse: { type: 'url', images: ['https://example.com/a.png'] }
            }
          })
        ],
        { db: dbh.db, filesDataDir: MIGRATION_FILES_DIR }
      )

      // The remote URL is in generateImageResponse, not block.url — so no part for now;
      // promotion only triggers when type === 'base64'.
      expect(parts).toHaveLength(0)
      // No file_entry rows written.
      const rows = await dbh.db.select().from(fileEntryTable)
      expect(rows).toHaveLength(0)
    })
  })

  it('transforms file to FileUIPart with path and inferred mediaType', async () => {
    const { parts } = await transformBlocksToParts([
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

  it('transforms error to data-error DataUIPart', async () => {
    const { parts } = await transformBlocksToParts([
      block('error', { error: { name: 'AbortError', message: 'paused' } })
    ])

    expect(parts).toHaveLength(1)
    const part = parts[0] as CherryMessagePart & { data: Record<string, unknown> }
    expect(part.type).toBe('data-error')
    expect(part.data.name).toBe('AbortError')
    expect(part.data.message).toBe('paused')
  })

  it('transforms translation to data-translation DataUIPart', async () => {
    const { parts, searchableText } = await transformBlocksToParts([
      block('translation', { content: '翻译内容', targetLanguage: 'chinese' })
    ])

    const part = parts[0] as CherryMessagePart & { data: Record<string, unknown> }
    expect(part.type).toBe('data-translation')
    expect(part.data.content).toBe('翻译内容')
    expect(part.data.targetLanguage).toBe('chinese')
    expect(searchableText).toBe('翻译内容')
  })

  it('transforms video to data-video DataUIPart', async () => {
    const { parts } = await transformBlocksToParts([block('video', { url: 'https://example.com/video.mp4' })])

    const part = parts[0] as CherryMessagePart & { data: Record<string, unknown> }
    expect(part.type).toBe('data-video')
    expect(part.data.url).toBe('https://example.com/video.mp4')
  })

  it('transforms compact to data-compact DataUIPart', async () => {
    const { parts } = await transformBlocksToParts([
      block('compact', { content: 'summary', compactedContent: 'original long text' })
    ])

    const part = parts[0] as CherryMessagePart & { data: Record<string, unknown> }
    expect(part.type).toBe('data-compact')
    expect(part.data.content).toBe('summary')
    expect(part.data.compactedContent).toBe('original long text')
  })

  it('transforms code to data-code DataUIPart', async () => {
    const { parts } = await transformBlocksToParts([
      block('code', { content: 'console.log("hi")', language: 'javascript' })
    ])

    const part = parts[0] as CherryMessagePart & { data: Record<string, unknown> }
    expect(part.type).toBe('data-code')
    expect(part.data.content).toBe('console.log("hi")')
    expect(part.data.language).toBe('javascript')
  })

  it('extracts web citation results as SourceUrlUIPart', async () => {
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

    const { parts, citationReferences } = await transformBlocksToParts([citationBlock])

    // Web results → SourceUrlUIPart
    expect(parts).toHaveLength(2)
    expect(parts[0].type).toBe('source-url')
    expect((parts[0] as any).url).toBe('https://example.com/1')
    expect((parts[0] as any).title).toBe('Result 1')
    expect(parts[1].type).toBe('source-url')

    // Knowledge/memory → still in citationReferences for providerMetadata
    expect(citationReferences).toHaveLength(2) // web + knowledge
  })

  it('skips citation results without URL', async () => {
    const citationBlock: OldCitationBlock = {
      ...block('citation'),
      type: 'citation',
      response: { results: ['r1', 'r2'], source: 'google' }
    }

    const { parts } = await transformBlocksToParts([citationBlock])

    // String results have no url → no source parts
    expect(parts).toHaveLength(0)
  })

  it('skips unknown blocks', async () => {
    const { parts } = await transformBlocksToParts([block('unknown')])
    expect(parts).toHaveLength(0)
  })

  it('handles mixed block types in order', async () => {
    const { parts } = await transformBlocksToParts([
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

// ============================================================================
// transformMessage
// ============================================================================

function mainTextBlock(id: string, messageId: string, content: string): OldMainTextBlockType {
  return {
    id,
    messageId,
    type: 'main_text',
    createdAt: '2025-01-01T00:00:00.000Z',
    status: 'success',
    content
  }
}

describe('transformMessage', () => {
  it('builds UniqueModelId from model object', async () => {
    const oldMsg: OldMessage = {
      ...msg('m1', 'assistant'),
      model: { id: 'gpt-4', name: 'GPT-4', provider: 'openai', group: 'default' }
    }
    const blocks: OldBlock[] = [mainTextBlock('b1', 'm1', 'hello')]

    const result = await transformMessage(oldMsg, null, 0, blocks, 'topic-1')

    expect(result.modelId).toBe('openai::gpt-4')
  })

  it('keeps fallback modelId only when it is already a UniqueModelId', async () => {
    const oldMsg: OldMessage = { ...msg('m1', 'assistant'), modelId: 'openai::raw-model-id' }
    const blocks: OldBlock[] = [mainTextBlock('b1', 'm1', 'hello')]

    const result = await transformMessage(oldMsg, null, 0, blocks, 'topic-1')

    expect(result.modelId).toBe('openai::raw-model-id')
  })

  it('drops fallback modelId when model object is missing and fallback is not a UniqueModelId', async () => {
    const oldMsg: OldMessage = { ...msg('m1', 'assistant'), modelId: 'raw-model-id' }
    const blocks: OldBlock[] = [mainTextBlock('b1', 'm1', 'hello')]

    const result = await transformMessage(oldMsg, null, 0, blocks, 'topic-1')

    expect(result.modelId).toBeNull()
  })

  it('returns null modelId when both model and modelId are missing', async () => {
    const oldMsg: OldMessage = msg('m1', 'assistant')
    const blocks: OldBlock[] = [mainTextBlock('b1', 'm1', 'hello')]

    const result = await transformMessage(oldMsg, null, 0, blocks, 'topic-1')

    expect(result.modelId).toBeNull()
  })

  it('builds modelSnapshot from model object', async () => {
    const oldMsg: OldMessage = {
      ...msg('m1', 'assistant'),
      model: { id: 'gpt-4', name: 'GPT-4', provider: 'openai', group: 'chatgpt' }
    }
    const blocks: OldBlock[] = [mainTextBlock('b1', 'm1', 'hello')]

    const result = await transformMessage(oldMsg, null, 0, blocks, 'topic-1')

    expect(result.modelSnapshot).toEqual({
      id: 'gpt-4',
      name: 'GPT-4',
      provider: 'openai',
      group: 'chatgpt'
    })
  })

  it('returns null modelSnapshot when model is missing', async () => {
    const result = await transformMessage(msg('m1', 'assistant'), null, 0, [mainTextBlock('b1', 'm1', 'x')], 't1')
    expect(result.modelSnapshot).toBeNull()
  })

  it('drops legacy traceId because span history is not migrated', async () => {
    const result = await transformMessage(
      { ...msg('m1', 'assistant'), traceId: 'legacy-trace-id' },
      null,
      0,
      [mainTextBlock('b1', 'm1', 'x')],
      't1'
    )

    expect(result.traceId).toBeNull()
  })

  it('does not stamp block-level createdAt/updatedAt/metadata/error onto part.providerMetadata.cherry', async () => {
    const blocks: OldBlock[] = [
      {
        ...mainTextBlock('b1', 'm1', 'hello'),
        createdAt: '2025-02-02T00:00:00.000Z',
        updatedAt: '2025-02-03T00:00:00.000Z',
        metadata: { legacy: 'value' },
        error: { name: 'OldErr', message: 'old' }
      } as OldMainTextBlockType
    ]
    const result = await transformMessage(msg('m1', 'assistant'), null, 0, blocks, 't1')
    const part = result.data.parts?.[0] as TextUIPart
    expect(part.providerMetadata).toBeUndefined()
  })

  it('writes citation references onto the first TextUIPart via withCherryMeta', async () => {
    const citationBlock: OldCitationBlock = {
      ...block('citation'),
      type: 'citation',
      response: {
        results: [{ title: 'Ex', url: 'https://ex.com', content: 'snippet' }],
        source: 'websearch'
      }
    } as OldCitationBlock
    const blocks: OldBlock[] = [mainTextBlock('b1', 'm1', 'cited [1]'), citationBlock]
    const result = await transformMessage(msg('m1', 'assistant'), null, 0, blocks, 't1')
    const textPart = result.data.parts?.find((p) => p.type === 'text') as TextUIPart
    const meta = readCherryMeta(textPart)
    const references = meta?.references as { category: string }[] | undefined
    expect(references).toBeDefined()
    expect(references?.[0]?.category).toBe('citation')
  })
})

// ============================================================================
// normalizeStatus
// ============================================================================

describe('normalizeStatus', () => {
  it('maps success/paused directly', async () => {
    expect(normalizeStatus('success')).toBe('success')
    expect(normalizeStatus('paused')).toBe('paused')
  })

  it('maps transient states to error', async () => {
    expect(normalizeStatus('sending')).toBe('error')
    expect(normalizeStatus('pending')).toBe('error')
    expect(normalizeStatus('searching')).toBe('error')
    expect(normalizeStatus('processing')).toBe('error')
    expect(normalizeStatus('error')).toBe('error')
  })
})

// ============================================================================
// mergeStats
// ============================================================================

describe('mergeStats', () => {
  it('returns null when both usage and metrics are missing', async () => {
    expect(mergeStats()).toBeNull()
    expect(mergeStats(undefined, undefined)).toBeNull()
  })

  it('merges usage tokens', async () => {
    const stats = mergeStats({ prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 })
    expect(stats).toEqual({ promptTokens: 10, completionTokens: 20, totalTokens: 30 })
  })

  it('merges metrics timing', async () => {
    const stats = mergeStats(undefined, { time_first_token_millsec: 100, time_completion_millsec: 500 })
    expect(stats).toEqual({ timeFirstTokenMs: 100, timeCompletionMs: 500 })
  })

  it('merges both usage and metrics', async () => {
    const stats = mergeStats({ prompt_tokens: 5 }, { time_thinking_millsec: 200 })
    expect(stats).toEqual({ promptTokens: 5, timeThinkingMs: 200 })
  })
})

// ============================================================================
// extractCitationReferences
// ============================================================================

describe('extractCitationReferences', () => {
  const baseCitationBlock: OldCitationBlock = {
    id: 'c1',
    messageId: 'm1',
    type: 'citation',
    createdAt: '2025-01-01T00:00:00.000Z',
    status: 'success'
  }

  it('extracts web citations with results and source preserved', async () => {
    const block: OldCitationBlock = {
      ...baseCitationBlock,
      response: { results: [{ title: 'Result', url: 'https://x.com', snippet: 'text' }], source: 'google' }
    }
    const refs = extractCitationReferences(block)
    expect(refs).toHaveLength(1)
    const ref = refs[0] as any
    expect(ref.citationType).toBe('web')
    expect(ref.content.results).toEqual([{ title: 'Result', url: 'https://x.com', snippet: 'text' }])
    expect(ref.content.source).toBe('google')
  })

  it('extracts knowledge citations with content mapped', async () => {
    const block: OldCitationBlock = {
      ...baseCitationBlock,
      knowledge: [{ id: 'k1', content: 'text', sourceUrl: 'https://doc.com', type: 'pdf' } as any]
    }
    const refs = extractCitationReferences(block)
    expect(refs).toHaveLength(1)
    const ref = refs[0] as any
    expect(ref.citationType).toBe('knowledge')
    expect(ref.content).toHaveLength(1)
    expect(ref.content[0]).toMatchObject({ id: 'k1', content: 'text', sourceUrl: 'https://doc.com', type: 'pdf' })
  })

  it('extracts memory citations with fields mapped', async () => {
    const block: OldCitationBlock = {
      ...baseCitationBlock,
      memories: [{ id: 'mem1', memory: 'user likes coffee', hash: 'abc', score: 0.9 } as any]
    }
    const refs = extractCitationReferences(block)
    expect(refs).toHaveLength(1)
    const ref = refs[0] as any
    expect(ref.citationType).toBe('memory')
    expect(ref.content).toHaveLength(1)
    expect(ref.content[0]).toMatchObject({ id: 'mem1', memory: 'user likes coffee', hash: 'abc', score: 0.9 })
  })

  it('extracts all citation types from a single block', async () => {
    const block: OldCitationBlock = {
      ...baseCitationBlock,
      response: { results: [{ title: 'T', url: 'https://x.com' }], source: 'bing' },
      knowledge: [{ id: 'k1', content: 'doc' } as any],
      memories: [{ id: 'm1', memory: 'fact' } as any]
    }
    const refs = extractCitationReferences(block)
    expect(refs).toHaveLength(3)
    const types = refs.map((r: any) => r.citationType)
    expect(types).toEqual(['web', 'knowledge', 'memory'])
  })

  it('returns empty array when no citations exist', async () => {
    expect(extractCitationReferences(baseCitationBlock)).toEqual([])
  })
})
