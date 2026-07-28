import type { CherryMessagePart } from '@shared/data/types/message'
import type { UIMessageChunk } from 'ai'
import { describe, expect, it } from 'vitest'

import { DEFER_TOOL_OUTPUT_BYTES, isDeferredToolOutput } from '../deferredToolResult'
import { projectMessagePartForRenderer, projectStreamChunkForRenderer } from '../outboundProjection'

const TOPIC_ID = 'agent-session:session-1'
const MESSAGE_ID = 'message-1'
const TOOL_CALL_ID = 'call-1'

const small = { content: 'x'.repeat(16) }
const large = { content: 'x'.repeat(DEFER_TOOL_OUTPUT_BYTES + 1) }

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

  // The two paths must agree, or a card renders one way while streaming and another after reload.
  it.each([
    ['small', small],
    ['large', large]
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
})
