/**
 * Shape the AI SDK execution's `UIMessageChunk` stream for the agent-session
 * host (plan D8, single-segment part; approval segments arrive in a later
 * phase).
 *
 * Unlike the claude/pi adapters this is not an event translation — the inner
 * `Agent.stream` already speaks UIMessageChunk. It only enforces the host's
 * turn framing and renderer routing:
 * - the inner `start` is dropped: the host opens the turn itself and the
 *   pending assistant row's id comes from its accumulator seed, so an inner
 *   `start` carrying a random `messageId` would clobber it;
 * - tool chunks are stamped with the runtime transport tag so the renderer
 *   routes them to the generic AI SDK agent tool card.
 */

import { AGENT_RUNTIME_CAPABILITIES } from '@shared/ai/agentRuntimeCapabilities'
import type { UIMessageChunk } from 'ai'

/** ai-sdk transport tag consumed by the renderer's tool-part routing. */
export const AI_SDK_AGENT_TRANSPORT = AGENT_RUNTIME_CAPABILITIES['ai-sdk'].transport

type TransportStampableChunk = Extract<
  UIMessageChunk,
  { type: 'tool-input-start' | 'tool-input-available' | 'tool-output-available' | 'tool-output-error' }
>

const STAMPABLE_CHUNK_TYPES = new Set<UIMessageChunk['type']>([
  'tool-input-start',
  'tool-input-available',
  'tool-output-available',
  'tool-output-error'
])

/** Map one inner chunk to the chunk forwarded to the host; `null` swallows it. */
export function adaptAgentChunk(chunk: UIMessageChunk): UIMessageChunk | null {
  if (chunk.type === 'start') return null
  if (STAMPABLE_CHUNK_TYPES.has(chunk.type)) return stampTransport(chunk as TransportStampableChunk)
  return chunk
}

function stampTransport(chunk: TransportStampableChunk): UIMessageChunk {
  const cherry = chunk.providerMetadata?.cherry
  return {
    ...chunk,
    providerMetadata: {
      ...chunk.providerMetadata,
      cherry: { ...(typeof cherry === 'object' ? cherry : undefined), transport: AI_SDK_AGENT_TRANSPORT }
    }
  }
}
