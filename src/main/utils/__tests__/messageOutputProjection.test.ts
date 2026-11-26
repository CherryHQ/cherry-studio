import type { UIMessageChunk } from 'ai'
import { describe, expect, it } from 'vitest'

import { MessageProjection } from '@main/ai/messages/MessageProjection'
import { applyMessageProjectionUpdate, type TopicProjectionState } from '@shared/ai/messageProjection'
import { isDeferredToolOutput } from '@shared/ai/transport'
import type { CherryMessagePart } from '@shared/data/types/message'

import {
  DEFER_TOOL_OUTPUT_BYTES,
  projectAgentNonTextPart,
  projectMessagePartForRenderer,
  projectOversizedHistoryToolPart,
  projectStreamChunkForRenderer
} from '../messageOutputProjection'

const TOPIC_ID = 'agent-session:session-1'
const MESSAGE_ID = 'message-1'
const TOOL_CALL_ID = 'call-1'

const small = { content: 'x'.repeat(16) }
const large = { content: 'x'.repeat(DEFER_TOOL_OUTPUT_BYTES + 1) }
it('publishes and invalidates the same archive address for an already-deferred result', () => {
  const { patch, ref } = projectAgentNonTextPart(TOPIC_ID, {
    type: 'part-put',
    archiveMessageId: MESSAGE_ID,
    partId: 'part',
    part: {
      type: 'dynamic-tool',
      state: 'output-available',
      toolName: 'read',
      toolCallId: TOOL_CALL_ID,
      input: {},
      output: {
        $deferredToolResult: { topicId: 'old-topic', toolCallId: 'old-call', messageId: MESSAGE_ID, partId: 'part' }
      }
    }
  })
  expect(ref).toEqual({ topicId: TOPIC_ID, toolCallId: TOOL_CALL_ID, messageId: MESSAGE_ID, partId: 'part' })
  expect(patch.part).toMatchObject({ output: { $deferredToolResult: ref } })
})

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
  return { type: 'tool-output-available', toolCallId: TOOL_CALL_ID, output }
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
  it('retains the App affordance without sending the full input or result for deferred tool output', () => {
    const text = 'result'.repeat(10_000)
    const metadata = {
      type: 'mcp',
      app: { serverId: 'server', serverKey: 'key', toolName: 'tool', resourceUri: 'ui://example/view' },
      appInput: { privateInput: 'do not project this' }
    }
    const outputs = [
      { metadata, content: [{ type: 'text', text }] },
      {
        $persistedToolOutput: {
          fileEntryId: 'entry-1',
          vfsFilename: 'vfs_1234.txt',
          head: text.slice(0, 10),
          tail: text.slice(-10),
          totalChars: text.length,
          totalLines: 1,
          shape: 'mcp-content',
          metadata
        }
      }
    ]
    for (const output of outputs) {
      const projected = projectMessagePartForRenderer(partWith(output), TOPIC_ID, MESSAGE_ID)
      if (!('output' in projected) || !isDeferredToolOutput(projected.output))
        throw new Error('Expected deferred output')
      expect(projected.output.hasMcpApp).toBe(true)
      const bytes = JSON.stringify(projected.output)
      expect(bytes).not.toContain(metadata.appInput.privateInput)
      expect(Buffer.byteLength(bytes)).toBeLessThan(DEFER_TOOL_OUTPUT_BYTES)
    }
  })

  it('keeps latest-value references stable and invalidates details on replacement', () => {
    const parts = (value: string) => [projectMessagePartForRenderer(partWith(value), TOPIC_ID, MESSAGE_ID)]
    const first = { id: MESSAGE_ID, role: 'assistant' as const, parts: parts('a'.repeat(64 * 1024)) }
    const state: TopicProjectionState = { kind: 'topic', topicId: TOPIC_ID, executions: [] }
    const projection = new MessageProjection({ ...state, messages: [first] })
    let view = projection.snapshot()
    projection.subscribe((update) => {
      if (update.type === 'parts') throw new Error('Expected a structural update')
      view = applyMessageProjectionUpdate(view, update)!
    })
    const replacement = { ...first, parts: parts('b'.repeat(64 * 1024)) }
    const revision = view.revision
    projection.updateAccepted({ ...state, messages: [replacement] }, true, [
      { topicId: TOPIC_ID, messageId: MESSAGE_ID, toolCallId: TOOL_CALL_ID }
    ])
    expect(view.revision).toBe(revision + 1)
    expect(view.messages[0]).toEqual(first)
    expect(view.messages[0]).toEqual(replacement)
    expect(parts('b'.repeat(64 * 1024))).toEqual(replacement.parts)
    projection.updateAccepted({ ...state, messages: [{ ...first, parts: [] }] }, true)
    expect(view.messages[0].parts).toEqual([])
    projection.dispose()
  })

  it('leaves an output that fits under the threshold untouched', () => {
    const part = partWith(small)
    expect(projectMessagePartForRenderer(part, TOPIC_ID, MESSAGE_ID)).toEqual(part)

    const chunk = chunkWith(small)
    expect(projectStreamChunkForRenderer(chunk, TOPIC_ID, MESSAGE_ID)).toEqual(chunk)
  })

  it('replaces an oversized output with a resolvable reference', () => {
    const projected = projectMessagePartForRenderer(partWith(large), TOPIC_ID, MESSAGE_ID) as unknown as {
      output: unknown
    }
    expect(isDeferredToolOutput(projected.output)).toBe(true)
    expect(projected.output).toEqual({
      $deferredToolResult: {
        topicId: TOPIC_ID,
        messageId: MESSAGE_ID,
        toolCallId: TOOL_CALL_ID
      }
    })
  })

  it.each(['stored', 'live'])('serializes an oversized %s output once for its deferred reference', (source) => {
    let serialized = false
    const output = {
      toJSON() {
        if (serialized) throw new Error('Tool output was serialized twice')
        serialized = true
        return large
      }
    }
    const projected =
      source === 'stored'
        ? projectMessagePartForRenderer(partWith(output), TOPIC_ID, MESSAGE_ID)
        : projectStreamChunkForRenderer(chunkWith(output), TOPIC_ID, MESSAGE_ID)

    expect(projected).toMatchObject({
      output: {
        $deferredToolResult: {
          topicId: TOPIC_ID,
          messageId: MESSAGE_ID,
          toolCallId: TOOL_CALL_ID
        }
      }
    })
  })

  it.each([
    [DEFER_TOOL_OUTPUT_BYTES - 2, false],
    [DEFER_TOOL_OUTPUT_BYTES - 1, true]
  ])('defers a %i-character string only when its JSON exceeds the byte budget', (length, deferred) => {
    const output = 'x'.repeat(length)
    const projected = projectMessagePartForRenderer(partWith(output), TOPIC_ID, MESSAGE_ID)
    if (!('output' in projected)) throw new Error('Expected a tool output')
    expect(isDeferredToolOutput(projected.output)).toBe(deferred)
    if (!deferred) expect(projected.output).toBe(output)
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

  // An escaped newline costs two bytes, so characters that fit can still serialize past the budget.
  it('measures JSON escapes, not only characters', () => {
    const escaped = { content: '\n'.repeat(DEFER_TOOL_OUTPUT_BYTES / 2 + 1) }
    expect(escaped.content.length).toBeLessThan(DEFER_TOOL_OUTPUT_BYTES)

    const projected = projectMessagePartForRenderer(partWith(escaped), TOPIC_ID, MESSAGE_ID) as unknown as {
      output: unknown
    }
    expect(isDeferredToolOutput(projected.output)).toBe(true)
  })

  it('measures a value by its JSON form, not by fields its toJSON leaves out', () => {
    const summarized = { content: 'x'.repeat(DEFER_TOOL_OUTPUT_BYTES + 1), toJSON: () => ({ content: 'summary' }) }

    const projected = projectMessagePartForRenderer(partWith(summarized), TOPIC_ID, MESSAGE_ID) as unknown as {
      output: unknown
    }
    expect(projected.output).toBe(summarized)
  })

  // Catches a nesting too deep to walk failing the projection instead of leaving the output in place.
  it('leaves an output nested too deeply to measure untouched', () => {
    let deep: unknown = 'x'
    for (let depth = 0; depth < 100_000; depth++) deep = [deep]

    const projected = projectMessagePartForRenderer(partWith(deep), TOPIC_ID, MESSAGE_ID) as unknown as {
      output: unknown
    }
    expect(projected.output).toBe(deep)
  })

  it('does nothing without a message id to address the result by', () => {
    const chunk = chunkWith(large)
    expect(projectStreamChunkForRenderer(chunk, TOPIC_ID, undefined)).toEqual(chunk)
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
      $deferredToolResult: {
        topicId: TOPIC_ID,
        messageId: MESSAGE_ID,
        toolCallId: TOOL_CALL_ID
      },
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
      $deferredToolResult: {
        topicId: TOPIC_ID,
        messageId: MESSAGE_ID,
        toolCallId: TOOL_CALL_ID
      },
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

  describe('projectOversizedHistoryToolPart', () => {
    const ref = { topicId: TOPIC_ID, messageId: MESSAGE_ID, partId: 'part-1', toolCallId: TOOL_CALL_ID }
    const makeFallback =
      (part: CherryMessagePart) =>
      (citation?: { toolName: string; skeleton: unknown }): CherryMessagePart => ({
        type: 'data-deferred-history-part',
        data: {
          sessionId: 'session-1',
          messageId: MESSAGE_ID,
          partId: 'part-1',
          partType: part.type,
          excerpt: 'excerpt',
          updatedAt: 1,
          ...(citation && { citation: citation as never })
        }
      })

    it('keeps a threshold-mismatch citable tool part as a bounded projected tool part', () => {
      const part: CherryMessagePart = {
        type: 'dynamic-tool',
        toolName: 'mcp__cherry-tools__web_search',
        toolCallId: TOOL_CALL_ID,
        state: 'output-available',
        input: { query: 'mismatch' },
        output: {
          content: [{ id: '3f2a1b9c-1', title: 'Example', url: 'https://example.com', content: '' }],
          metadata: largeAgentWebSearch.metadata
        }
      }
      const emptyBytes = Buffer.byteLength(JSON.stringify((part as { output: unknown }).output))
      ;(part as { output: { content: Array<{ content: string }> } }).output.content[0].content = 'a'.repeat(
        32_674 - emptyBytes
      )
      expect(Buffer.byteLength(JSON.stringify((part as { output: unknown }).output))).toBe(32_674)
      expect(Buffer.byteLength(JSON.stringify(part))).toBeGreaterThan(DEFER_TOOL_OUTPUT_BYTES)

      const projected = projectOversizedHistoryToolPart(part, ref, DEFER_TOOL_OUTPUT_BYTES, makeFallback(part))
      expect(projected.type).toBe('dynamic-tool')
      expect(Buffer.byteLength(JSON.stringify(projected))).toBeLessThanOrEqual(DEFER_TOOL_OUTPUT_BYTES)
      expect(projected).toMatchObject({
        toolCallId: TOOL_CALL_ID,
        output: {
          $deferredToolResult: ref,
          skeleton: {
            content: [{ id: '3f2a1b9c-1', title: 'Example', url: 'https://example.com' }],
            metadata: { type: 'mcp', name: 'web_search', serverId: 'cherry-tools' }
          }
        }
      })
    })

    it('trims an already-deferred large skeleton so the whole part stays under the byte budget', () => {
      const preDeferred = projectMessagePartForRenderer(
        {
          type: 'dynamic-tool',
          toolName: 'mcp__cherry-tools__web_search',
          toolCallId: TOOL_CALL_ID,
          state: 'output-available',
          input: { query: 'many' },
          output: manyAgentWebSearch
        },
        TOPIC_ID,
        MESSAGE_ID,
        undefined,
        'part-1'
      )
      expect(Buffer.byteLength(JSON.stringify(preDeferred))).toBeGreaterThan(DEFER_TOOL_OUTPUT_BYTES)

      const projected = projectOversizedHistoryToolPart(
        preDeferred,
        ref,
        DEFER_TOOL_OUTPUT_BYTES,
        makeFallback(preDeferred)
      )
      expect(projected.type).toBe('dynamic-tool')
      expect(Buffer.byteLength(JSON.stringify(projected))).toBeLessThanOrEqual(DEFER_TOOL_OUTPUT_BYTES)
      const output = (projected as { output: { skeleton?: { content: unknown[] } } }).output
      expect(isDeferredToolOutput(output)).toBe(true)
      expect(output.skeleton?.content.length).toBeGreaterThan(0)
      expect(output.skeleton?.content.length).toBeLessThan(manyAgentWebSearch.content.length)
    })

    it('projects an oversized persisted entities envelope into a bounded deferred tool part', () => {
      const part: CherryMessagePart = {
        type: 'tool-web_search' as never,
        toolCallId: TOOL_CALL_ID,
        state: 'output-available',
        input: { query: 'persisted' },
        output: {
          $persistedToolOutput: {
            shape: 'entities',
            skeleton: manyAgentWebSearch.content,
            blobRefs: [blob('/0/content', 1)]
          }
        }
      } as unknown as CherryMessagePart

      const projected = projectOversizedHistoryToolPart(part, ref, DEFER_TOOL_OUTPUT_BYTES, makeFallback(part))
      expect(projected.type).toBe('tool-web_search')
      expect(Buffer.byteLength(JSON.stringify(projected))).toBeLessThanOrEqual(DEFER_TOOL_OUTPUT_BYTES)
      expect(projected).toMatchObject({
        output: {
          $deferredToolResult: ref,
          excerpt: { head: 'head-1', tail: 'tail-1', totalChars: 1000, totalLines: 10 },
          skeleton: expect.arrayContaining([expect.objectContaining({ id: 'many-1' })])
        }
      })
    })

    it('falls back to a deferred wrapper with bounded citation metadata when input alone exceeds the limit', () => {
      const part: CherryMessagePart = {
        type: 'dynamic-tool',
        toolName: 'tool_call',
        toolCallId: TOOL_CALL_ID,
        state: 'output-available',
        input: { name: 'mcp__cherry-tools__web_search', params: { query: 'x'.repeat(64 * 1024) } },
        output: manyAgentWebSearch
      }

      const projected = projectOversizedHistoryToolPart(part, ref, DEFER_TOOL_OUTPUT_BYTES, makeFallback(part))
      expect(Buffer.byteLength(JSON.stringify(projected))).toBeLessThanOrEqual(DEFER_TOOL_OUTPUT_BYTES)
      expect(projected).toMatchObject({
        type: 'data-deferred-history-part',
        data: {
          partId: 'part-1',
          citation: {
            toolName: 'web_search',
            skeleton: {
              content: expect.arrayContaining([expect.objectContaining({ id: 'many-1' })])
            }
          }
        }
      })
    })

    it('falls back to a plain deferred wrapper without citation metadata for non-citable or third-party tools', () => {
      const thirdPartyBare: CherryMessagePart = {
        type: 'dynamic-tool',
        toolName: 'web_search',
        toolCallId: TOOL_CALL_ID,
        state: 'output-available',
        input: { query: 'q' },
        output: {
          ...largeAgentWebSearch,
          metadata: { type: 'mcp', name: 'web_search', serverName: 'other-server', serverId: 'other-server' }
        }
      }
      const errorPayload: CherryMessagePart = {
        type: 'dynamic-tool',
        toolName: 'mcp__cherry-tools__web_search',
        toolCallId: TOOL_CALL_ID,
        state: 'output-available',
        input: { query: 'q' },
        output: { content: 'x'.repeat(DEFER_TOOL_OUTPUT_BYTES + 1), metadata: largeAgentWebSearch.metadata }
      }
      const legacyKbReadNoId: CherryMessagePart = {
        type: 'dynamic-tool',
        toolName: 'mcp__cherry-tools__kb_read',
        toolCallId: TOOL_CALL_ID,
        state: 'output-available',
        input: { baseId: 'b', conceptId: 'doc.md' },
        output: {
          content: {
            conceptId: 'doc.md',
            title: 'Doc',
            type: 'file',
            totalChars: 40_000,
            charStart: 0,
            charEnd: 40_000,
            content: 'x'.repeat(DEFER_TOOL_OUTPUT_BYTES + 1),
            truncated: true
          },
          metadata: { type: 'mcp', name: 'kb_read', serverName: 'cherry-tools', serverId: 'cherry-tools' }
        }
      }

      for (const candidate of [thirdPartyBare, errorPayload, legacyKbReadNoId]) {
        const projected = projectOversizedHistoryToolPart(
          candidate,
          ref,
          DEFER_TOOL_OUTPUT_BYTES,
          makeFallback(candidate)
        )
        expect(projected.type).toBe('data-deferred-history-part')
        if (projected.type === 'data-deferred-history-part') {
          expect(projected.data.citation).toBeUndefined()
        }
      }
    })
  })
})
