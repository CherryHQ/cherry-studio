/**
 * Cache for AI SDK response messages from tool-use turns.
 *
 * When a model uses tools (e.g., web search), the AI SDK internally manages
 * structured tool-call/tool-result message pairs. Cherry Studio only stores
 * UI blocks (text + tool metadata), losing the exact message format.
 *
 * This cache preserves the original response messages so that subsequent
 * API requests can replay them exactly, enabling Anthropic prompt caching
 * to match the prefix and avoid expensive cache misses.
 *
 * Messages are stored by the assistant message ID (the Cherry Studio message
 * that triggered the tool-use turn) and retrieved by the message converter
 * when building the prompt for the next API call.
 *
 * Memory management: bounded to MAX_ENTRIES via LRU eviction. Each entry
 * corresponds to one tool-use assistant turn, so typical usage stays well
 * under the limit even in long sessions.
 */
import type { ModelMessage } from 'ai'

const MAX_ENTRIES = 100

const cache = new Map<string, ModelMessage[]>()

/**
 * Store response messages from a tool-use turn.
 * Evicts the oldest entry when the cache exceeds MAX_ENTRIES.
 * @param messageId - The Cherry Studio assistant message ID
 * @param messages - The AI SDK response messages (assistant + tool pairs)
 */
export function storeResponseMessages(messageId: string, messages: ModelMessage[]): void {
  // Only store if there are tool-related messages (more than just a text response)
  const hasToolMessages = messages.some(
    (m) =>
      m.role === 'tool' ||
      (m.role === 'assistant' && Array.isArray(m.content) && m.content.some((p) => p.type === 'tool-call'))
  )
  if (!hasToolMessages) return

  // LRU eviction: remove oldest entry when at capacity
  if (cache.size >= MAX_ENTRIES && !cache.has(messageId)) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }

  cache.set(messageId, messages)
}

/**
 * Retrieve stored response messages for a given assistant message.
 * @param messageId - The Cherry Studio assistant message ID
 * @returns The stored SDK messages, or undefined if not cached
 */
export function getResponseMessages(messageId: string): ModelMessage[] | undefined {
  return cache.get(messageId)
}

/**
 * Clear cached messages for a specific message ID.
 */
export function clearResponseMessages(messageId: string): void {
  cache.delete(messageId)
}
