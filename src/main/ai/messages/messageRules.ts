/**
 * Message normalization rules.
 *
 * - UIMessage-level rules (`normalizeUIMessages`) run before `convertToModelMessages`.
 * - The ModelMessage-level `coalesceConsecutiveSameRole` runs after it.
 *
 * Rules are pure, named, and return the same array reference when they change
 * nothing.
 */

import type { ModelMessage, UIMessage } from 'ai'

import { ALL_MEDIA, type MediaCapabilities, stripUnsupportedMedia } from './messageCapabilities'

/** Context shared by every UIMessage normalization rule. */
export interface NormalizeContext {
  mediaCapabilities?: MediaCapabilities
}

type MessageRule = <T extends UIMessage>(messages: T[], ctx: Required<NormalizeContext>) => T[]

/** Drop media the model can't accept — see `stripUnsupportedMedia` in `messageCapabilities.ts`. */
function gateUnsupportedMedia<T extends UIMessage = UIMessage>(messages: T[], ctx: Required<NormalizeContext>): T[] {
  return stripUnsupportedMedia(messages, ctx.mediaCapabilities)
}

const RULES: readonly MessageRule[] = [gateUnsupportedMedia]

/** Apply every UIMessage normalization rule in order, before `convertToModelMessages`. */
export function normalizeUIMessages<T extends UIMessage = UIMessage>(messages: T[], ctx: NormalizeContext = {}): T[] {
  const resolved: Required<NormalizeContext> = { mediaCapabilities: ctx.mediaCapabilities ?? ALL_MEDIA }
  return RULES.reduce<T[]>((acc, rule) => rule(acc, resolved), messages)
}

/** A string/array `content` → a flat parts array (`[]` for an empty string). */
function contentToParts(content: unknown): unknown[] {
  if (typeof content === 'string') return content.length > 0 ? [{ type: 'text', text: content }] : []
  return Array.isArray(content) ? content : []
}

/**
 * Merge adjacent same-role messages into one (concatenate content). Apply AFTER
 * `convertToModelMessages`.
 *
 * Any rule that deletes a whole message — capability gating, or future context
 * pruning — can leave two adjacent same-role turns. Merging yields the
 * lowest-common-denominator shape every provider accepts: some require strict
 * alternation (Anthropic), the rest tolerate adjacency or merge it themselves
 * (`@ai-sdk/anthropic` does, so this is idempotent there; `@ai-sdk/google` does
 * not, so this is what makes it safe). It is a normalization, not a validation —
 * it never throws, and never merges across different roles (so assistant↔tool
 * stays intact).
 */
export function coalesceConsecutiveSameRole(messages: ModelMessage[]): ModelMessage[] {
  const out: ModelMessage[] = []
  for (const message of messages) {
    const prev = out.at(-1)
    if (!prev || prev.role !== message.role) {
      out.push(message)
      continue
    }
    if (prev.role === 'system') {
      out[out.length - 1] = { ...prev, content: `${prev.content}\n\n${(message as typeof prev).content}` }
      continue
    }
    out[out.length - 1] = {
      ...prev,
      content: [
        ...contentToParts((prev as { content: unknown }).content),
        ...contentToParts((message as { content: unknown }).content)
      ]
    } as ModelMessage
  }
  return out
}

/**
 * Replace an assistant message that converted to empty content with a placeholder.
 *
 * `convertToModelMessages` emits `{ role: 'assistant', content: [] }` for a turn
 * whose only parts don't convert to model content (e.g. a persisted `data-error`),
 * which Gemini rejects (HTTP 400). Apply after `convertToModelMessages` — observing
 * the actual converted shape is more robust than predicting it from UI part types.
 * See #16195.
 */
export function ensureNonEmptyAssistantContent(messages: ModelMessage[]): ModelMessage[] {
  return messages.map((m) =>
    m.role === 'assistant' && Array.isArray(m.content) && m.content.length === 0
      ? { ...m, content: [{ type: 'text', text: '...' }] }
      : m
  )
}
