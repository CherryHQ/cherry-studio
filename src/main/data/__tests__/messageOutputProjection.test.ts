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

describe('outbound tool-output projection', () => {
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

  it('omits a derived citation skeleton that would still exceed the transport budget', () => {
    const projected = projectMessagePartForRenderer(
      partWith({
        ...largeAgentWebSearch,
        content: [
          {
            ...largeAgentWebSearch.content[0],
            title: 'x'.repeat(DEFER_TOOL_OUTPUT_BYTES)
          }
        ]
      }),
      TOPIC_ID,
      MESSAGE_ID
    ) as unknown as { output: { skeleton?: unknown } }

    expect(isDeferredToolOutput(projected.output)).toBe(true)
    expect(projected.output.skeleton).toBeUndefined()
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

  it('omits a persisted citation skeleton that still exceeds the transport budget', () => {
    const persisted = {
      $persistedToolOutput: {
        shape: 'entities',
        skeleton: [{ ...largeAgentWebSearch.content[0], title: 'x'.repeat(DEFER_TOOL_OUTPUT_BYTES) }],
        blobRefs: [blob('/0/content', 1)]
      }
    }
    const projected = projectMessagePartForRenderer(partWith(persisted), TOPIC_ID, MESSAGE_ID) as unknown as {
      output: { skeleton?: unknown }
    }

    expect(projected.output.skeleton).toBeUndefined()
    expect(new TextEncoder().encode(JSON.stringify(projected.output)).length).toBeLessThanOrEqual(
      DEFER_TOOL_OUTPUT_BYTES
    )
  })
})
