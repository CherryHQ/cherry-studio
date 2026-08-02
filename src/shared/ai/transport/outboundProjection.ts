/**
 * Trims a message's tool payloads on their way to the renderer. The stored-part and live-chunk
 * paths share one {@link deferToolOutput} call so the policy cannot drift between them.
 */

import type { UIMessageChunk } from 'ai'
import { isToolUIPart } from 'ai'

import type { CherryMessagePart } from '@shared/data/types/message'

import { type DeferredToolOutput, deferToolOutput } from './deferredToolResult'
import { envelopeDisplayExcerpt, isPersistedToolOutput } from './persistedToolOutput'

/** Projects a stored or finalized message part. Returns the same object when nothing changed. */
export function projectMessagePartForRenderer(
  part: CherryMessagePart,
  topicId: string,
  messageId: string
): CherryMessagePart {
  if (!isToolUIPart(part) || part.state !== 'output-available') return part

  // A persisted excerpt rides the same deferred-reference transport — the
  // renderer resolves the full value through `ai.tool.get_result` (which
  // reconstructs it from the FileManager blob) — but carries the excerpt so
  // there is something to show without the fetch.
  if (isPersistedToolOutput(part.output)) {
    const ref = part.output.$persistedToolOutput
    return {
      ...part,
      output: {
        $deferredToolResult: { topicId, messageId, toolCallId: part.toolCallId },
        excerpt: envelopeDisplayExcerpt(ref),
        ...(ref.shape === 'entities' ? { skeleton: ref.skeleton } : {})
      } satisfies DeferredToolOutput
    }
  }

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
  return { ...chunk, output }
}
