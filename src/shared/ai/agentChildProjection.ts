import type { CherryUIMessage } from '@shared/data/types/message'

export interface AgentChildView {
  contextId: string
  sessionId: string
  revision: number
  messages: readonly CherryUIMessage[]
  active: boolean
  available: boolean
  diagnostic?: string
}

export type AgentChildPatch =
  | { type: 'message'; message: CherryUIMessage }
  | { type: 'append'; messageId: string; part: number; text: string }

export interface AgentChildUpdate {
  revision: number
  patches: AgentChildPatch[]
  order: string[]
  active: boolean
  available: boolean
  diagnostic?: string
}

/** Transport patches preserve the shared message model and unchanged message identities. */
export function applyAgentChildUpdate(view: AgentChildView, update: AgentChildUpdate): AgentChildView | undefined {
  if (update.revision <= view.revision) return view
  if (update.revision !== view.revision + 1) return undefined
  const messages = new Map(view.messages.map((message) => [message.id, message]))
  for (const patch of update.patches) {
    if (patch.type === 'message') messages.set(patch.message.id, patch.message)
    else {
      const message = messages.get(patch.messageId)
      const part = message?.parts[patch.part]
      if (!message || !part || (part.type !== 'text' && part.type !== 'reasoning')) return undefined
      const parts = message.parts.slice()
      parts[patch.part] = { ...part, text: part.text + patch.text }
      messages.set(message.id, { ...message, parts })
    }
  }
  if (update.order.some((id) => !messages.has(id))) return undefined
  return {
    ...view,
    revision: update.revision,
    messages: update.order.map((id) => messages.get(id)!),
    active: update.active,
    available: update.available,
    diagnostic: update.diagnostic
  }
}
