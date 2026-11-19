import type { UIMessageChunk } from 'ai'
import { describe, expect, it } from 'vitest'

import { MessageProjection } from '@main/ai/messages/MessageProjection'
import { webSearchOutputSchema } from '@shared/ai/builtinTools'
import { applyMessageProjectionUpdate, type TopicProjectionState } from '@shared/ai/messageProjection'
import { type DeferredToolOutput, isDeferredToolOutput } from '@shared/ai/transport'
import type { CherryMessagePart } from '@shared/data/types/message'

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

function partWith(output: unknown): CherryMessagePart {
  return {
    type: 'tool-Read',
    toolCallId: TOOL_CALL_ID,
    state: 'output-available',
    input: {},
    output
  }
}

function chunkWith(output: unknown): UIMessageChunk {
  return { type: 'tool-output-available', toolCallId: TOOL_CALL_ID, output }
}

function deferredOutput(part: CherryMessagePart | UIMessageChunk): DeferredToolOutput {
  if (!('output' in part) || !isDeferredToolOutput(part.output)) throw new Error('Expected a deferred tool output')
  return part.output
}

function citationContent(output: DeferredToolOutput) {
  const skeleton = output.skeleton
  if (!skeleton || typeof skeleton !== 'object' || !('content' in skeleton)) {
    throw new Error('Expected a citation content wrapper')
  }
  return webSearchOutputSchema.parse(skeleton.content)
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
  it('delivers a large replacement on the same call with a fresh cache identity', () => {
    const parts = (value: string) => [projectMessagePartForRenderer(partWith(value), TOPIC_ID, MESSAGE_ID)]
    const first = { id: MESSAGE_ID, role: 'assistant' as const, parts: parts('a'.repeat(64 * 1024)) }
    const state: TopicProjectionState = { kind: 'topic', topicId: TOPIC_ID, executions: [] }
    const projection = new MessageProjection({ ...state, messages: [first] })
    let view = projection.snapshot()
    projection.subscribe((update) => {
      view = applyMessageProjectionUpdate(view, update)!
    })
    const replacement = { ...first, parts: parts('b'.repeat(64 * 1024)) }
    projection.update({ ...state, messages: [replacement] }, true)
    expect(view.messages[0]).toEqual(replacement)
    expect(view.messages[0]).not.toEqual(first)
    projection.update({ ...state, messages: [{ ...first, parts: [] }] }, true)
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
    const projected = deferredOutput(projectMessagePartForRenderer(partWith(large), TOPIC_ID, MESSAGE_ID))
    expect(projected).toEqual({
      $deferredToolResult: {
        topicId: TOPIC_ID,
        messageId: MESSAGE_ID,
        toolCallId: TOOL_CALL_ID,
        revision: expect.any(String)
      }
    })
  })

  it.each(['stored', 'live'])('serializes an oversized %s output once for its reference revision', (source) => {
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
          toolCallId: TOOL_CALL_ID,
          revision: 'f99105333335ffd61379190d826704fc729bff3bff5108aace70af36fe80d670'
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
    const projected = deferredOutput(projectMessagePartForRenderer(partWith(largeAgentWebSearch), TOPIC_ID, MESSAGE_ID))
    const content = citationContent(projected)

    expect(content[0]).toMatchObject({ id: '70536f0b-1' })
    expect(content[0].content.length).toBeLessThan(largeAgentWebSearch.content[0].content.length)
    expect(projected.skeleton).toMatchObject({ metadata: { name: 'web_search', serverId: 'cherry-tools' } })
  })

  it('keeps a citation skeleton for legacy agent lookup metadata without a tool name', () => {
    const projected = deferredOutput(
      projectMessagePartForRenderer(
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
      )
    )

    expect(projected.skeleton).toHaveProperty('metadata', {
      type: 'mcp',
      serverName: 'cherry-tools',
      serverId: 'cherry-tools'
    })
  })

  it('does not expose a citation skeleton for a third-party MCP lookup', () => {
    const projected = deferredOutput(
      projectMessagePartForRenderer(
        partWith({
          ...largeAgentWebSearch,
          metadata: { ...largeAgentWebSearch.metadata, serverName: 'other-server', serverId: 'other-server' }
        }),
        TOPIC_ID,
        MESSAGE_ID
      )
    )

    expect(projected.skeleton).toBeUndefined()
  })

  it('trims derived citation entities from the tail to fit the transport budget', () => {
    const projected = deferredOutput(projectMessagePartForRenderer(partWith(manyAgentWebSearch), TOPIC_ID, MESSAGE_ID))
    const content = citationContent(projected)

    expect(content.length).toBeGreaterThan(0)
    expect(content.length).toBeLessThan(manyAgentWebSearch.content.length)
    expect(new TextEncoder().encode(JSON.stringify(projected)).length).toBeLessThanOrEqual(DEFER_TOOL_OUTPUT_BYTES)
  })

  // The two paths must agree, or a card renders one way while streaming and another after reload.
  it.each([
    ['small', small],
    ['large', large],
    ['large agent lookup', largeAgentWebSearch]
  ])('projects a %s output identically through the stored and live paths', (_label, output) => {
    const fromPart = projectMessagePartForRenderer(partWith(output), TOPIC_ID, MESSAGE_ID)
    const fromChunk = projectStreamChunkForRenderer(chunkWith(output), TOPIC_ID, MESSAGE_ID)
    if (!('output' in fromPart) || !('output' in fromChunk)) throw new Error('Expected tool outputs')
    expect(fromPart.output).toEqual(fromChunk.output)
  })

  // CJK is one UTF-16 code unit but three UTF-8 bytes.
  it('measures the serialized UTF-8 size, not code units', () => {
    const cjk = { content: '\u6d4b'.repeat(DEFER_TOOL_OUTPUT_BYTES / 2) }
    expect(JSON.stringify(cjk).length).toBeLessThan(DEFER_TOOL_OUTPUT_BYTES)

    const projected = projectMessagePartForRenderer(partWith(cjk), TOPIC_ID, MESSAGE_ID)
    if (!('output' in projected)) throw new Error('Expected a tool output')
    expect(isDeferredToolOutput(projected.output)).toBe(true)
  })

  it('does nothing without a message id to address the result by', () => {
    const chunk = chunkWith(large)
    expect(projectStreamChunkForRenderer(chunk, TOPIC_ID, undefined)).toEqual(chunk)
  })

  it('is not topic-specific — an ordinary chat topic defers on the same rule', () => {
    const projected = deferredOutput(projectMessagePartForRenderer(partWith(large), 'topic-42', MESSAGE_ID))
    expect(projected.$deferredToolResult.topicId).toBe('topic-42')
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
    const projected = deferredOutput(projectMessagePartForRenderer(partWith(persisted), TOPIC_ID, MESSAGE_ID))
    expect(projected).toEqual({
      $deferredToolResult: {
        topicId: TOPIC_ID,
        messageId: MESSAGE_ID,
        toolCallId: TOOL_CALL_ID,
        revision: expect.any(String)
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
    const projected = deferredOutput(projectMessagePartForRenderer(partWith(persisted), TOPIC_ID, MESSAGE_ID))
    const content = webSearchOutputSchema.parse(projected.skeleton)

    expect(projected).toMatchObject({
      $deferredToolResult: {
        topicId: TOPIC_ID,
        messageId: MESSAGE_ID,
        toolCallId: TOOL_CALL_ID,
        revision: expect.any(String)
      },
      excerpt: { head: 'head-1', tail: 'tail-1', totalChars: 1000, totalLines: 10 }
    })
    expect(content[0]).toMatchObject({ id: '70536f0b-1' })
    expect(content[0].content.length).toBeLessThan(skeleton[0].content.length)
    expect(new TextEncoder().encode(JSON.stringify(projected)).length).toBeLessThanOrEqual(DEFER_TOOL_OUTPUT_BYTES)
  })

  it('trims persisted citation entities from the tail to fit the transport budget', () => {
    const persisted = {
      $persistedToolOutput: {
        shape: 'entities',
        skeleton: manyAgentWebSearch.content,
        blobRefs: [blob('/0/content', 1)]
      }
    }
    const projected = deferredOutput(projectMessagePartForRenderer(partWith(persisted), TOPIC_ID, MESSAGE_ID))
    const content = webSearchOutputSchema.parse(projected.skeleton)

    expect(content.length).toBeGreaterThan(0)
    expect(content.length).toBeLessThan(manyAgentWebSearch.content.length)
    expect(new TextEncoder().encode(JSON.stringify(projected)).length).toBeLessThanOrEqual(DEFER_TOOL_OUTPUT_BYTES)
  })
})
