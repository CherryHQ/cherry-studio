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

function reviveDraftBlob(_key: string, value: unknown): unknown {
  if (!isRecord(value) || value.__chatDraftBlob !== true) return value
  if (typeof value.data !== 'string' || typeof value.type !== 'string') throw new Error('Invalid draft image')
  const binary = atob(value.data)
  return new Blob([Uint8Array.from(binary, (char) => char.charCodeAt(0))], { type: value.type })
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
    const raw = localStorage.getItem(key)
    if (!raw) return null

    const parsed: unknown = JSON.parse(raw, reviveDraftBlob)
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
    return { expiresAt: parsed.expiresAt, value }
  } catch {
    try {
      localStorage.removeItem(key)
    } catch {
      // Storage may be unavailable entirely.
    }
    return null
  }
}

const pendingDraftWrites = new Map<string, number>()

function writePersistedChatDraft(topicId: string, draft: ChatComposerDraftCache) {
  const key = getChatDraftCacheKey(topicId)
  const revision = (pendingDraftWrites.get(key) ?? 0) + 1
  pendingDraftWrites.set(key, revision)
  const expiresAt = Date.now() + DRAFT_CACHE_TTL
  const invalidate = () => {
    if (pendingDraftWrites.get(key) !== revision) return
    try {
      localStorage.removeItem(key)
    } catch {
      // Storage may be unavailable entirely; the live draft remains in memory.
    }
  }
  try {
    if (!hasChatDraftContent(draft)) {
      invalidate()
      return
    }
    // Blob bytes need an asynchronous read. A renderer crash before completion still loses
    // that latest edit; the synchronous API cannot guarantee a durable image write on unload.
    const entry: PersistedChatDraftEntry = { expiresAt, value: draft }
    const blobs = new Set<Blob>()
    // Inspect both the attachment and token payload, which can share the same Blob.
    JSON.stringify(entry, (_key, value: unknown) => {
      if (value instanceof Blob) blobs.add(value)
      return value
    })
    if (blobs.size === 0) {
      localStorage.setItem(key, JSON.stringify(entry))
      return
    }
    // Remove the older mirror while image bytes are being read. Never resurrect an older edit
    // if a reload races the asynchronous image serialization or that serialization fails.
    invalidate()
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
        if (pendingDraftWrites.get(key) !== revision) return
        const values = new Map(encoded)
        localStorage.setItem(
          key,
          JSON.stringify(entry, (_key, value: unknown) => (value instanceof Blob ? values.get(value) : value))
        )
      })
      .catch(invalidate)
  } catch {
    invalidate()
  }
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
      if (!key?.startsWith('chat.composer_draft.')) continue
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

  const cached = normalizeDraftCache(cacheService.get(getChatDraftCacheKey(topicId)))
  if (cached) return cached

  // After a window reload the memory tier is empty; rehydrate it from the persisted mirror.
  const persisted = readPersistedChatDraft(topicId)
  if (persisted) {
    cacheService.set(getChatDraftCacheKey(topicId), persisted.value, Math.max(0, persisted.expiresAt - Date.now()))
    return persisted.value
  }

  return EMPTY_DRAFT_CACHE
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

export function writeChatDraftCache(topicId: string, draft: ChatComposerDraftCache) {
  pruneExpiredPersistedChatDrafts()

  const value: ChatComposerDraftCache = {
    text: draft.text,
    tokens: [...draft.tokens],
    files: [...draft.files],
    knowledgeBaseIds: [...draft.knowledgeBaseIds],
    mentionedModelIds: [...draft.mentionedModelIds],
    modelMultiSelectMode: draft.modelMultiSelectMode
  }
  cacheService.set(getChatDraftCacheKey(topicId), value, DRAFT_CACHE_TTL)
  writePersistedChatDraft(topicId, value)
}
