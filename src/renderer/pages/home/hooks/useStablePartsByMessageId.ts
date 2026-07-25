/**
 * Structural-sharing producer for the Home message part layers.
 *
 * # Why a useRef, not cacheService / useCache / Zustand
 *
 * This repo deliberately has no global state-management library. The v2
 * architecture replaces v1's Redux/Dexie/ElectronStore with the Cache /
 * Preference / DataApi trinity for *data* (with designated tiers + lifecycle)
 * plus *local React state* for render-local concerns. `partsByMessageId` is
 * a render-boundary derivation of `useChat`'s output — neither business data,
 * nor user settings, nor a cross-window scratchpad. It belongs in local
 * React state.
 *
 * Within local React state, `useRef` is the only primitive that lets us
 * remember a value across renders **without** triggering re-render scheduling.
 * Going through `useCache` (hook) adds subscription + setter-triggered renders
 * (double commits per chunk). Going through `cacheService.set/get` directly
 * dodges the subscription but pays tier-dispatch cost per chunk, requires a
 * schema-key definition, needs manual cleanup on topic switch / unmount, and
 * exposes a key any other component might accidentally subscribe to.
 * Introducing Zustand contradicts the v2 "no global state library" decision.
 *
 * This is the load-bearing correct choice for this layer, not the lazy default.
 * See plan: piped-hatching-anchor.md (PR 2 architectural choice section).
 *
 * # Algorithm
 *
 * - The upstream `messages` array carries per-message refs that are already
 *   stable for non-streaming items thanks to `useTopicMessages`'s WeakMap
 *   projection cache (`useTopicMessages.ts:226`). The streaming item gets a
 *   new `CherryUIMessage` ref each chunk, and its `parts` array ref changes
 *   with it.
 * - `historyPartsByMessageId` contains persisted parts plus translations. It
 *   never observes the high-frequency execution overlay.
 * - `partsByMessageId` applies the execution overlay on top for the mutable
 *   streaming tail.
 * - Both maps structurally share unchanged arrays and preserve their container
 *   identity when no relevant message changed.
 */

import type { TranslationOverlayEntry } from '@renderer/components/chat/messages/blocks/MessagePartsContext'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import { useMemo, useRef } from 'react'

export interface StableMessagePartsLayers {
  historyPartsByMessageId: Record<string, CherryMessagePart[]>
  partsByMessageId: Record<string, CherryMessagePart[]>
}

interface StableMessagePartsLayersCache {
  messageCount: number
  value: StableMessagePartsLayers
}

function partsContentEqual(a: CherryMessagePart[], b: CherryMessagePart[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const previousPart = a[i]
    const nextPart = b[i]
    if (previousPart === nextPart) continue
    if (previousPart.type !== 'data-translation' || nextPart.type !== 'data-translation') return false
    if (
      previousPart.id !== nextPart.id ||
      previousPart.data.content !== nextPart.data.content ||
      previousPart.data.targetLanguage !== nextPart.data.targetLanguage ||
      previousPart.data.sourceLanguage !== nextPart.data.sourceLanguage ||
      previousPart.data.sourceBlockId !== nextPart.data.sourceBlockId
    ) {
      return false
    }
  }
  return true
}

function appendTranslation(
  parts: CherryMessagePart[],
  trEntry: TranslationOverlayEntry | undefined
): CherryMessagePart[] {
  if (!trEntry) return parts
  const filtered = parts.filter((part) => part.type !== 'data-translation')
  const translationPart = {
    type: 'data-translation',
    data: {
      content: trEntry.content,
      targetLanguage: trEntry.targetLanguage,
      ...(trEntry.sourceLanguage && { sourceLanguage: trEntry.sourceLanguage })
    }
  } as CherryMessagePart
  return [...filtered, translationPart]
}

export function useStableMessagePartsLayers(
  messages: CherryUIMessage[],
  overlay: Record<string, CherryMessagePart[]>,
  translationOverlay: Record<string, TranslationOverlayEntry>
): StableMessagePartsLayers {
  const cacheRef = useRef<StableMessagePartsLayersCache>({
    messageCount: 0,
    value: {
      historyPartsByMessageId: {},
      partsByMessageId: {}
    }
  })

  return useMemo(() => {
    const previous = cacheRef.current
    const previousHistory = previous.value.historyPartsByMessageId
    const previousCurrent = previous.value.partsByMessageId
    const nextHistory: Record<string, CherryMessagePart[]> = {}
    const nextCurrent: Record<string, CherryMessagePart[]> = {}
    let historyChanged = previous.messageCount !== messages.length
    let currentChanged = previous.messageCount !== messages.length
    let hasExecutionOverlay = false

    for (const message of messages) {
      const baseParts = (message.parts ?? []) as CherryMessagePart[]
      const translation = translationOverlay[message.id]
      const historyCandidate = appendTranslation(baseParts, translation)
      const previousHistoryParts = previousHistory[message.id]
      const historyParts =
        previousHistoryParts && partsContentEqual(previousHistoryParts, historyCandidate)
          ? previousHistoryParts
          : historyCandidate
      nextHistory[message.id] = historyParts
      historyChanged ||= historyParts !== previousHistoryParts

      const executionParts = overlay[message.id]
      const usesExecutionOverlay = executionParts !== undefined && executionParts.length > 0
      hasExecutionOverlay ||= usesExecutionOverlay
      const currentCandidate = usesExecutionOverlay ? appendTranslation(executionParts, translation) : historyParts
      const previousCurrentParts = previousCurrent[message.id]
      const currentParts =
        previousCurrentParts && partsContentEqual(previousCurrentParts, currentCandidate)
          ? previousCurrentParts
          : currentCandidate
      nextCurrent[message.id] = currentParts
      currentChanged ||= currentParts !== previousCurrentParts
    }

    const historyPartsByMessageId = historyChanged ? nextHistory : previousHistory
    let partsByMessageId = previousCurrent
    if (!hasExecutionOverlay) {
      partsByMessageId = historyPartsByMessageId
    } else if (currentChanged) {
      partsByMessageId = nextCurrent
    }

    if (
      previous.messageCount === messages.length &&
      historyPartsByMessageId === previousHistory &&
      partsByMessageId === previousCurrent
    ) {
      return previous.value
    }

    const value = { historyPartsByMessageId, partsByMessageId }
    cacheRef.current = { messageCount: messages.length, value }
    return value
  }, [messages, overlay, translationOverlay])
}

export function useStablePartsByMessageId(
  messages: CherryUIMessage[],
  overlay: Record<string, CherryMessagePart[]>,
  translationOverlay: Record<string, TranslationOverlayEntry>
): Record<string, CherryMessagePart[]> {
  return useStableMessagePartsLayers(messages, overlay, translationOverlay).partsByMessageId
}
