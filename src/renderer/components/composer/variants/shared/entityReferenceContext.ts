import { getTopicMessages } from '@renderer/hooks/useTopic'
import { getAgentSessionMessagesForExport } from '@renderer/services/agentSessionExport'
import { getNamingTextContent } from '@renderer/utils/message/find'

export interface ReferenceTranscriptEntry {
  role: string
  text: string
}

export type EntityReferenceTarget =
  | { entityType: 'topic'; id: string; name: string }
  | { entityType: 'session'; id: string; name: string; agentId: string | null }

export const REFERENCE_CONTEXT_MAX_TOTAL_CHARS = 8000
export const REFERENCE_CONTEXT_MAX_MESSAGE_CHARS = 2000

/**
 * Pure formatter: chronological transcript entries in → capped, delimited context block out.
 * Keeps only user/assistant entries with non-empty text; caps each message, then keeps the
 * most recent messages that fit the total budget (always at least one), in chronological order.
 * Delimiters and role labels are model-facing, not UI — intentionally not i18n'd.
 */
export function buildEntityReferencePromptText(options: {
  name: string
  entityType: 'topic' | 'session'
  entries: readonly ReferenceTranscriptEntry[]
  maxTotalChars?: number
  maxMessageChars?: number
}): string {
  const maxTotal = options.maxTotalChars ?? REFERENCE_CONTEXT_MAX_TOTAL_CHARS
  const maxPerMessage = options.maxMessageChars ?? REFERENCE_CONTEXT_MAX_MESSAGE_CHARS
  const usable = options.entries.filter(
    (entry) => (entry.role === 'user' || entry.role === 'assistant') && entry.text.trim().length > 0
  )

  const kept: string[] = []
  let used = 0
  for (let index = usable.length - 1; index >= 0; index--) {
    const entry = usable[index]
    const text = entry.text.length > maxPerMessage ? `${entry.text.slice(0, maxPerMessage)}…` : entry.text
    const block = `[${entry.role}]\n${text}`
    if (kept.length > 0 && used + block.length > maxTotal) break
    kept.unshift(block)
    used += block.length + 2
  }

  const openTag = `<referenced-conversation type="${options.entityType}" name="${options.name.replace(/"/g, "'")}">`
  const body = kept.length > 0 ? kept.join('\n\n') : '[empty]'
  const note =
    kept.length < usable.length ? `\n[showing the ${kept.length} most recent of ${usable.length} messages]\n` : '\n'
  return `${openTag}${note}${body}\n</referenced-conversation>`
}

/** Fetches the referenced conversation's messages and formats them into token prompt text. */
export async function fetchEntityReferencePromptText(target: EntityReferenceTarget): Promise<string> {
  const messages =
    target.entityType === 'topic'
      ? await getTopicMessages(target.id)
      : await getAgentSessionMessagesForExport({ id: target.id, agentId: target.agentId, name: target.name })

  return buildEntityReferencePromptText({
    name: target.name,
    entityType: target.entityType,
    entries: messages.map((message) => ({ role: message.role, text: getNamingTextContent(message) }))
  })
}
