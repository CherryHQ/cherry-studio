/**
 * The one place a message's tool payloads are trimmed on their way to the renderer.
 *
 * Two shapes carry a tool result across the boundary — a stored/finalized `CherryMessagePart` and
 * a live `tool-output-available` chunk. They are projected by the two functions here, but both
 * route through the same {@link deferToolOutput} call, so the "defer or not" decision exists once.
 * Previously each path had its own copy and they had already drifted.
 */

import type { CherryMessagePart } from '@shared/data/types/message'
import type { UIMessageChunk } from 'ai'
import { isToolUIPart } from 'ai'

import { deferToolOutput } from './deferredToolResult'

/** Projects a stored or finalized message part. Returns the same object when nothing changed. */
export function projectMessagePartForRenderer(
  part: CherryMessagePart,
  topicId: string,
  messageId: string
): CherryMessagePart {
  // `isToolUIPart` covers both `tool-${name}` and `dynamic-tool`; only `output-available` has output.
  if (!isToolUIPart(part) || part.state !== 'output-available') return part

  const output = deferToolOutput(part.output, { topicId, messageId, toolCallId: part.toolCallId })
  if (output === part.output) return part
  return { ...part, output }
}

/** Projects every part of a message. Returns the same array when nothing changed. */
export function projectMessagePartsForRenderer(
  parts: CherryMessagePart[],
  topicId: string,
  messageId: string
): CherryMessagePart[] {
  let projected: CherryMessagePart[] | undefined
  for (let index = 0; index < parts.length; index += 1) {
    const part = projectMessagePartForRenderer(parts[index], topicId, messageId)
    if (part === parts[index]) continue
    projected ??= [...parts]
    projected[index] = part
  }
  return projected ?? parts
}

/** Projects a live stream chunk. Returns the same object when nothing changed. */
export function projectStreamChunkForRenderer(
  chunk: UIMessageChunk,
  topicId: string,
  messageId: string | undefined
): UIMessageChunk {
  if (chunk.type !== 'tool-output-available' || !messageId) return chunk

  const output = deferToolOutput(chunk.output, { topicId, messageId, toolCallId: chunk.toolCallId })
  if (output === chunk.output) return chunk
  return { ...chunk, output } as UIMessageChunk
}
