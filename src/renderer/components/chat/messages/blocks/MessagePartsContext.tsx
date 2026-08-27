/**
 * Message parts contexts — extracted to avoid circular imports.
 *
 * PartsContext is the primary data source for message rendering.
 * Components read parts directly via useMessageParts / usePartsMap.
 */

import type { TranslateLangCode } from '@shared/data/preference/preferenceTypes'
import type { CherryMessagePart } from '@shared/data/types/message'
import type { ReactNode } from 'react'
import { createContext, use, useCallback, useMemo, useSyncExternalStore } from 'react'

// ============================================================================
// Refresh Context — allows deep components to trigger data refresh
// ============================================================================

export const RefreshContext = createContext<(() => void) | null>(null)
export const RefreshProvider = RefreshContext.Provider

/** Get the refresh callback from context. Returns no-op if not provided. */
export function useRefresh(): () => void {
  const refresh = use(RefreshContext)
  return refresh ?? (() => {})
}

// ============================================================================
// Parts Context — primary message rendering data source
// ============================================================================

/**
 * Parts context — provides raw CherryMessagePart[] keyed by message ID.
 * Null when no parts provider is present.
 */
export const PartsContext = createContext<Record<string, CherryMessagePart[]> | null>(null)

type PartsMap = Record<string, CherryMessagePart[]> | null
const EMPTY_MESSAGE_PARTS: CherryMessagePart[] = []
interface MessagePartsScopeValue {
  messageId: string
  parts: CherryMessagePart[]
}

const MessagePartsScopeContext = createContext<MessagePartsScopeValue | null>(null)
const MessageIdContext = createContext<string | undefined>(undefined)

/**
 * Provide the complete parts map. A nested message scope takes precedence for
 * useMessageParts; resetting it here prevents an outer message scope leaking
 * into an intentionally isolated nested provider.
 */
export function PartsProvider({ value, children }: { value: PartsMap; children: ReactNode }) {
  return (
    <PartsContext value={value}>
      <MessagePartsScopeContext value={null}>{children}</MessagePartsScopeContext>
    </PartsContext>
  )
}

/** Provide one message's parts without subscribing its subtree to the complete map. */
export function MessagePartsScopeProvider({
  messageId,
  parts,
  children
}: {
  messageId: string
  parts: CherryMessagePart[]
  children: ReactNode
}) {
  const value = useMemo(() => ({ messageId, parts }), [messageId, parts])
  return (
    <MessageIdContext value={messageId}>
      <MessagePartsScopeContext value={value}>{children}</MessagePartsScopeContext>
    </MessageIdContext>
  )
}

/** Read the parts map from context (null when no provider is present). */
export function usePartsMap() {
  return use(PartsContext)
}

/** Check if parts data is provided. */
export function useHasMessageParts(): boolean {
  return use(PartsContext) !== null
}

/** Read the current message ID without subscribing to the complete parts map. */
export function useMessagePartsScopeId(): string | undefined {
  return use(MessageIdContext)
}

// ============================================================================
// Helpers
// ============================================================================

/** Parse a block/part ID into messageId and part index. */
export function parseBlockId(blockId: string): { messageId: string; index: number } | null {
  const lastBlockDash = blockId.lastIndexOf('-block-')
  if (lastBlockDash === -1) return null
  const messageId = blockId.slice(0, lastBlockDash)
  const index = parseInt(blockId.slice(lastBlockDash + 7), 10)
  if (isNaN(index)) return null
  return { messageId, index }
}

export interface TranslationOverlayEntry {
  content: string
  targetLanguage: TranslateLangCode
  sourceLanguage?: TranslateLangCode
}

/**
 * Keyed external store so updating one messageId only notifies subscribers
 * of that id — unrelated `useTranslationOverlayEntry` consumers keep stable
 * references and do not re-render (violations: `rerender-derived-state`,
 * `state-context-interface`, `state-decouple-implementation`).
 */
export interface TranslationOverlayStore {
  getSnapshot(messageId: string): TranslationOverlayEntry | undefined
  getMapSnapshot(): Record<string, TranslationOverlayEntry>
  subscribe(messageId: string, listener: () => void): () => void
  subscribeMap(listener: () => void): () => void
  set(messageId: string, entry: TranslationOverlayEntry | null): void
  reset(): void
}

function translationOverlayEntryEqual(
  a: TranslationOverlayEntry | undefined,
  b: TranslationOverlayEntry | undefined
): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return a.content === b.content && a.targetLanguage === b.targetLanguage && a.sourceLanguage === b.sourceLanguage
}

export function createTranslationOverlayStore(): TranslationOverlayStore {
  const entries = new Map<string, TranslationOverlayEntry>()
  const perKeyListeners = new Map<string, Set<() => void>>()
  const mapListeners = new Set<() => void>()
  let mapVersion = 0
  let mapSnapshot: Record<string, TranslationOverlayEntry> = {}
  let mapDirty = false

  function notifyKey(messageId: string): void {
    const listeners = perKeyListeners.get(messageId)
    if (!listeners) return
    for (const listener of Array.from(listeners)) listener()
  }

  function notifyMap(): void {
    mapVersion += 1
    mapDirty = true
    for (const listener of Array.from(mapListeners)) listener()
  }

  function rebuildMapSnapshot(): Record<string, TranslationOverlayEntry> {
    if (!mapDirty) return mapSnapshot
    const next: Record<string, TranslationOverlayEntry> = {}
    for (const [key, value] of entries) next[key] = value
    mapSnapshot = next
    mapDirty = false
    return mapSnapshot
  }

  return {
    getSnapshot(messageId: string) {
      return entries.get(messageId)
    },
    getMapSnapshot() {
      // Rebuild lazily so map readers pay only when they subscribe via context.
      // Per-key readers never touch this path.
      return rebuildMapSnapshot()
    },
    subscribe(messageId: string, listener: () => void) {
      let listeners = perKeyListeners.get(messageId)
      if (!listeners) {
        listeners = new Set()
        perKeyListeners.set(messageId, listeners)
      }
      listeners.add(listener)
      return () => {
        const current = perKeyListeners.get(messageId)
        if (!current) return
        current.delete(listener)
        if (current.size === 0) perKeyListeners.delete(messageId)
      }
    },
    subscribeMap(listener: () => void) {
      mapListeners.add(listener)
      return () => {
        mapListeners.delete(listener)
      }
    },
    set(messageId: string, entry: TranslationOverlayEntry | null) {
      if (entry == null) {
        if (!entries.has(messageId)) return
        entries.delete(messageId)
        notifyKey(messageId)
        notifyMap()
        return
      }
      const existing = entries.get(messageId)
      if (translationOverlayEntryEqual(existing, entry)) return
      entries.set(messageId, entry)
      notifyKey(messageId)
      notifyMap()
    },
    reset() {
      if (entries.size === 0) return
      const ids = Array.from(entries.keys())
      entries.clear()
      mapDirty = true
      mapVersion += 1
      for (const id of ids) notifyKey(id)
      for (const listener of Array.from(mapListeners)) listener()
      void mapVersion
    }
  }
}

export const TranslationOverlayContext = createContext<TranslationOverlayStore | null>(null)
export const TranslationOverlayProvider = TranslationOverlayContext.Provider

/* Setter stays as the stable writer identity so translation hooks don't
 * re-render when the map mutates — only overlay readers do. */
export type TranslationOverlaySetter = (messageId: string, entry: TranslationOverlayEntry | null) => void
export const TranslationOverlaySetterContext = createContext<TranslationOverlaySetter | null>(null)
export const TranslationOverlaySetterProvider = TranslationOverlaySetterContext.Provider

/** Read the full overlay map (empty object when no provider is mounted). */
export function useTranslationOverlay(): Record<string, TranslationOverlayEntry> {
  const store = use(TranslationOverlayContext)
  const subscribe = useCallback(
    (listener: () => void) => store?.subscribeMap(listener) ?? (() => {}),
    [store]
  )
  const getSnapshot = useCallback(() => store?.getMapSnapshot() ?? EMPTY_TRANSLATION_OVERLAY, [store])
  const getServerSnapshot = useCallback(() => EMPTY_TRANSLATION_OVERLAY, [])
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

const EMPTY_TRANSLATION_OVERLAY: Record<string, TranslationOverlayEntry> = {}

/**
 * Read a single message's overlay entry. Subscribes only to that messageId so
 * unrelated ids keep stable references and don't re-render when another
 * message's translation changes.
 */
export function useTranslationOverlayEntry(messageId: string): TranslationOverlayEntry | undefined {
  const store = use(TranslationOverlayContext)
  const subscribe = useCallback(
    (listener: () => void) => store?.subscribe(messageId, listener) ?? (() => {}),
    [store, messageId]
  )
  const getSnapshot = useCallback(() => store?.getSnapshot(messageId), [store, messageId])
  const getServerSnapshot = useCallback(() => undefined as TranslationOverlayEntry | undefined, [])
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

/**
 * Imperative setter for translation hooks. Pass `null` to clear an entry.
 * Throws when called outside a `TranslationOverlaySetterProvider` — the
 * translation hook is only mounted inside `V2ChatContent`.
 */
export function useTranslationOverlaySetter(): TranslationOverlaySetter {
  const setter = use(TranslationOverlaySetterContext)
  if (!setter) {
    throw new Error('useTranslationOverlaySetter must be used inside TranslationOverlaySetterProvider')
  }
  return setter
}

/**
 * Non-throwing variant: returns `null` when no provider is mounted (scopes
 * that intentionally don't offer message translation, e.g. agent sessions /
 * quick-assistant). `useTranslateMessage` uses this so its menubar can render
 * in those scopes without the strict guard crashing — the strict
 * `useTranslationOverlaySetter` above is left intact for the chat path.
 */
export function useOptionalTranslationOverlaySetter(): TranslationOverlaySetter | null {
  return use(TranslationOverlaySetterContext)
}

/**
 * Get raw parts for a message from PartsContext.
 * Returns empty array if no parts provider exists or no parts are present.
 */
export function useMessageParts(messageId: string): CherryMessagePart[] {
  const scope = use(MessagePartsScopeContext)
  if (scope?.messageId === messageId) return scope.parts

  // React's `use` API may be called conditionally. Scoped message consumers
  // therefore avoid subscribing to the complete map.
  const partsMap = use(PartsContext)
  return partsMap?.[messageId] ?? EMPTY_MESSAGE_PARTS
}

/**
 * Resolve a single part from partsMap by part/block ID.
 * Supports both `${messageId}-part-${index}` and `${messageId}-block-${index}` formats.
 * Returns null if not found.
 */
export function resolvePartFromParts(
  partsMap: Record<string, CherryMessagePart[]>,
  partId: string
): { part: CherryMessagePart; messageId: string; index: number } | null {
  // Try block format first (existing parseBlockId handles ${msgId}-block-${i})
  let parsed = parseBlockId(partId)
  // Also try part format: ${msgId}-part-${i}
  if (!parsed) {
    const lastPartDash = partId.lastIndexOf('-part-')
    if (lastPartDash !== -1) {
      const messageId = partId.slice(0, lastPartDash)
      const index = parseInt(partId.slice(lastPartDash + 6), 10)
      if (!isNaN(index)) {
        parsed = { messageId, index }
      }
    }
  }
  if (!parsed) return null
  const parts = partsMap[parsed.messageId]
  if (!parts || parsed.index >= parts.length) return null
  return { part: parts[parsed.index], messageId: parsed.messageId, index: parsed.index }
}
