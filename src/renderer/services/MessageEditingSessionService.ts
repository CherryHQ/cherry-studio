import type { ComposerTokenKind } from '@renderer/utils/composerTokenPolicy'
import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import type { CherryMessagePart } from '@shared/data/types/message'
import type { Model } from '@shared/data/types/model'

export interface EditingMessageTarget {
  id: string
  role: string
  topicId: string
}

export interface EditingMessageSerializedToken {
  id: string
  kind: ComposerTokenKind
  label: string
  icon?: string
  description?: string
  sourceMessageId?: string
  promptText?: string
  payload?: unknown
  index: number
  textOffset: number
}

export interface EditingMessageSnapshot<TMessage extends EditingMessageTarget = EditingMessageTarget> {
  message: TMessage
  parts: CherryMessagePart[]
  lockedMentionedModels?: Model[]
  editingSessionId: number
}

export interface SavedComposerDraft {
  text: string
  draftTokens: EditingMessageSerializedToken[]
  files: ComposerAttachment[]
  mentionedModels: Model[]
  mentionedModelSelectorValue: Model[]
  mentionedModelMultiSelectMode: boolean
  mentionedModelSelectionWasPending: boolean
  selectedKnowledgeBases: KnowledgeBase[]
  knowledgeBaseIds: string[]
}

export interface StoredMessageEditDraft {
  text: string
  draftTokens: EditingMessageSerializedToken[]
  files: ComposerAttachment[]
  knowledgeBaseIds: string[]
  reasoningDraft: string
  originalFilePartsByTokenId: ReadonlyMap<string, Extract<CherryMessagePart, { type: 'file' }>>
}

export interface StoredMessageEditSession<TMessage extends EditingMessageTarget = EditingMessageTarget> {
  snapshot: EditingMessageSnapshot<TMessage>
  isSaving: boolean
  draft?: StoredMessageEditDraft
  savedDraftBeforeEditing?: SavedComposerDraft | null
}

const MAX_STORED_EDIT_SESSIONS = 50

/**
 * Direct-import singleton service holding per-topic message edit sessions in renderer memory
 * across topic switches and composer remounts.
 */
export class MessageEditingSessionService {
  private readonly sessions = new Map<string, StoredMessageEditSession>()
  private readonly listeners = new Set<() => void>()
  private nextEditingSessionId = 0

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener()
    }
  }

  private setSession(topicId: string, session: StoredMessageEditSession): void {
    this.sessions.delete(topicId)
    this.sessions.set(topicId, session)
    if (this.sessions.size > MAX_STORED_EDIT_SESSIONS) {
      const oldestKey = this.sessions.keys().next().value
      if (oldestKey !== undefined) this.sessions.delete(oldestKey)
    }
  }

  startSession<TMessage extends EditingMessageTarget>(
    message: TMessage,
    parts: CherryMessagePart[],
    options?: { lockedMentionedModels?: Model[] }
  ): EditingMessageSnapshot<TMessage> {
    this.nextEditingSessionId += 1
    const snapshot: EditingMessageSnapshot<TMessage> = {
      message,
      parts,
      lockedMentionedModels: options?.lockedMentionedModels,
      editingSessionId: this.nextEditingSessionId
    }
    if (message.topicId) {
      this.setSession(message.topicId, { snapshot, isSaving: false })
      this.notify()
    }
    return snapshot
  }

  getSession<TMessage extends EditingMessageTarget = EditingMessageTarget>(
    topicId: string
  ): StoredMessageEditSession<TMessage> | undefined {
    return this.sessions.get(topicId) as StoredMessageEditSession<TMessage> | undefined
  }

  updateDraft(
    topicId: string,
    editingSessionId: number,
    update: {
      draft: StoredMessageEditDraft
      savedDraftBeforeEditing: SavedComposerDraft | null
    }
  ): void {
    const existing = this.sessions.get(topicId)
    if (!existing || existing.snapshot.editingSessionId !== editingSessionId) return
    this.setSession(topicId, {
      ...existing,
      draft: update.draft,
      savedDraftBeforeEditing: update.savedDraftBeforeEditing
    })
  }

  /** Marks a session as saving; returns false if already in flight or superseded. */
  beginSave(topicId: string, editingSessionId: number): boolean {
    const existing = this.sessions.get(topicId)
    if (!existing || existing.snapshot.editingSessionId !== editingSessionId || existing.isSaving) return false
    this.setSession(topicId, { ...existing, isSaving: true })
    this.notify()
    return true
  }

  finishSave(topicId: string, editingSessionId: number): void {
    const existing = this.sessions.get(topicId)
    if (!existing || existing.snapshot.editingSessionId !== editingSessionId || !existing.isSaving) return
    this.setSession(topicId, { ...existing, isSaving: false })
    this.notify()
  }

  clearSession(topicId: string, expectedSessionId?: number): boolean {
    const existing = this.sessions.get(topicId)
    if (!existing) return false
    if (expectedSessionId !== undefined && existing.snapshot.editingSessionId !== expectedSessionId) return false
    this.sessions.delete(topicId)
    this.notify()
    return true
  }

  invalidateMessages(deletedMessageIds: Iterable<string>, topicId?: string): void {
    const deletedSet = new Set(deletedMessageIds)
    if (deletedSet.size === 0) return
    let changed = false
    if (topicId) {
      const existing = this.sessions.get(topicId)
      if (existing && deletedSet.has(existing.snapshot.message.id)) {
        this.sessions.delete(topicId)
        changed = true
      }
    } else {
      for (const [key, session] of this.sessions) {
        if (deletedSet.has(session.snapshot.message.id)) {
          this.sessions.delete(key)
          changed = true
        }
      }
    }
    if (changed) this.notify()
  }

  clearAll(): void {
    if (this.sessions.size === 0) return
    this.sessions.clear()
    this.notify()
  }
}

export const messageEditingSessionService = new MessageEditingSessionService()
