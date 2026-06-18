/**
 * UIMessage-level normalization, applied right before `convertToModelMessages`.
 *
 * Rules are pure, named, and return the same array reference when they change
 * nothing. Keep them capability-agnostic — universal shape invariants only.
 * Provider-specific shaping is the provider adapter's job (e.g. `@ai-sdk/anthropic`
 * already merges consecutive same-role turns), so we deliberately do NOT coalesce
 * adjacent turns or enforce alternation here.
 */

import type { UIMessage } from 'ai'

type MessageRule = <T extends UIMessage>(messages: T[]) => T[]

/**
 * Give an otherwise-empty assistant turn a placeholder text part.
 *
 * `convertToModelMessages` drops an assistant `UIMessage` whose parts produce no
 * content, and emits `{ role: 'assistant', content: [] }` for a turn that carries
 * only non-content parts. Gemini then rejects the empty `model` turn with HTTP 400
 * ("must include at least one parts field"). Such turns appear when a response was
 * interrupted/empty or held only tool/citation blocks, then the user sends "继续"
 * and the whole history is replayed. See #16195.
 *
 * Keeping the turn (vs. dropping it) avoids depending on provider-specific merge
 * behavior; the placeholder is harmless because `originalMessages` (the persisted/
 * rendered turn) is kept un-normalized upstream.
 */
export function ensureNonEmptyAssistantParts<T extends UIMessage = UIMessage>(messages: T[]): T[] {
  return messages.map((message) => {
    if (message.role !== 'assistant') return message
    const parts = message.parts ?? []
    // `step-start` carries no content; any other part is real content to keep.
    if (parts.some((part) => part.type !== 'step-start')) return message
    return { ...message, parts: [...parts, { type: 'text', text: '...' }] } as T
  })
}

const RULES: readonly MessageRule[] = [ensureNonEmptyAssistantParts]

/** Apply every normalization rule in order. */
export function normalizeUIMessages<T extends UIMessage = UIMessage>(messages: T[]): T[] {
  return RULES.reduce<T[]>((acc, rule) => rule(acc), messages)
}
