import { cacheService } from '@data/CacheService'
import type { CacheChatComposerDraft } from '@shared/data/cache/cacheValueTypes'
import { isUniqueModelId } from '@shared/data/types/model'

const DRAFT_CACHE_TTL = 24 * 60 * 60 * 1000

export const getChatDraftCacheKey = (topicId: string) => `chat.composer_draft.${topicId}` as const

export type ChatComposerDraftCache = CacheChatComposerDraft

const EMPTY_DRAFT_CACHE: ChatComposerDraftCache = {
  text: '',
  tokens: [],
  files: [],
  knowledgeBaseIds: [],
  mentionedModelIds: [],
  modelMultiSelectMode: false
}

/**
 * localStorage mirrors each draft under the same key so a window reload (or full restart) can
 * restore it; the memory tier stays the live read/write path within a session. Expiry is checked
 * on read because localStorage has no TTL of its own.
 */
type PersistedChatDraftEntry = {
  expiresAt: number
  revision?: string | null
  value: ChatComposerDraftCache
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeDraftCache(cached: unknown): ChatComposerDraftCache | null {
  if (!isRecord(cached)) return null

  return {
    text: typeof cached.text === 'string' ? cached.text : '',
    tokens: Array.isArray(cached.tokens) ? cached.tokens : [],
    files: Array.isArray(cached.files) ? cached.files : [],
    knowledgeBaseIds: Array.isArray(cached.knowledgeBaseIds)
      ? cached.knowledgeBaseIds.filter((id): id is string => typeof id === 'string')
      : [],
    mentionedModelIds: Array.isArray(cached.mentionedModelIds) ? cached.mentionedModelIds.filter(isUniqueModelId) : [],
    modelMultiSelectMode: cached.modelMultiSelectMode === true
  }
}

function reviveDraftBlob(value: unknown, blobs: Map<number, Blob>): unknown {
  if (isRecord(value) && '__chatDraftBlobRef' in value) {
    const blob = typeof value.__chatDraftBlobRef === 'number' ? blobs.get(value.__chatDraftBlobRef) : undefined
    if (!blob) throw new Error('Invalid draft image reference')
    return blob
  }
  if (!isRecord(value) || value.__chatDraftBlob !== true) return value
  if (typeof value.data !== 'string' || typeof value.type !== 'string') throw new Error('Invalid draft image')
  const binary = atob(value.data)
  const blob = new Blob([Uint8Array.from(binary, (char) => char.charCodeAt(0))], { type: value.type })
  if (typeof value.id === 'number') blobs.set(value.id, blob)
  return blob
}

function isPersistedAttachment(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.fileTokenSourceId === 'string' &&
    typeof value.name === 'string' &&
    typeof value.origin_name === 'string' &&
    typeof value.ext === 'string' &&
    typeof value.size === 'number' &&
    Number.isFinite(value.size) &&
    value.size >= 0 &&
    typeof value.type === 'string' &&
    (value.blob instanceof Blob || typeof value.path === 'string')
  )
}

function isPersistedToken(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.kind === 'string' &&
    typeof value.label === 'string' &&
    typeof value.index === 'number' &&
    Number.isFinite(value.index) &&
    typeof value.textOffset === 'number' &&
    Number.isFinite(value.textOffset)
  )
}

function readPersistedChatDraft(topicId: string): PersistedChatDraftEntry | null {
  const key = getChatDraftCacheKey(topicId)
  try {
    const loadedRevision = readDraftRevision(topicId)
    const raw = localStorage.getItem(key)
    if (!raw) return null

    const blobs = new Map<number, Blob>()
    const parsed: unknown = JSON.parse(raw, (_key, value: unknown) => reviveDraftBlob(value, blobs))
    if (
      !isRecord(parsed) ||
      typeof parsed.expiresAt !== 'number' ||
      !Number.isFinite(parsed.expiresAt) ||
      parsed.expiresAt <= Date.now()
    ) {
      localStorage.removeItem(key)
      return null
    }

    const stored = parsed.value
    const value = normalizeDraftCache(stored)
    if (
      !value ||
      !isRecord(stored) ||
      !Array.isArray(stored.files) ||
      !stored.files.every(isPersistedAttachment) ||
      !Array.isArray(stored.tokens) ||
      !stored.tokens.every(isPersistedToken)
    ) {
      localStorage.removeItem(key)
      return null
    }
    const revision = readDraftRevision(topicId) === loadedRevision ? loadedRevision : null
    return { expiresAt: parsed.expiresAt, value, revision }
  } catch {
    try {
      localStorage.removeItem(key)
    } catch {
      // Storage may be unavailable entirely.
    }
    return null
  }
}

const snapshotRevisions = new WeakMap<object, string | null>()

export interface ChatDraftOwner {
  revision: string | null
}

const revisionKey = (topicId: string) => `${getChatDraftCacheKey(topicId)}.revision`

function readDraftRevision(topicId: string): string | null {
  try {
    return localStorage.getItem(revisionKey(topicId))
  } catch {
    return null
  }
}

export function createChatDraftOwner(topicId: string, snapshot?: ChatComposerDraftCache): ChatDraftOwner {
  return { revision: snapshot ? (snapshotRevisions.get(snapshot) ?? null) : readDraftRevision(topicId) }
}

function withDraftLock(topicId: string, action: () => void): void {
  // Without a shared lock the renderer keeps its memory draft but must not race another window.
  if (!navigator.locks) return
  void navigator.locks.request(getChatDraftCacheKey(topicId), action).catch(() => {})
}

function writePersistedChatDraft(
  topicId: string,
  draft: ChatComposerDraftCache,
  owner?: ChatDraftOwner,
  onlyIfOwned = false,
  expiresAt = Date.now() + DRAFT_CACHE_TTL,
  replayedRevision?: string
) {
  const key = getChatDraftCacheKey(topicId)
  const expected = owner?.revision ?? null
  const revision = crypto.randomUUID()
  if (owner) owner.revision = revision
  const pendingKey = `${key}.pending`
  // A renderer-local journal survives orderly reload while the shared lock is queued.
  if (!onlyIfOwned) {
    try {
      const pending = JSON.stringify(
        { expected: readDraftRevision(topicId), revision, expiresAt, value: draft },
        (_key, value: unknown) => {
          if (value instanceof Blob) throw new Error('Image encoding is still pending')
          return value
        }
      )
      sessionStorage.setItem(pendingKey, pending)
    } catch {
      sessionStorage.removeItem(pendingKey)
    }
  }
  const clearPending = () => {
    try {
      const pending = sessionStorage.getItem(pendingKey)
      if (pending) {
        const entry = JSON.parse(pending)
        if (entry.revision === revision || entry.revision === replayedRevision) sessionStorage.removeItem(pendingKey)
      }
    } catch {
      /* Storage is unavailable. */
    }
  }
  const commit = (action: () => void) =>
    withDraftLock(topicId, () => {
      if (readDraftRevision(topicId) !== revision) return
      try {
        action()
      } catch {
        localStorage.removeItem(key)
      }
    })
  const invalidate = () => commit(() => localStorage.removeItem(key))
  withDraftLock(topicId, () => {
    if (onlyIfOwned && readDraftRevision(topicId) !== expected) return
    const remaining = expiresAt - Date.now()
    if (remaining <= 0) {
      clearPending()
      return
    }
    try {
      const previousRevision = readDraftRevision(topicId)
      localStorage.setItem(revisionKey(topicId), revision)
      try {
        const rawPending = sessionStorage.getItem(pendingKey)
        if (rawPending) {
          const pending = JSON.parse(rawPending)
          // Only advance an uninterrupted local journal chain, never adopt a foreign write.
          if (pending.expected === previousRevision) {
            sessionStorage.setItem(pendingKey, JSON.stringify({ ...pending, expected: revision }))
          }
        }
      } catch {
        /* Storage is unavailable. */
      }
      clearPending()
      snapshotRevisions.set(draft, revision)
      cacheService.set(key, draft, remaining)
      if (!hasChatDraftContent(draft)) {
        localStorage.removeItem(key)
        return
      }
      const entry: PersistedChatDraftEntry = { expiresAt, value: draft, revision }
      const blobs = new Set<Blob>()
      JSON.stringify(entry, (_key, value: unknown) => {
        if (value instanceof Blob) blobs.add(value)
        return value
      })
      if (blobs.size === 0) {
        localStorage.setItem(key, JSON.stringify(entry))
        return
      }
      localStorage.removeItem(key)
      void Promise.all(
        [...blobs].map(async (blob) => {
          const bytes = new Uint8Array(await blob.arrayBuffer())
          let binary = ''
          for (let start = 0; start < bytes.length; start += 8192) {
            binary += String.fromCharCode(...bytes.subarray(start, start + 8192))
          }
          return [blob, { __chatDraftBlob: true, type: blob.type, data: btoa(binary) }] as const
        })
      )
        .then((encoded) => {
          const values = new Map(encoded)
          const written = new Map<Blob, number>()
          commit(() =>
            localStorage.setItem(
              key,
              JSON.stringify(entry, (_key, value: unknown) => {
                if (!(value instanceof Blob)) return value
                const existing = written.get(value)
                if (existing !== undefined) return { __chatDraftBlobRef: existing }
                const id = written.size
                written.set(value, id)
                return { ...values.get(value), id }
              })
            )
          )
        })
        .catch(invalidate)
    } catch {
      try {
        localStorage.removeItem(key)
      } catch {
        /* Storage is unavailable. */
      }
    }
  })
}

// Remove persisted drafts whose TTL already elapsed (e.g. for topics that no longer exist).
// Runs once per session, on the first draft read or write.
let expiredDraftsPruned = false
function pruneExpiredPersistedChatDrafts() {
  if (expiredDraftsPruned) return
  expiredDraftsPruned = true
  try {
    const now = Date.now()
    for (let index = localStorage.length - 1; index >= 0; index--) {
      const key = localStorage.key(index)
      if (!key?.startsWith('chat.composer_draft.') || key.endsWith('.revision')) continue
      const raw = localStorage.getItem(key)
      if (!raw) continue
      try {
        const parsed: unknown = JSON.parse(raw)
        if (
          !isRecord(parsed) ||
          typeof parsed.expiresAt !== 'number' ||
          !Number.isFinite(parsed.expiresAt) ||
          parsed.expiresAt <= now
        ) {
          localStorage.removeItem(key)
        }
      } catch {
        localStorage.removeItem(key)
      }
    }
  } catch {
    // Best effort only; unreadable entries expire on their own read path.
  }
}

export function readChatDraftCache(topicId: string): ChatComposerDraftCache {
  pruneExpiredPersistedChatDrafts()

  try {
    const pendingKey = `${getChatDraftCacheKey(topicId)}.pending`
    const raw = sessionStorage.getItem(pendingKey)
    if (raw) {
      const pending: unknown = JSON.parse(raw)
      if (
        isRecord(pending) &&
        typeof pending.expiresAt === 'number' &&
        pending.expiresAt > Date.now() &&
        pending.expected === readDraftRevision(topicId)
      ) {
        const value = normalizeDraftCache(pending.value)
        if (value) {
          snapshotRevisions.set(value, pending.expected as string | null)
          cacheService.set(getChatDraftCacheKey(topicId), value, pending.expiresAt - Date.now())
          writePersistedChatDraft(
            topicId,
            value,
            createChatDraftOwner(topicId, value),
            true,
            pending.expiresAt,
            typeof pending.revision === 'string' ? pending.revision : undefined
          )
          return value
        }
      }
      sessionStorage.removeItem(pendingKey)
    }
  } catch {
    /* Storage is unavailable. */
  }
  const rawCached = cacheService.get(getChatDraftCacheKey(topicId))
  const cached = normalizeDraftCache(rawCached)
  if (cached) {
    snapshotRevisions.set(cached, isRecord(rawCached) ? (snapshotRevisions.get(rawCached) ?? null) : null)
    return cached
  }

  // After a window reload the memory tier is empty; rehydrate it from the persisted mirror.
  const emptyRevision = readDraftRevision(topicId)
  const persisted = readPersistedChatDraft(topicId)
  if (persisted) {
    const remaining = persisted.expiresAt - Date.now()
    if (remaining <= 0) {
      try {
        localStorage.removeItem(getChatDraftCacheKey(topicId))
      } catch {
        // An expired mirror is still rejected when storage is unavailable.
      }
      return EMPTY_DRAFT_CACHE
    }
    snapshotRevisions.set(persisted.value, persisted.revision ?? null)
    cacheService.set(getChatDraftCacheKey(topicId), persisted.value, remaining)
    return persisted.value
  }

  const empty = { ...EMPTY_DRAFT_CACHE }
  snapshotRevisions.set(empty, emptyRevision)
  return empty
}

export function hasChatDraftContent(draft: ChatComposerDraftCache): boolean {
  return (
    draft.text.length > 0 ||
    draft.tokens.length > 0 ||
    draft.files.length > 0 ||
    draft.knowledgeBaseIds.length > 0 ||
    draft.mentionedModelIds.length > 0
  )
}

export function readChatDraftPresence(topicId: string): boolean {
  return hasChatDraftContent(readChatDraftCache(topicId))
}

export function subscribeChatDraftCache(topicId: string, listener: () => void): () => void {
  return cacheService.subscribe(getChatDraftCacheKey(topicId), listener)
}

export function writeChatDraftCache(
  topicId: string,
  draft: ChatComposerDraftCache,
  options?: { owner: ChatDraftOwner; onlyIfOwned?: boolean }
) {
  pruneExpiredPersistedChatDrafts()

  const value: ChatComposerDraftCache = {
    text: draft.text,
    tokens: [...draft.tokens],
    files: [...draft.files],
    knowledgeBaseIds: [...draft.knowledgeBaseIds],
    mentionedModelIds: [...draft.mentionedModelIds],
    modelMultiSelectMode: draft.modelMultiSelectMode
  }
  if (!options?.onlyIfOwned) cacheService.set(getChatDraftCacheKey(topicId), value, DRAFT_CACHE_TTL)
  writePersistedChatDraft(topicId, value, options?.owner, options?.onlyIfOwned)
}
