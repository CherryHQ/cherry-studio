import { messageDisclosureStateService } from '@renderer/services/MessageDisclosureStateService'
import { useCallback, useState } from 'react'

import { useMessagePartsScopeId } from '../blocks/MessagePartsContext'

function readExpanded(
  messageId: string | undefined,
  disclosureId: string | undefined,
  defaultExpanded: boolean
): boolean {
  if (!messageId || !disclosureId) return defaultExpanded
  return messageDisclosureStateService.get(messageId, disclosureId) ?? defaultExpanded
}

/**
 * Retains a message disclosure's visual state across streamed subtree
 * replacement and Activity unmount/remount without subscribing to stream data.
 */
export function useMessageDisclosureState(
  disclosureId: string | undefined,
  defaultExpanded = false
): readonly [boolean, (expanded: boolean) => void] {
  const messageId = useMessagePartsScopeId()
  const [isExpanded, setIsExpanded] = useState(() => readExpanded(messageId, disclosureId, defaultExpanded))

  const setExpanded = useCallback(
    (expanded: boolean) => {
      setIsExpanded(expanded)
      if (!messageId || !disclosureId) return

      messageDisclosureStateService.set(messageId, disclosureId, expanded)
    },
    [disclosureId, messageId]
  )

  return [isExpanded, setExpanded]
}
