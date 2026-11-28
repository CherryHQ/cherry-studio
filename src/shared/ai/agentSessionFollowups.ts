import type { CherryMessagePart } from '@shared/data/types/message'
import { readCherryMeta, withCherryMeta } from '@shared/data/types/uiParts'

export const AGENT_SESSION_FOLLOWUPS_CACHE_KEY = (topicId: string) => `agent.session.followups.${topicId}` as const

export interface AgentSessionFollowup {
  id: string
  revision: number
  parts: CherryMessagePart[]
}

export type AgentSessionFollowupChange =
  | { type: 'edit'; inputId: string; revision: number; text: string }
  | { type: 'reorder'; before: string[]; after: string[] }
  | { type: 'withdraw'; inputId: string }
  | { type: 'steer'; inputId: string }

type TextPart = Extract<CherryMessagePart, { type: 'text' }>

function splitFollowupText(part: TextPart) {
  const composer = readCherryMeta(part)?.composer
  const tokens = [...(composer?.tokens ?? [])].sort((a, b) => a.textOffset - b.textOffset || a.index - b.index)
  let text = ''
  let cursor = 0
  const anchors = tokens.map((token) => {
    const offset = Math.min(part.text.length, Math.max(cursor, token.textOffset))
    text += part.text.slice(cursor, offset)
    const prompt = token.promptText
    const embedded = prompt && part.text.startsWith(prompt, offset) ? prompt : ''
    cursor = offset + embedded.length
    return { token, embedded }
  })
  return { text: text + part.text.slice(cursor), composer, anchors }
}

export function readFollowupText(parts: readonly CherryMessagePart[]): string {
  const text = parts.find((part) => part.type === 'text')
  return text ? splitFollowupText(text).text : ''
}

/** Keep the managed tokens in the queued text part when replacing its user-authored text. */
export function replaceFollowupText(part: TextPart, text: string): TextPart {
  const previous = splitFollowupText(part)
  if (!previous.composer) return { ...part, text }
  if (text === previous.text) return part
  let content = text
  const tokens = previous.anchors.map(({ token, embedded }) => {
    const textOffset = content.length
    if (!embedded) return { ...token, textOffset }
    // Include the separator in the managed span so the editor restores the typed text exactly.
    const promptText = content && !embedded.startsWith('\n') ? `\n${embedded}` : embedded
    content += promptText
    return { ...token, textOffset, promptText }
  })
  return withCherryMeta({ ...part, text: content }, { composer: { ...previous.composer, tokens } })
}
