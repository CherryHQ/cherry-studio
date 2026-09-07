import { CITATION_SNIPPET_MAX_CHARS } from '@shared/ai/builtinTools'
import { isDeferredToolOutput } from '@shared/ai/transport'
import type { CherryMessagePart } from '@shared/data/types/message'
import type { UIMessageChunk } from 'ai'
import { describe, expect, it } from 'vitest'

import {
  DEFER_TOOL_OUTPUT_BYTES,
  projectMessagePartForRenderer,
  projectStreamChunkForRenderer
} from '../messageOutputProjection'

const TOPIC_ID = 'agent-session:session-1'
const MESSAGE_ID = 'message-1'
const TOOL_CALL_ID = 'call-1'

const small = { content: 'x'.repeat(16) }
const large = { content: 'x'.repeat(DEFER_TOOL_OUTPUT_BYTES + 1) }
const largeAgentWebSearch = {
  content: [
    {
      id: '70536f0b-1',
      title: 'Entertainment news',
      url: 'https://example.com/news',
      content: 'x'.repeat(DEFER_TOOL_OUTPUT_BYTES + 1)
    }
  ],
  metadata: {
    type: 'mcp',
    name: 'web_search',
    serverName: 'cherry-tools',
    serverId: 'cherry-tools'
  }
}
const manyAgentWebSearch = {
  ...largeAgentWebSearch,
  content: Array.from({ length: 80 }, (_, index) => ({
    id: `many-${index + 1}`,
    title: `Result ${index + 1}`,
    url: `https://example.com/${index + 1}`,
    content: '测'.repeat(1000)
  }))
}
const largeKnowledgeSearch = [
  {
    id: 'knowledge-1',
    baseId: 'base-1',
    conceptId: 'docs/guide.md',
    title: 'Guide',
    type: 'file',
    content: 'k'.repeat(DEFER_TOOL_OUTPUT_BYTES + 1),
    score: 0.92
  }
]
const largeKnowledgeRead = {
  id: 'read-1',
  baseId: 'base-1',
  conceptId: 'docs/readme.md',
  title: 'README',
  type: 'file',
  totalChars: DEFER_TOOL_OUTPUT_BYTES + 1,
  charStart: 0,
  charEnd: DEFER_TOOL_OUTPUT_BYTES + 1,
  content: 'r'.repeat(DEFER_TOOL_OUTPUT_BYTES + 1),
  truncated: false
}
const largeKnowledgeGrep = {
  id: 'grep-1',
  baseId: 'base-1',
  conceptId: 'docs/readme.md',
  title: 'README',
  type: 'file',
  totalMatches: 2,
  matches: [
    { line: 3, charStart: 10, charEnd: 19, snippet: 'first hit' },
    {
      line: 9,
      charStart: 40,
      charEnd: DEFER_TOOL_OUTPUT_BYTES + 40,
      snippet: 'g'.repeat(DEFER_TOOL_OUTPUT_BYTES + 1)
    }
  ]
}

function partWith(output: unknown): CherryMessagePart {
  return {
    type: 'tool-Read',
    toolCallId: TOOL_CALL_ID,
    state: 'output-available',
    input: {},
    output
  } as unknown as CherryMessagePart
}

function chunkWith(output: unknown): UIMessageChunk {
  return { type: 'tool-output-available', toolCallId: TOOL_CALL_ID, output } as UIMessageChunk
}

const blob = (key: string, n: number) => ({
  key,
  fileEntryId: `entry-${n}`,
  vfsFilename: `vfs_${n}.txt`,
  head: `head-${n}`,
  tail: `tail-${n}`,
  totalChars: 1000 * n,
  totalLines: 10 * n
})

describe('message tool-output projection', () => {
  it('leaves an output that fits under the threshold untouched', () => {
    const part = partWith(small)
    expect(projectMessagePartForRenderer(part, TOPIC_ID, MESSAGE_ID)).toBe(part)

    const chunk = chunkWith(small)
    expect(projectStreamChunkForRenderer(chunk, TOPIC_ID, MESSAGE_ID)).toBe(chunk)
  })

  it('replaces an oversized output with a resolvable reference', () => {
    const projected = projectMessagePartForRenderer(partWith(large), TOPIC_ID, MESSAGE_ID) as unknown as {
      output: unknown
    }
    expect(isDeferredToolOutput(projected.output)).toBe(true)
    expect(projected.output).toEqual({
      $deferredToolResult: { topicId: TOPIC_ID, messageId: MESSAGE_ID, toolCallId: TOOL_CALL_ID }
    })
  })

  it('keeps a bounded citation skeleton for an oversized agent lookup', () => {
    const projected = projectMessagePartForRenderer(partWith(largeAgentWebSearch), TOPIC_ID, MESSAGE_ID) as unknown as {
      output: {
        skeleton?: {
          content: Array<{ id: string; content: string }>
          metadata: { name: string; serverId: string }
        }
      }
    }

    expect(projected.output.skeleton?.content[0]).toMatchObject({ id: '70536f0b-1' })
    expect(projected.output.skeleton?.content[0].content.length).toBeLessThan(
      largeAgentWebSearch.content[0].content.length
    )
    expect(projected.output.skeleton?.metadata).toMatchObject({ name: 'web_search', serverId: 'cherry-tools' })
  })

  it('keeps a citation skeleton for legacy agent lookup metadata without a tool name', () => {
    const projected = projectMessagePartForRenderer(
      partWith({
        content: largeAgentWebSearch.content,
        metadata: {
          type: 'mcp',
          serverName: 'cherry-tools',
          serverId: 'cherry-tools'
        }
      }),
      TOPIC_ID,
      MESSAGE_ID
    ) as unknown as {
      output: { skeleton?: { metadata: { name?: string; serverId: string } } }
    }

    expect(projected.output.skeleton?.metadata).toEqual({
      type: 'mcp',
      serverName: 'cherry-tools',
      serverId: 'cherry-tools'
    })
  })

  it('keeps kb_search identity fields and a bounded content preview', () => {
    const projected = projectMessagePartForRenderer(
      partWith(largeKnowledgeSearch),
      TOPIC_ID,
      MESSAGE_ID
    ) as unknown as {
      output: { skeleton?: Array<Record<string, unknown>> }
    }

    expect(projected.output.skeleton).toEqual([
      {
        ...largeKnowledgeSearch[0],
        content: `${'k'.repeat(CITATION_SNIPPET_MAX_CHARS)}…`
      }
    ])
  })

  it('keeps a bounded kb_read document slice', () => {
    const projected = projectMessagePartForRenderer(partWith(largeKnowledgeRead), TOPIC_ID, MESSAGE_ID) as unknown as {
      output: { skeleton?: Record<string, unknown> }
    }

    expect(projected.output.skeleton).toEqual({
      ...largeKnowledgeRead,
      content: `${'r'.repeat(CITATION_SNIPPET_MAX_CHARS)}…`
    })
  })

  it('keeps ordered kb_read grep matches up to the combined citation preview limit', () => {
    const projected = projectMessagePartForRenderer(partWith(largeKnowledgeGrep), TOPIC_ID, MESSAGE_ID) as unknown as {
      output: { skeleton?: { matches: Array<{ snippet: string }> } }
    }
    const matches = projected.output.skeleton?.matches ?? []
    const joined = matches.map((match) => match.snippet).join(' … ')

    expect(matches).toHaveLength(2)
    expect(joined).toHaveLength(CITATION_SNIPPET_MAX_CHARS + 1)
    expect(joined).toMatch(/^first hit … g+…$/)
  })

  it('does not expose a citation skeleton for a third-party MCP lookup', () => {
    const projected = projectMessagePartForRenderer(
      partWith({
        ...largeAgentWebSearch,
        metadata: { ...largeAgentWebSearch.metadata, serverName: 'other-server', serverId: 'other-server' }
      }),
      TOPIC_ID,
      MESSAGE_ID
    ) as unknown as { output: { skeleton?: unknown } }

    expect(projected.output.skeleton).toBeUndefined()
  })

  it('trims derived citation entities from the tail to fit the transport budget', () => {
    const projected = projectMessagePartForRenderer(partWith(manyAgentWebSearch), TOPIC_ID, MESSAGE_ID) as unknown as {
      output: { skeleton?: { content: unknown[] } }
    }

    expect(isDeferredToolOutput(projected.output)).toBe(true)
    expect(projected.output.skeleton?.content.length).toBeGreaterThan(0)
    expect(projected.output.skeleton?.content.length).toBeLessThan(manyAgentWebSearch.content.length)
    expect(new TextEncoder().encode(JSON.stringify(projected.output)).length).toBeLessThanOrEqual(
      DEFER_TOOL_OUTPUT_BYTES
    )
  })

  // The two paths must agree, or a card renders one way while streaming and another after reload.
  it.each([
    ['small', small],
    ['large', large],
    ['large agent lookup', largeAgentWebSearch]
  ])('projects a %s output identically through the stored and live paths', (_label, output) => {
    const fromPart = (
      projectMessagePartForRenderer(partWith(output), TOPIC_ID, MESSAGE_ID) as unknown as { output: unknown }
    ).output
    const fromChunk = (
      projectStreamChunkForRenderer(chunkWith(output), TOPIC_ID, MESSAGE_ID) as unknown as { output: unknown }
    ).output
    expect(fromPart).toEqual(fromChunk)
  })

  // CJK is one UTF-16 code unit but three UTF-8 bytes.
  it('measures the serialized UTF-8 size, not code units', () => {
    const cjk = { content: '\u6d4b'.repeat(DEFER_TOOL_OUTPUT_BYTES / 2) }
    expect(JSON.stringify(cjk).length).toBeLessThan(DEFER_TOOL_OUTPUT_BYTES)

    const projected = projectMessagePartForRenderer(partWith(cjk), TOPIC_ID, MESSAGE_ID) as unknown as {
      output: unknown
    }
    expect(isDeferredToolOutput(projected.output)).toBe(true)
  })

  it('does nothing without a message id to address the result by', () => {
    const chunk = chunkWith(large)
    expect(projectStreamChunkForRenderer(chunk, TOPIC_ID, undefined)).toBe(chunk)
  })

  it('is not topic-specific — an ordinary chat topic defers on the same rule', () => {
    const projected = projectMessagePartForRenderer(partWith(large), 'topic-42', MESSAGE_ID) as unknown as {
      output: unknown
    }
    expect(isDeferredToolOutput(projected.output)).toBe(true)
  })

  it('projects a persisted envelope to a deferred reference carrying the excerpt', () => {
    const persisted = {
      $persistedToolOutput: {
        fileEntryId: 'entry-1',
        vfsFilename: 'vfs_0123456789abcdef.txt',
        head: 'first lines',
        tail: 'last lines',
        totalChars: 200_000,
        totalLines: 5_000,
        shape: 'text'
      }
    }
    const projected = projectMessagePartForRenderer(partWith(persisted), TOPIC_ID, MESSAGE_ID) as unknown as {
      output: unknown
    }
    expect(isDeferredToolOutput(projected.output)).toBe(true)
    expect(projected.output).toEqual({
      $deferredToolResult: { topicId: TOPIC_ID, messageId: MESSAGE_ID, toolCallId: TOOL_CALL_ID },
      excerpt: { head: 'first lines', tail: 'last lines', totalChars: 200_000, totalLines: 5_000 }
    })
  })

  it('normalizes a persisted citation skeleton through the same bounded projection', () => {
    const skeleton = [largeAgentWebSearch.content[0]]
    const persisted = {
      $persistedToolOutput: {
        shape: 'entities',
        skeleton,
        blobRefs: [blob('/0/content', 1)]
      }
    }
    const projected = projectMessagePartForRenderer(partWith(persisted), TOPIC_ID, MESSAGE_ID) as unknown as {
      output: { skeleton?: Array<{ id: string; content: string }> }
    }

    expect(projected.output).toMatchObject({
      $deferredToolResult: { topicId: TOPIC_ID, messageId: MESSAGE_ID, toolCallId: TOOL_CALL_ID },
      excerpt: { head: 'head-1', tail: 'tail-1', totalChars: 1000, totalLines: 10 }
    })
    expect(projected.output.skeleton?.[0]).toMatchObject({ id: '70536f0b-1' })
    expect(projected.output.skeleton?.[0].content.length).toBeLessThan(skeleton[0].content.length)
    expect(new TextEncoder().encode(JSON.stringify(projected.output)).length).toBeLessThanOrEqual(
      DEFER_TOOL_OUTPUT_BYTES
    )
  })

  it('trims persisted citation entities from the tail to fit the transport budget', () => {
    const persisted = {
      $persistedToolOutput: {
        shape: 'entities',
        skeleton: manyAgentWebSearch.content,
        blobRefs: [blob('/0/content', 1)]
      }
    }
    const projected = projectMessagePartForRenderer(partWith(persisted), TOPIC_ID, MESSAGE_ID) as unknown as {
      output: { skeleton?: unknown[] }
    }

    expect(projected.output.skeleton?.length).toBeGreaterThan(0)
    expect(projected.output.skeleton?.length).toBeLessThan(manyAgentWebSearch.content.length)
    expect(new TextEncoder().encode(JSON.stringify(projected.output)).length).toBeLessThanOrEqual(
      DEFER_TOOL_OUTPUT_BYTES
    )
  })
})
