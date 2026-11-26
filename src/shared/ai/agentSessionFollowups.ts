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
    return { token, offset: text.length, embedded }
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
  let cursor = 0
  let content = ''
  const tokens = previous.anchors.map(({ token, offset, embedded }) => {
    const next = offset === previous.text.length ? text.length : Math.min(offset, text.length)
    content += text.slice(cursor, next)
    cursor = next
    const textOffset = content.length
    content += embedded
    return { ...token, textOffset }
  })
  return withCherryMeta({ ...part, text: content + text.slice(cursor) }, { composer: { ...previous.composer, tokens } })
}
