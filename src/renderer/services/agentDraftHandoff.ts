import type { ConversationDraft } from '@shared/types/navigation'

/**
 * Drafts handed to this window for agent sessions, held until the session's composer takes them.
 * The composer may not be mounted yet, or sit in a hidden tab that runs no effects until shown.
 */
const pendingDrafts = new Map<string, ConversationDraft[]>()
const listeners = new Map<string, Set<() => void>>()

export function handOffAgentDraft(sessionId: string, draft: ConversationDraft): void {
  pendingDrafts.set(sessionId, [...(pendingDrafts.get(sessionId) ?? []), draft])
  for (const listener of listeners.get(sessionId) ?? []) listener()
}

export function takeAgentDraftHandoffs(sessionId: string): ConversationDraft[] {
  const drafts = pendingDrafts.get(sessionId) ?? []
  pendingDrafts.delete(sessionId)
  return drafts
}

export function subscribeAgentDraftHandoff(sessionId: string, listener: () => void): () => void {
  const sessionListeners = listeners.get(sessionId) ?? new Set()
  sessionListeners.add(listener)
  listeners.set(sessionId, sessionListeners)
  return () => {
    sessionListeners.delete(listener)
    if (sessionListeners.size === 0) listeners.delete(sessionId)
  }
}
