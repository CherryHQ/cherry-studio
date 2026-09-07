import {
  getCachedMessageUiState,
  subscribeCachedMessageUiState,
  updateCachedMessageUiState
} from '@renderer/services/messageUiStateCache'
import { type Dispatch, type SetStateAction, useCallback, useState, useSyncExternalStore } from 'react'

import { useMessagePartsScopeId } from '../blocks/MessagePartsContext'

function readExpanded(
  messageId: string | undefined,
  disclosureId: string | undefined,
  defaultExpanded: boolean
): boolean {
  if (!messageId || !disclosureId) return defaultExpanded
  return getCachedMessageUiState(messageId).disclosures?.[disclosureId] ?? defaultExpanded
}

/**
 * Retains disclosure state in the message's existing window-local UI cache.
 * The external-store snapshot follows message/disclosure key changes instead
 * of carrying a useState initializer across two different identities.
 */
export function useMessageDisclosureState(
  disclosureId: string | undefined,
  defaultExpanded = false
): readonly [boolean, Dispatch<SetStateAction<boolean>>] {
  const messageId = useMessagePartsScopeId()
  const [unscopedExpanded, setUnscopedExpanded] = useState(defaultExpanded)

  const subscribe = useCallback(
    (listener: () => void) => {
      if (!messageId || !disclosureId) return () => {}
      return subscribeCachedMessageUiState(messageId, listener)
    },
    [disclosureId, messageId]
  )
  const getSnapshot = useCallback(
    () => (messageId && disclosureId ? readExpanded(messageId, disclosureId, defaultExpanded) : unscopedExpanded),
    [defaultExpanded, disclosureId, messageId, unscopedExpanded]
  )
  const isExpanded = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  const setExpanded = useCallback<Dispatch<SetStateAction<boolean>>>(
    (update) => {
      if (!messageId || !disclosureId) {
        setUnscopedExpanded(update)
        return
      }

      updateCachedMessageUiState(messageId, (current) => {
        const previous = current.disclosures?.[disclosureId] ?? defaultExpanded
        const expanded = typeof update === 'function' ? update(previous) : update
        return {
          ...current,
          disclosures: {
            ...current.disclosures,
            [disclosureId]: expanded
          }
        }
      })
    },
    [defaultExpanded, disclosureId, messageId]
  )

  return [isExpanded, setExpanded]
}
