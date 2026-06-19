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

/** Drop media the model can't accept — see `stripUnsupportedMedia` in `messageCapabilities.ts`. */
function gateUnsupportedMedia<T extends UIMessage = UIMessage>(messages: T[], ctx: Required<NormalizeContext>): T[] {
  return stripUnsupportedMedia(messages, ctx.mediaCapabilities)
}

// Order matters: gate media before the empty-turn guard.
const RULES: readonly MessageRule[] = [gateUnsupportedMedia, ensureNonEmptyAssistantParts]

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
