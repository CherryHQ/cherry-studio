/**
 * Structural-sharing producer for `partsByMessageId`.
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
 * - For each message id, we compose the candidate parts (executionOverlay
 *   wins over `message.parts`, then optional translation overlay is appended).
 *   If the candidate is element-wise equal to the previous render's parts for
 *   that id, we reuse the previous array ref. Otherwise we adopt the new one.
 * - The container record's identity is preserved when no id changed (covers
 *   "nothing streamed this render" — composer state change, scroll, etc.).
 */

import type { TranslationOverlayEntry } from '@renderer/components/chat/messages/blocks'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import { useMemo, useRef } from 'react'

function partsContentEqual(a: CherryMessagePart[], b: CherryMessagePart[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

function buildCandidate(
  message: CherryUIMessage,
  overlay: Record<string, CherryMessagePart[]>,
  translationOverlay: Record<string, TranslationOverlayEntry>
): CherryMessagePart[] {
  const overlayParts = overlay[message.id]
  const baseParts =
    overlayParts && overlayParts.length > 0 ? overlayParts : ((message.parts ?? []) as CherryMessagePart[])
  const trEntry = translationOverlay[message.id]
  if (!trEntry) return baseParts
  const filtered = baseParts.filter((part) => part.type !== 'data-translation')
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

export function useStablePartsByMessageId(
  messages: CherryUIMessage[],
  overlay: Record<string, CherryMessagePart[]>,
  translationOverlay: Record<string, TranslationOverlayEntry>
): Record<string, CherryMessagePart[]> {
  const prevMapRef = useRef<Record<string, CherryMessagePart[]>>({})

  return useMemo(() => {
    const prev = prevMapRef.current
    const next: Record<string, CherryMessagePart[]> = {}
    let containerChanged = false

    for (const message of messages) {
      const candidate = buildCandidate(message, overlay, translationOverlay)
      const prevParts = prev[message.id]
      if (prevParts && partsContentEqual(prevParts, candidate)) {
        next[message.id] = prevParts
      } else {
        next[message.id] = candidate
        containerChanged = true
      }
    }

    if (!containerChanged && Object.keys(prev).length !== messages.length) {
      containerChanged = true
    }

    if (!containerChanged) return prev
    prevMapRef.current = next
    return next
  }, [messages, overlay, translationOverlay])
}
